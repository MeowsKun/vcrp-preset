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

const GEMINI_FILTER = "Swipe for another. If this scene keeps coming back empty, turn on the Gemini JB add-on (Global Toggles & Add-ons) or the preset's \"USER Hard\" prompt (AI Response Configuration, in the prompt list; off by default), or write this reply with another model.";
const WHY = {
    empty: `The model sent nothing back, and the answer gave no reason. On Gemini that is usually its content filter: it blocks the reply and returns an empty one. ${GEMINI_FILTER}`,
    "thinking-open": "The reply stopped while still thinking: the output limit cut it. Raise the Safety cap (Memory → Reply length) or SillyTavern's Max Response Length. On Gemini and other models that reason before they write, that reasoning counts against the limit.",
    thinking: "The whole reply is its reasoning; the story never came. Swipe for another. If it happens often, raise the Safety cap (Memory → Reply length): the model's reasoning counts against it.",
    blocks: "The reply holds only its blocks, no story. Swipe for another.",
};
const LIMIT_BY = {
    cap: "VCRP's Safety cap (Memory → Reply length)",
    hold: "VCRP's Hold each reply to the target (Memory → Reply length)",
    "": "SillyTavern's Max Response Length (AI Response Configuration)",
};
const n = v => Number(v).toLocaleString("en-US");

/**
 * Why a blank reply is blank, for the reader: from the answer's own stop reason when it was
 * read (generationTrace.js, msg.extra.vcrp_finish), else from the reply's shape. Pure.
 */
export function blankReplyWhy(kind, stamp) {
    const f = stamp && stamp.done ? stamp : null;
    if (f && f.reason === "length") {
        const by = LIMIT_BY[f.limitBy] || LIMIT_BY[""];
        const wrote = f.usage && f.usage.out ? ` It wrote ${n(f.usage.out)} tokens${f.usage.reasoning ? `, ${n(f.usage.reasoning)} of them reasoning,` : ""} and the story never came.` : "";
        const fix = f.limitBy === "cap" ? "Raise the Safety cap, or set it to 0 (off)."
            : f.limitBy === "hold" ? "Swipe for another; if it happens often, raise the target, or set a Safety cap of 4,000 or more."
                : "Raise Max Response Length in AI Response Configuration.";
        return `The request's output limit stopped it: ${f.limit ? `${n(f.limit)} tokens, set by ${by}` : by}.${wrote} On a model that reasons before it writes, that reasoning counts against the limit. ${fix}`;
    }
    if (f && f.reason === "filter") return `The provider stopped the reply (${f.native || "content filter"}) and sent back nothing. ${GEMINI_FILTER}`;
    if (f && (f.reason === "error" || f.error)) return `The request failed on the provider's side${f.error ? `: ${f.error}` : ""}. Swipe for another; if it keeps failing, check the model and the provider in AI Response Configuration.`;
    if (f && f.reason === "stop" && kind === "empty") return `The model ended its turn with nothing written and gave no reason. On Gemini that is its content filter at work more often than not. ${GEMINI_FILTER}`;
    if (f && f.reason === "stop" && kind === "thinking") return "The whole reply is its reasoning: the model ended its turn before the story came. Swipe for another. If it happens often on Gemini 4, turn Chain of Thought off (Presets & CoT): it reasons on its own, and Megumin Suite's Gemini loadout keeps custom thinking off there.";
    return WHY[kind];
}

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
    if (typeof toastr !== "undefined") toastr.warning(blankReplyWhy(kind, msg.extra && msg.extra.vcrp_finish), "VCRP: an empty reply", { timeOut: 14000, extendedTimeOut: 6000 });
}
