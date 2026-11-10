// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply that came back blank.
//
// A reply can come back with no story for several reasons, and they call for different
// things: the provider's content filter declined the request (its decision: VCRP reports it
// and leaves the request as it is), the output limit stopped the model while it was still
// reasoning (a setting to raise), the request failed on the provider's side, or the model
// simply ended its turn with nothing written. A model that wrote the whole reply inside its
// thinking, or only its blocks, shows an empty story too. Each is told apart and said once,
// as the reply arrives, from the answer's own stop reason when it was read
// (generationTrace.js). The handlers after this one leave such a reply alone: its size is
// not measured (it would drag the average reply down, and with it the room every reply is
// given), the one-shot direction stays for the swipe, no rolls note is added to it, no
// blocks are asked for.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, extension_settings, isGenerating } from "../st.js";
import { extensionName } from "../core/constants.js";

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

// What a blank reply's shape alone says, when the answer's stop reason was not read:
// [what happened, what to do].
const WHY = {
    empty: ["The model sent nothing back, and the answer gave no reason.", "Swipe for another. Setup Check (Global Settings) lists how the last replies ended."],
    "thinking-open": ["The reply stopped while still thinking: the output limit cut it. On Gemini and other models that reason before they write, that reasoning counts against the limit.", "Raise the Safety cap (Memory → Reply length) or SillyTavern's Max Response Length."],
    thinking: ["The whole reply is its reasoning; the story never came.", "Swipe for another."],
    blocks: ["The reply holds only its blocks, no story.", "Swipe for another."],
};
const LIMIT_BY = {
    cap: "VCRP's Safety cap (Memory → Reply length)",
    hold: "VCRP's Hold each reply to the target (Memory → Reply length)",
    "": "SillyTavern's Max Response Length (AI Response Configuration)",
};
const n = v => Number(v).toLocaleString("en-US");

/**
 * A blank reply explained: { cause, advice }, from the answer's own stop reason when it was
 * read (generationTrace.js, msg.extra.vcrp_finish), else from the reply's shape. Pure.
 */
export function explainBlankReply(kind, stamp) {
    const f = stamp && stamp.done ? stamp : null;
    const via = f && f.provider ? ` (served by ${f.provider})` : "";
    if (f && f.reason === "length") {
        const by = LIMIT_BY[f.limitBy] || LIMIT_BY[""];
        const wrote = f.usage && f.usage.out ? ` It wrote ${n(f.usage.out)} tokens${f.usage.reasoning ? `, ${n(f.usage.reasoning)} of them reasoning,` : ""} and the story never came.` : "";
        const advice = f.limitBy === "cap" ? "Raise the Safety cap, or set it to 0 (off)."
            : f.limitBy === "hold" ? "Swipe for another; if it happens often, raise the target."
                : "Raise Max Response Length in AI Response Configuration.";
        return { cause: `The request's output limit stopped it: ${f.limit ? `${n(f.limit)} tokens, set by ${by}` : by}.${wrote} On a model that reasons before it writes, that reasoning counts against the limit.`, advice };
    }
    if (f && f.reason === "filter") return { cause: `The provider's content filter stopped this reply (${f.native || "content filter"})${via} and sent back nothing.`, advice: "That decision is the provider's: VCRP sent the request as it was, and does not retry or change it." };
    if (f && (f.reason === "error" || f.error)) return { cause: `The request failed on the provider's side${f.error ? `: ${f.error}` : ""}${via}.`, advice: "Swipe for another; if it keeps failing, check the model and the provider in AI Response Configuration." };
    if (f && f.reason === "stop" && kind === "empty") return { cause: `The model ended its turn with nothing written, and the provider gave no reason${via}.`, advice: "Swipe for another." };
    if (f && f.reason === "stop" && kind === "thinking") return { cause: "The whole reply is inside its thinking: the model ended its turn with nothing after it. If it wrote the story, it wrote it in there.", advice: "Open the thinking to read it, or swipe for another. If it happens often on a model that reasons on its own (Gemini 4), turn Chain of Thought off (Presets & CoT): asked to think aloud as well, it can put the whole reply in the thinking." };
    if (f && f.reason === "stop" && kind === "thinking-open") return { cause: "The reply ended on its own without closing its thinking: everything it wrote, the story too if there is one, sits inside the open <think>.", advice: "Read it there, or swipe for another. If it happens often on a model that reasons on its own (Gemini 4), turn Chain of Thought off (Presets & CoT)." };
    const [cause, advice] = WHY[kind] || WHY.empty;
    return { cause, advice };
}

/** The same, as one text: what happened, then what to do. */
export function blankReplyWhy(kind, stamp) {
    const { cause, advice } = explainBlankReply(kind, stamp);
    return `${cause} ${advice}`.trim();
}

// ── One plain retry, for a reply nothing explains ────────────────────────────
// SillyTavern's own Auto-swipe never retries an empty reply (its filter passes an empty
// text on purpose, so a broken API cannot loop it). VCRP swipes once for a reply that came
// back with no story and no reason: the same request, sent again, as swiping by hand would.
// Not when the provider's filter declined it (that is an answer, not a failure) and not when
// a limit stopped it (the same limit would stop it again): those are said, and left to the
// reader. Never a second time for one message (SillyTavern starts the new swipe with the
// last one's extras, so the mark below travels with it), never while something is
// generating. Off in Global Settings.

const RETRY_MS = 700;
const RETRY_KINDS = new Set(["empty", "thinking"]);

/** The switch (Global Settings), on unless turned off. */
export function blankRetryOn() {
    const gs = extension_settings[extensionName] && extension_settings[extensionName].globalSettings;
    return !gs || gs.blankRetry !== false;
}

/** Would this blank reply be retried? Pure: the kind, the message, its place, its stamp. */
export function blankRetryWanted(kind, msg, index, chat) {
    if (!msg || !Array.isArray(chat)) return false;
    if (index !== chat.length - 1) return false;
    if (msg.extra && msg.extra.vcrp_blank_retry) return false;
    const f = msg.extra && msg.extra.vcrp_finish;
    const read = f && f.done ? f : null;
    // Thinking left open: a limit's doing unless the answer says the model ended on its own.
    if (kind === "thinking-open") return Boolean(read) && read.reason === "stop";
    if (!RETRY_KINDS.has(kind)) return false;
    if (!read) return true;                                // the answer was not read: nothing says why
    return read.reason === "stop" || read.reason === "error" || !read.reason;   // not a filter's decision, not a limit
}

/**
 * Swipes right on the last message, the way SillyTavern's own auto-swipe does where the
 * context offers it; the plain right swipe, or the swipe button itself, on a SillyTavern
 * that does not. Resolves true when a swipe was started.
 */
export async function swipeForAnother(id) {
    const ctx = getContext() || {};
    const chat = ctx.chat || [];
    const msg = chat[id];
    if (!msg || id !== chat.length - 1 || !blankReplyKind(msg.mes)) return false;
    if (typeof isGenerating === "function" && isGenerating()) return false;
    const sw = ctx.swipe;
    try {
        if (sw && typeof sw.to === "function") { await sw.to(null, "right", { source: "auto_swipe", repeated: true, forceMesId: id }); return true; }
        if (sw && typeof sw.right === "function") { await sw.right(); return true; }
        const btn = typeof document !== "undefined" ? document.querySelector("#chat .mes.last_mes .swipe_right") : null;
        if (btn && typeof btn.click === "function") { btn.click(); return true; }
    } catch (e) { console.warn("[VCRP] Empty reply: could not swipe for another", e); }
    return false;
}

/** MESSAGE_RECEIVED: a blank reply is said, with why and what to do; one that nothing explains is retried once. */
export function vcrpBlankOnReply(messageId, type) {
    if (type === "first_message") return;
    const chat = ((getContext() || {}).chat) || [];
    const id = Number(messageId);
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return;
    let kind = blankReplyKind(msg.mes);
    if (!kind) return;
    // SillyTavern may have moved the model's reasoning into its own box: an empty story with
    // reasoning beside it is a reply that was all reasoning.
    if (kind === "empty" && msg.extra && String(msg.extra.reasoning || "").trim()) kind = "thinking";
    // One cut off by the length limit while thinking was already said (replyCut.js).
    if (kind === "thinking-open" && msg.extra && msg.extra.vcrp_cut === "thinking") return;
    const { cause, advice } = explainBlankReply(kind, msg.extra && msg.extra.vcrp_finish);
    const say = (text, title, level = "warning") => { if (typeof toastr !== "undefined") toastr[level](text, title, { timeOut: 14000, extendedTimeOut: 6000 }); };
    if (blankRetryOn() && blankRetryWanted(kind, msg, id, chat)) {
        msg.extra = { ...(msg.extra || {}), vcrp_blank_retry: 1 };
        say(`${cause} VCRP sends the same request once more by itself.`, "VCRP: an empty reply, retrying", "info");
        setTimeout(async () => {
            let started = false;
            try { started = await swipeForAnother(id); } catch (e) { started = false; }
            if (!started) say("VCRP could not swipe by itself here (this SillyTavern offers no way to, or something else is generating). Swipe for another yourself.", "VCRP: an empty reply");
        }, RETRY_MS);
        return;
    }
    const retried = msg.extra && msg.extra.vcrp_blank_retry ? "VCRP sent the request a second time already. " : "";
    say(`${retried}${cause} ${advice}`.trim(), "VCRP: an empty reply");
}
