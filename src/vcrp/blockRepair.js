// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the blocks a reply left out, asked for in a second call.
//
// Some models (Gemini, DeepSeek) write the story and skip the <Blocks>, or stop inside them.
// The next reply carries the last whole copy forward (blockHistory.js), but this reply's card
// stays empty and the story's state runs a turn behind. So when a reply arrives without its
// blocks, or with a block it had to write missing or cut off, VCRP asks the model for just
// the blocks: a quiet call on the roleplay prompt as it stands (the reply is in the history,
// the cache is warm from the request that wrote it, the block instructions are the last thing
// read, the thinking and the prefill are not sent), answered with a <Blocks> section that is
// merged into the reply. Once per reply, after the other handlers have had it, and never for
// a blank reply. Off in the BLOCKS tab.
//
// Which blocks a reply had to write: every block in the stack that is written every turn.
// Pura's trackers that carry their state (written only when something changes) are not
// among them, nor the Notebook_Update (left out when nothing changed); the Notebook itself is,
// on the turn that writes it.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, generateQuietPrompt, isGenerating, saveChat, updateMessageBlock } from "../st.js";
import { localProfile } from "../core/state.js";
import { meguminActiveDataIdentity } from "../core/keys.js";
import {
    activeBlockRepair, setActiveBlockRepair,
    activeStoryPlanRequest, activeBanListChat, activeNpcScanRequest, activeNpcUpdateRequest, activeGenerationOrder, activeFocusAudit,
} from "../core/activeRequests.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import { blankReplyKind } from "./blankReply.js";
import { memorySummaryRunning } from "./memory/summarize.js";
import { vcrpMemoryCountTaskOutput } from "./memory/index.js";
import { notebookOn, notebookCurrentPhase } from "./notebook/index.js";
import { vcrpWithoutSwipedReply } from "./generation.js";

export const TASK_MARKER = "[VCRP BLOCKS";
const WAIT_MS = 1500;      // after the reply: let SillyTavern save and draw it, and the other handlers run
const RETRY_MS = 2000;     // while another call is running
const MAX_WAIT_MS = 90000;

/** On unless switched off in the BLOCKS tab. */
export function blockRepairOn() {
    return !(localProfile && localProfile.blockRepair && localProfile.blockRepair.enabled === false);
}

/** The reader's switch (the caller saves the profile). */
export function setBlockRepairOn(on) {
    if (!localProfile) return;
    localProfile.blockRepair = { ...(localProfile.blockRepair || {}), enabled: Boolean(on) };
}

// Where a reply's own text starts: after its last </think>.
function afterThinking(text) {
    let at = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(text)) !== null) at = m.index + m[0].length;
    return at;
}

/** The blocks a reply has to write every turn: [{ tag, label }], in stack order. */
export function requiredBlocks(chat) {
    let active = [];
    try { active = meguminActiveBlocks(); } catch (e) { active = []; }
    const out = active
        .filter(b => b && b.tag && !b.transient && !b.slot && !b.lead && !b.carry && b.group !== "notebook")
        .map(b => ({ tag: b.tag, label: b.label || b.tag }));
    // The Notebook, on the turn that writes it (the setup); its updates are optional.
    try {
        if (notebookOn() && notebookCurrentPhase(chat) === "setup") out.push({ tag: "Notebook", label: "Notebook" });
    } catch (e) { /* no notebook: nothing to require */ }
    return out;
}

/**
 * What a reply's blocks lack: { how: "none" | "cut" | "some", tags: [{ tag, label }] }, or
 * null when every required block is there, whole. `required` as requiredBlocks() gives it.
 */
export function missingBlocks(mes, required) {
    if (!required || !required.length) return null;
    const s = String(mes || "");
    const story = s.slice(afterThinking(s));
    const opens = (story.match(/<Blocks\b[^>]*>/gi) || []).length;
    const closes = (story.match(/<\/Blocks\s*>/gi) || []).length;
    if (!opens) return { how: "none", tags: required };
    const cut = opens > closes;
    const env = cut ? story.slice(story.search(/<Blocks\b/i)) : (story.match(/<Blocks\b[^>]*>[\s\S]*<\/Blocks\s*>/i) || [""])[0];
    const tags = required.filter(b => !new RegExp(`<${b.tag}\\b[^>]*>[\\s\\S]*?<\\/${b.tag}\\s*>`, "i").test(env));
    if (!cut && !tags.length) return null;
    return { how: cut ? "cut" : "some", tags };
}

/** The <Blocks> section in the model's answer (closed for it when it ran to the end), or null. */
export function envelopeIn(raw) {
    const text = String(raw || "").replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?\s*>|$)/gi, "");
    const whole = text.match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/i);
    if (whole) return whole[0].trim();
    const at = text.search(/<Blocks\b/i);
    if (at < 0) return null;
    const open = text.slice(at).replace(/\s+$/, "");
    return /<\w/.test(open.replace(/^<Blocks\b[^>]*>/i, "")) ? `${open}\n</Blocks>` : null;
}

// The blocks inside an envelope, its own <Blocks> wrapper taken off first (it would match as one block).
const inside = env => String(env).replace(/^\s*<Blocks\b[^>]*>/i, "").replace(/<\/Blocks\s*>\s*$/i, "");
const innerBlocks = env => [...inside(env).matchAll(/<([A-Z][A-Za-z_]*)\b[^>]*>[\s\S]*?<\/\1\s*>/g)].map(m => ({ tag: m[1], text: m[0] }));

/**
 * The reply with the answered blocks in it: an envelope it lacked (or stopped inside) is
 * replaced from where it opened; one that was whole but short of a block takes the answer's
 * blocks and keeps those of its own the answer left out.
 */
export function withRepairedBlocks(mes, env, how) {
    const s = String(mes || "");
    const from = afterThinking(s);
    const story = s.slice(from);
    if (how === "some") {
        const own = (story.match(/<Blocks\b[^>]*>[\s\S]*<\/Blocks\s*>/i) || [""])[0];
        const have = new Set(innerBlocks(env).map(b => b.tag));
        const kept = innerBlocks(own).filter(b => !have.has(b.tag)).map(b => b.text);
        const merged = kept.length ? env.replace(/\s*<\/Blocks\s*>$/i, `\n${kept.join("\n")}\n</Blocks>`) : env;
        return s.slice(0, from) + story.replace(own, () => merged);
    }
    const at = story.search(/<Blocks\b/i);
    const base = (at >= 0 ? s.slice(0, from + at) : s).replace(/\s+$/, "");
    return `${base}\n\n${env}`;
}

const otherTaskRunning = () => !!(activeStoryPlanRequest || activeBanListChat || activeNpcScanRequest || activeNpcUpdateRequest || activeGenerationOrder || activeFocusAudit);
const busy = () => !!activeBlockRepair || otherTaskRunning() || memorySummaryRunning() || (typeof isGenerating === "function" && isGenerating());

// What runs on a repaired reply (the NPC capture, the Story Director's tracker: index.js).
const followUps = new Set();
export function onBlocksRepaired(fn) { followUps.add(fn); }

function task(need) {
    const names = need.tags.map(b => b.label).join(", ");
    const what = need.how === "none" ? "Your last reply above ends without its <Blocks> section."
        : need.how === "cut" ? "Your last reply above stops inside its <Blocks> section, unfinished."
            : `Your last reply above is missing ${names} from its <Blocks> section.`;
    return `${TASK_MARKER}: this is not a story turn. Do not continue the roleplay, and do not rewrite your last reply.]\n${what} Write only the <Blocks> section for that reply now, as the block instructions above ask for this turn: every block listed there, in full, as things stand at the end of your last reply. Nothing else: no story text, no thinking, nothing before <Blocks> or after </Blocks>.`;
}

/**
 * Asks for message `id`'s missing blocks now and puts them in. Returns what happened:
 * { status: "done" | "whole" | "blank" | "off" | "asked" | "busy" | "aborted" | "failed", reason? }.
 */
export async function repairBlocksNow(id) {
    const chat = ((getContext() || {}).chat) || [];
    const msg = chat[Number(id)];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return { status: "whole" };
    if (Number(id) === 0) return { status: "whole" };   // the greeting is the card's, written without blocks
    if (!blockRepairOn()) return { status: "off" };
    if (msg.extra && msg.extra.vcrp_blocks_repair) return { status: "asked", reason: "already asked for this reply" };   // once per reply
    if (blankReplyKind(msg.mes)) return { status: "blank" };
    const need = missingBlocks(msg.mes, requiredBlocks(vcrpWithoutSwipedReply(chat)));
    if (!need) return { status: "whole" };
    if (busy()) return { status: "busy" };
    const identity = meguminActiveDataIdentity();
    const was = msg.mes;
    msg.extra = { ...(msg.extra || {}), vcrp_blocks_repair: "asked" };
    setActiveBlockRepair({ index: Number(id), tags: need.tags.map(b => b.tag) });
    let raw = null;
    try {
        raw = await generateQuietPrompt({ quietPrompt: task(need) });
    } catch (e) {
        console.error("[VCRP] Blocks: the call for the missing blocks failed", e);
        raw = null;
    } finally {
        setActiveBlockRepair(null);
    }
    if (raw) vcrpMemoryCountTaskOutput(raw);
    if (meguminActiveDataIdentity() !== identity) return { status: "aborted", reason: "the chat changed" };
    const now = ((getContext() || {}).chat) || [];
    const target = now[Number(id)];
    if (target !== msg || msg.mes !== was) return { status: "aborted", reason: "the reply changed meanwhile" };
    const env = envelopeIn(raw);
    if (!env) {
        msg.extra.vcrp_blocks_repair = "failed";
        console.debug("[VCRP] Blocks: the model answered without a <Blocks> section", String(raw || "").slice(0, 200));
        return { status: "failed", reason: raw ? "the answer had no <Blocks> section" : "the request failed" };
    }
    msg.mes = withRepairedBlocks(was, env, need.how);
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = msg.mes;
    msg.extra.vcrp_blocks_repair = "done";
    try { await saveChat(); } catch (e) { console.warn("[VCRP] Blocks: could not save the chat", e); }
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(Number(id), msg);
    } catch (e) { console.warn("[VCRP] Blocks: could not redraw message", id, e); }
    for (const fn of followUps) { try { fn(Number(id)); } catch (e) { console.warn("[VCRP] Blocks: a follow-up failed", e); } }
    if (typeof toastr !== "undefined") {
        const names = need.tags.map(b => b.label).join(", ");
        toastr.info(need.how === "none" ? `This reply came without its blocks. VCRP asked the model for them in a small second call (it reads the cache) and added them.` : `This reply was short of ${names}. VCRP asked the model for the blocks in a small second call (it reads the cache) and added them.`, "VCRP: blocks", { timeOut: 8000 });
    }
    return { status: "done" };
}

/**
 * MESSAGE_RECEIVED: after the reply's other handlers, and once SillyTavern has saved and drawn
 * it, ask for its missing blocks. Waits for another call of VCRP's to finish first.
 */
export function vcrpBlockRepairOnReply(messageId, type) {
    if (type === "first_message" || !blockRepairOn()) return;
    const chat = ((getContext() || {}).chat) || [];
    const id = Number(messageId);
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || id === 0) return;
    if (msg.extra && msg.extra.vcrp_blocks_repair) return;   // once per reply
    if (blankReplyKind(msg.mes)) return;
    if (!missingBlocks(msg.mes, requiredBlocks(vcrpWithoutSwipedReply(chat)))) return;
    const identity = meguminActiveDataIdentity();
    let waited = 0;
    const attempt = async () => {
        if (meguminActiveDataIdentity() !== identity || !blockRepairOn()) return;
        if (busy()) {
            if ((waited += RETRY_MS) <= MAX_WAIT_MS) setTimeout(attempt, RETRY_MS);
            return;
        }
        const r = await repairBlocksNow(id);
        if (r.status === "failed" && typeof toastr !== "undefined") toastr.info(`VCRP asked the model for this reply's missing blocks, but ${r.reason}. The next reply carries the last complete ones.`, "VCRP: blocks", { timeOut: 8000 });
    };
    setTimeout(attempt, WAIT_MS);
}
