// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the <Blocks> of earlier replies, kept out of the history.
//
// The preset's "Blocks cleanup" regex strips a reply's blocks only from depth 3 on, so the
// latest reply kept them in the prompt for one turn and lost them the next. Its text
// changed between two requests in a row, and everything from it onward missed the cache:
// on a long chat, thousands of tokens written again at double price on every request.
//
// So every reply in the history goes to the model without its blocks (bar a reply being
// continued, which is still being written), and the latest reply's blocks travel with the
// per-turn block instructions instead ([[blocks]], after the chat), where they still tell
// the model what the trackers and stats said last turn.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpWithoutSwipedReply } from "./generation.js";

const BLOCKS_PAIRED = /\s*<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi;
const BLOCKS_OPEN = /\s*<Blocks\b[^>]*>[\s\S]*$/i;   // a reply cut off inside its blocks

const strip = s => String(s).replace(BLOCKS_PAIRED, "").replace(BLOCKS_OPEN, "");

/**
 * Removes <Blocks> from every assistant message in the prompt except a trailing one (a
 * reply being continued, or a prefill). Changes the messages in place.
 */
export function stripHistoryBlocks(messages) {
    if (!Array.isArray(messages)) return;
    const last = messages.length - 1;
    messages.forEach((m, i) => {
        if (!m || m.role !== "assistant" || i === last) return;
        if (typeof m.content === "string") {
            if (/<Blocks\b/i.test(m.content)) m.content = strip(m.content);
        } else if (Array.isArray(m.content)) {
            m.content = m.content.map(p => (p && p.type === "text" && /<Blocks\b/i.test(p.text || "")) ? { ...p, text: strip(p.text) } : p);
        }
    });
}

/** The latest reply's blocks, complete, or "" when it has none. A reply being swiped does not count. */
export function lastBlocksState() {
    let chat = [];
    try { chat = ((getContext() || {}).chat || []).filter(m => !m.is_system); } catch (e) { return ""; }
    const reply = [...vcrpWithoutSwipedReply(chat)].reverse().find(m => !m.is_user);
    if (!reply || typeof reply.mes !== "string") return "";
    const found = reply.mes.match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi);
    return found ? found[found.length - 1].trim() : "";
}

/** What the per-turn block instructions add: last turn's blocks, as the starting point. */
export function previousBlocksNote() {
    const state = lastBlocksState();
    return state
        ? `The blocks as they stood at the end of your last reply. Write this reply's blocks from there: carry forward what this scene does not change.\n${state}`
        : "";
}
