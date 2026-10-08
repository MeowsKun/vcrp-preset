// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what the background calls send, and what they cost.
//
// The Story Director, NPC scans and NPC updates each send the main model a prompt of their
// own, never cached: up to 100 raw messages for the Director, 60 for a scan. On a long
// chat with Opus that is $0.35 to $0.60 a call, more than two or three replies, and the
// spend estimate never saw them.
//
//   - Their cost shows before you press the button, and is counted when they run.
//   - With Story Memory on, the Director reads the story memory (gists, arcs, facts) and
//     the last 30 messages instead of 100 raw ones, or the whole chat.
//   - A scan reads only the messages since the last scan (a few before it for context),
//     up to the scan depth: a second scan soon after costs cents.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, substituteParams } from "../st.js";
import { localProfile } from "../core/state.js";
import { getChatForStoryDirector, meguminCleanChatHistoryText } from "../engine/chatText.js";
import { vcrpActiveModel } from "./generation.js";
import { priceForModel } from "./memory/budget.js";
import {
    vcrpMemoryEnabled, memoryState, memoryBudgetSettings, resolveAnchor, anchorOf, estimateTokens,
} from "./memory/index.js";
import { composeMemoryText } from "./memory/ledger.js";

const DIRECTOR_RECENT = 30;      // messages the Director reads word for word on top of the memory
const DIRECTOR_FIXED = 2500;     // its own instructions, roughly
const NPC_FIXED = 2000;          // a scan's or an update's own instructions, roughly
const OUTPUT_GUESS = 2000;       // what a background answer runs to, thinking included
const SCAN_OVERLAP = 4;          // messages before the last scanned one, for context
const SCAN_META = "vcrp_npc_scan";

const k = n => `${Math.round(n / 100) / 10}k`;
const money = n => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const storyMessages = () => (((getContext() || {}).chat) || []).filter(m => !m.is_system);
const line = m => { const t = meguminCleanChatHistoryText(m.mes); return t ? `${m.name}: ${t}` : null; };

/** "Sends about 63k tokens, roughly $0.35 on Claude Opus 4.6." The price part needs a known model. */
export function backgroundEstimate(promptTokens) {
    const s = memoryBudgetSettings();
    const price = priceForModel(vcrpActiveModel().model, s.customPrice);
    const cost = price ? (promptTokens * price.input + OUTPUT_GUESS * price.output) / 1e6 : null;
    return {
        tokens: promptTokens, cost,
        text: `Sends about ${k(promptTokens)} tokens${cost !== null ? `, roughly ${money(cost)} on ${price.label}` : ""}.`,
    };
}

// ── Story Director ───────────────────────────────────────────────────────────

/**
 * What the Director reads. With Story Memory on and something summarized: the memory
 * (arcs, the gists of chapters before the recent messages, every fact) and the last 30
 * messages. When the approved chapters end further back (some waiting for review), the
 * messages from where they end, so nothing falls between the two; never more than the
 * Director's own window. Otherwise its usual window.
 */
export function vcrpChatForStoryDirector() {
    const viaMemory = vcrpMemoryEnabled() ? directorFromMemory() : "";
    return viaMemory || getChatForStoryDirector();
}

function directorFromMemory() {
    const st = memoryState();
    if (!st || !((st.chapters || []).length || (st.arcs || []).length)) return "";
    const msgs = storyMessages();
    const covered = resolveAnchor(msgs, st.summarized);
    if (covered < 0) return "";   // lost its place (a rewind not yet reconciled): the usual window
    const sp = (localProfile && localProfile.storyPlan) || {};
    const limit = sp.contextLimit !== undefined ? Number(sp.contextLimit) || 0 : 100;   // as getChatForStoryDirector
    const windowStart = limit > 0 ? Math.max(0, msgs.length - limit) : 0;
    const from = Math.max(windowStart, Math.min(msgs.length - DIRECTOR_RECENT, covered), 0);
    // A gist for every chapter that starts before the messages below: one they only
    // partly show still carries its beginning.
    const before = c => !(resolveAnchor(msgs, c.start) >= from);
    const memory = composeMemoryText({ arcs: st.arcs || [], chapters: st.chapters || [], ledger: st.ledger || [] }, before);
    const tail = msgs.slice(from).map(line).filter(Boolean).join("\n\n");
    return memory ? `${memory}\n\n${tail}` : "";
}

/** The Director's next call, estimated: the story, the character card, the persona and its last directive. */
export function directorEstimate() {
    const sub = s => (typeof substituteParams === "function" ? String(substituteParams(s) || "") : "");
    const plan = (localProfile && localProfile.storyPlan && localProfile.storyPlan.currentPlan) || "";
    const extra = estimateTokens(sub("{{description}}") + sub("{{persona}}") + plan);
    return backgroundEstimate(estimateTokens(vcrpChatForStoryDirector()) + extra + DIRECTOR_FIXED);
}

// ── NPC scans and updates ────────────────────────────────────────────────────

const scanDepth = () => Number(localProfile && localProfile.npcBank && localProfile.npcBank.scanDepth) || 60;

/**
 * The text an NPC scan reads, and how many messages are new. `newOnly` (a scan): from just
 * before the last scanned message on, at most the scan depth. Otherwise (an update) the
 * last scan-depth messages, as before.
 */
export function vcrpChatForNpcScan({ newOnly = false } = {}) {
    const msgs = storyMessages();
    let start = Math.max(0, msgs.length - scanDepth());
    let fresh = msgs.length - start, resumed = false;
    if (newOnly) {
        const mark = chat_metadata && chat_metadata[SCAN_META] && chat_metadata[SCAN_META].anchor;
        const at = mark ? resolveAnchor(msgs, mark) : -1;
        if (at >= 0) {
            fresh = Math.max(0, msgs.length - 1 - at);
            start = Math.max(start, at + 1 - SCAN_OVERLAP);
            resumed = true;
        }
    }
    return { text: msgs.slice(start).map(line).filter(Boolean).join("\n\n"), fresh, count: msgs.length - start, resumed };
}

/** The newest message as a scan starts: where the next scan picks up. Null on an empty chat. */
export function vcrpNpcScanMark() {
    const msgs = storyMessages();
    return msgs.length ? anchorOf(msgs, msgs.length - 1) : null;
}

/** After a scan: store the mark taken when it started (a reply that came in meanwhile is still new). */
export async function vcrpNoteNpcScan(mark = vcrpNpcScanMark()) {
    if (!chat_metadata || !mark) return;
    chat_metadata[SCAN_META] = { anchor: mark, at: Date.now() };
    try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Could not save where the NPC scan ended:", e); }
}

/** A scan's or an update's next call, estimated. */
export function npcEstimate({ newOnly = false } = {}) {
    const { text } = vcrpChatForNpcScan({ newOnly });
    return backgroundEstimate(estimateTokens(text) + NPC_FIXED);
}
