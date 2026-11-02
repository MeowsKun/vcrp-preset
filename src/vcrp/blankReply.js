// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply that came back blank.
//
// Gemini answers a request its content filter blocks with nothing at all. A model stopped by
// the output limit while still thinking leaves an open <think> and no story; one that wrote
// the whole reply inside its thinking, or only its blocks, shows an empty story too. Each is
// told apart and said once, as the reply arrives, with what to do about it. The handlers
// after this one leave such a reply alone: its size is not measured (it would drag the
// average reply down, and with it the room every reply is given), the one-shot direction
// stays for the swipe, no rolls note is added to it, no blocks are asked for.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";

const THINK_OPEN = /<think(?:ing)?\b[^>]*>/i;
const THINK_CLOSE = /<\/think(?:ing)?\s*>/gi;

/**
 * How a reply is blank: "empty" (nothing), "thinking-open" (stopped inside its thinking),
 * "thinking" (the thinking closed and nothing after it), "blocks" (blocks and no story), or
 * null for a reply with a story.
 */
export function blankReplyKind(text) {
    const s = String(text || "");
    if (!s.trim()) return "empty";
    let closedAt = -1, m;
    THINK_CLOSE.lastIndex = 0;
    while ((m = THINK_CLOSE.exec(s)) !== null) closedAt = m.index + m[0].length;
    const opened = THINK_OPEN.test(s);
    if (opened && closedAt < 0) return "thinking-open";
    const rest = closedAt >= 0 ? s.slice(closedAt) : s;
    const story = rest
        .replace(/<Blocks\b[^>]*>[\s\S]*?(?:<\/Blocks\s*>|$)/gi, "")
        .replace(/<(Notebook|Notebook_Update)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
        .trim();
    if (story) return null;
    if (/<Blocks\b/i.test(rest)) return "blocks";
    return closedAt >= 0 ? "thinking" : "empty";
}

/** True for a reply with no story in it (any of the kinds above). */
export const isBlankReply = text => blankReplyKind(text) !== null;

const WHY = {
    empty: "The model sent nothing back. On Gemini that is usually its content filter: it blocks the reply and returns an empty one. Swipe for another. If this scene keeps coming back empty, switch on the preset's \"USER Hard\" prompt (AI Response Configuration, in the prompt list; off by default), or write this reply with another model.",
    "thinking-open": "The reply stopped while still thinking: the output limit cut it. Raise the Safety cap (Memory → Reply length) or SillyTavern's Max Response Length. On Gemini and other models that reason before they write, that reasoning counts against the limit.",
    thinking: "The whole reply is its reasoning; the story never came. Swipe for another. If it happens often, raise the Safety cap (Memory → Reply length): the model's reasoning counts against it.",
    blocks: "The reply holds only its blocks, no story. Swipe for another.",
};

/** MESSAGE_RECEIVED: a blank reply is said, with why and what to do. */
export function vcrpBlankOnReply(messageId, type) {
    if (type === "first_message") return;
    const chat = ((getContext() || {}).chat) || [];
    const msg = chat[Number(messageId)];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return;
    let kind = blankReplyKind(msg.mes);
    if (!kind) return;
    // SillyTavern may have moved the model's reasoning into its own box: an empty story with
    // reasoning beside it is a reply that was all reasoning.
    if (kind === "empty" && msg.extra && String(msg.extra.reasoning || "").trim()) kind = "thinking";
    // One cut off by the length limit while thinking was already said (replyCut.js).
    if (kind === "thinking-open" && msg.extra && msg.extra.vcrp_cut === "thinking") return;
    if (typeof toastr !== "undefined") toastr.warning(WHY[kind], "VCRP: an empty reply", { timeOut: 14000, extendedTimeOut: 6000 });
}
