// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the blocks written by the helper model after each reply (Megumin Suite V11's
// Chomusuke blocks, on VCRP's carry).
//
// While the helper writes the blocks, the story model is not asked for them: its <Blocks>
// instructions keep only the blocks left to it (none, as a rule), and it reads where the
// blocks stood instead. After each reply the helper gets the same templates and rules the
// story model would have, the blocks as they stood before the reply, the last few messages
// and the latest exchange, and answers with the <Blocks> section; VCRP puts it at the end
// of the reply, as if the story model had written it. Everything downstream then works as
// it always did: the card, the carry to the next turn (blockHistory.js), the NPC capture,
// the strip from the history (the cache).
//
// Once per reply (a swipe is a reply of its own), never for the greeting or a blank reply;
// a reply that changed meanwhile (an edit, a repair) is left alone. "Write the last reply's
// blocks again" in the Helper tab does it over.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, saveChat, updateMessageBlock, substituteParams, generateQuietPrompt } from "../../st.js";
import { meguminActiveDataIdentity } from "../../core/keys.js";
import { setActiveHelperBlocks } from "../../core/activeRequests.js";
import { buildBlocksEnvelope } from "../../features/blocks/registry.js";
import { buildBaseDict } from "../../engine/buildBaseDict.js";
import { meguminCleanChatHistoryText } from "../../engine/chatText.js";
import { activeBlocksState, carriedTrackerNote } from "../blockHistory.js";
import { knownNamesBlock } from "../scene.js";
import { blankReplyKind } from "../blankReply.js";
import { envelopeIn, withRepairedBlocks, runBlockFollowUps } from "../blockRepair.js";
import { helperRoutesBlocks } from "./settings.js";
import { helperRoutedIdSet } from "./routes.js";
import { runHelperJob } from "./index.js";
import { warnHelper, answerKind } from "./notice.js";

export { helperRoutedBlocks, helperRoutedIdSet } from "./routes.js";

const WAIT_MS = 1500;   // after the reply: let SillyTavern save and draw it, and the other handlers run
const EARLIER_MESSAGES = 4;

export const HELPER_BLOCKS_SYSTEM = "You keep the running notes of an ongoing story: who is in the scene, the state of the world, how each character feels about {{user}}, {{user}}'s condition and belongings, what the characters privately think, and whatever else the blocks below track. You never continue the story and never explain. Numbers and facts come only from what the latest exchange states or clearly shows; what it does not change is carried forward as it stood. Write in the story's language.";

const HELPER_HEADER = [
    "## Answer with exactly one <Blocks> section and nothing else: no story, no thinking, no explanation, nothing before <Blocks> or after </Blocks>.",
    "Put every block inside it, in this order, each in its own tag. Do not add tags that are not listed. Do not nest blocks inside each other. Close every tag you open. Never wrap a block in <details> or <summary>.",
].join("\n");

const sub = t => { try { return substituteParams(t); } catch (e) { return t; } };

/**
 * What the story model reads in place of the blocks it no longer writes: the blocks as they
 * stood at the end of its last reply (the helper's work), and Pura's carried trackers.
 */
export function helperStateNote() {
    const parts = [];
    let state = "";
    try { state = activeBlocksState(); } catch (e) { state = ""; }
    if (state) parts.push(`The story's notes as they stood at the end of your last reply, kept up after each reply by an editor. Read them for what is true now; write only the blocks asked for above, if any, from where they stood.\n${state}`);
    let carried = "";
    try { carried = carriedTrackerNote(); } catch (e) { carried = ""; }
    if (carried) parts.push(carried);
    return parts.join("\n\n");
}

const line = m => { const t = meguminCleanChatHistoryText(m && m.mes); return t ? `${m.name || (m.is_user ? "User" : "Character")}: ${t}` : ""; };

// Where the latest exchange starts: the user turn(s) just before the reply.
function exchangeStart(chat, index) {
    let start = index;
    while (start - 1 >= 0 && chat[start - 1] && (chat[start - 1].is_user || chat[start - 1].is_system)) start--;
    return start;
}

/** The latest exchange: the user turn(s) just before the reply, then the reply. */
export function exchangeText(index, replyText) {
    const chat = (getContext() || {}).chat || [];
    const start = exchangeStart(chat, index);
    const lines = chat.slice(start, index).filter(m => m && m.is_user).map(line).filter(Boolean);
    const reply = chat[index];
    const t = meguminCleanChatHistoryText(replyText);
    lines.push(`${reply ? reply.name : "Character"}: ${t}`);
    return lines.join("\n\n");
}

/** The messages before the latest exchange, for context. */
export function earlierText(index, count = EARLIER_MESSAGES) {
    const chat = (getContext() || {}).chat || [];
    const start = exchangeStart(chat, index);
    return chat.slice(0, start).filter(m => m && !m.is_system).slice(-count).map(line).filter(Boolean).join("\n\n");
}

/**
 * The helper's prompt for the reply at `index`: { system, user, index }, or null when it
 * has nothing to write.
 */
export function buildHelperBlocksPrompt(index) {
    const chat = (getContext() || {}).chat || [];
    const msg = chat[index];
    if (!msg || typeof msg.mes !== "string") return null;
    const routed = helperRoutedIdSet();
    if (!routed.size) return null;
    let dict = {};
    try { dict = buildBaseDict(true, { dryRun: true }); } catch (e) { console.warn("[VCRP] Helper: the block templates could not be built.", e); }
    const envelope = buildBlocksEnvelope(dict, { only: routed, header: HELPER_HEADER, notebook: false });
    if (!envelope) return null;
    const parts = [];
    let known = "";
    try { known = knownNamesBlock(); } catch (e) { known = ""; }
    if (known) parts.push(known);
    let state = "";
    try { state = activeBlocksState(); } catch (e) { state = ""; }
    if (state) parts.push(`<Previous_Blocks>\nThe blocks as they stood before the latest exchange. Write the new blocks from there: carry forward whatever the exchange does not change.\n${state}\n</Previous_Blocks>`);
    let carried = "";
    try { carried = carriedTrackerNote(); } catch (e) { carried = ""; }
    if (carried) parts.push(carried);
    const earlier = earlierText(index);
    if (earlier) parts.push(`<Earlier_Story>\n${earlier}\n</Earlier_Story>`);
    parts.push(`<Latest_Exchange>\n${exchangeText(index, msg.mes)}\n</Latest_Exchange>`);
    parts.push(`# Task\nWrite these blocks for the moment the latest exchange ends on, following the instructions inside each one.\n\n${envelope}`);
    return { system: sub(HELPER_BLOCKS_SYSTEM), user: sub(parts.join("\n\n")), index };
}

/** The helper's answer, cleaned: no thinking, no code fences. */
export const cleanHelperAnswer = raw => String(raw || "")
    .replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .trim();

const storyPart = s => { let at = 0, m; const re = /<\/think(?:ing)?\s*>/gi; while ((m = re.exec(s)) !== null) at = m.index + m[0].length; return s.slice(at); };

/**
 * Writes the reply's blocks now. Returns what happened:
 * { status: "done" | "whole" | "off" | "blank" | "stopped" | "aborted" | "failed", reason? }.
 */
export async function helperWriteBlocks(id, { force = false } = {}) {
    const chat = ((getContext() || {}).chat) || [];
    const index = Number(id);
    const msg = chat[index];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return { status: "whole" };
    if (index === 0) return { status: "whole" };   // the greeting is the card's, written without blocks
    if (!helperRoutesBlocks()) return { status: "off" };
    if (!force && msg.extra && msg.extra.vcrp_helper_blocks === "done") return { status: "done", reason: "already written" };
    if (blankReplyKind(msg.mes)) return { status: "blank" };
    const prompt = buildHelperBlocksPrompt(index);
    if (!prompt) return { status: "whole" };
    const identity = meguminActiveDataIdentity();
    const was = msg.mes;
    msg.extra = { ...(msg.extra || {}), vcrp_helper_blocks: "asked" };
    // The payload is parked inside the job, when it runs: a job waiting its turn must not be
    // read by the one before it.
    const r = await runHelperJob("blocks", async () => {
        setActiveHelperBlocks(prompt);
        try { return await generateQuietPrompt({ prompt: "___PS_HELPER_BLOCKS___" }); } finally { setActiveHelperBlocks(null); }
    }, { force });
    if (r.stopped) { msg.extra.vcrp_helper_blocks = ""; return { status: "stopped" }; }
    if (r.failed) { msg.extra.vcrp_helper_blocks = "failed"; return { status: "failed", reason: "the request failed" }; }
    const raw = typeof r.value === "string" ? r.value : "";
    if (meguminActiveDataIdentity() !== identity) return { status: "aborted", reason: "the chat changed" };
    const now = ((getContext() || {}).chat) || [];
    if (now[index] !== msg || msg.mes !== was) return { status: "aborted", reason: "the reply changed meanwhile" };
    const env = envelopeIn(cleanHelperAnswer(raw));
    if (!env) {
        msg.extra.vcrp_helper_blocks = "failed";
        const kind = answerKind(raw);
        warnHelper(kind, ["blocks"]);
        return { status: "failed", reason: kind === "empty" ? "the helper sent back nothing" : "the answer had no <Blocks> section" };
    }
    // A reply with a whole envelope of its own (the blocks left to the story model) keeps the
    // blocks the helper did not write; one with none, or a cut one, takes the helper's.
    const how = /<Blocks\b[^>]*>[\s\S]*<\/Blocks\s*>/i.test(storyPart(was)) ? "some" : "none";
    msg.mes = withRepairedBlocks(was, env, how);
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = msg.mes;
    msg.extra.vcrp_helper_blocks = "done";
    try { await saveChat(); } catch (e) { console.warn("[VCRP] Helper: could not save the chat", e); }
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${index}"]`)) updateMessageBlock(index, msg);
    } catch (e) { console.warn("[VCRP] Helper: could not redraw message", index, e); }
    runBlockFollowUps(index);
    return { status: "done" };
}

/**
 * MESSAGE_RECEIVED: once SillyTavern has saved and drawn the reply, and the handlers before
 * this one have had it, the helper writes its blocks.
 */
export function vcrpHelperBlocksOnReply(messageId, type) {
    if (type === "first_message" || !helperRoutesBlocks()) return;
    const chat = ((getContext() || {}).chat) || [];
    const id = Number(messageId);
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || id === 0) return;
    // SillyTavern starts a new swipe with a copy of the last one's extras: a swipe is a reply of its own.
    if (type === "swipe" && msg.extra) delete msg.extra.vcrp_helper_blocks;
    if (msg.extra && msg.extra.vcrp_helper_blocks) return;
    if (blankReplyKind(msg.mes)) return;
    if (!helperRoutedIdSet().size) return;
    const identity = meguminActiveDataIdentity();
    setTimeout(async () => {
        if (meguminActiveDataIdentity() !== identity || !helperRoutesBlocks()) return;
        try { await helperWriteBlocks(id); } catch (e) { console.error("[VCRP] Helper: the blocks job failed", e); }
    }, WAIT_MS);
}
