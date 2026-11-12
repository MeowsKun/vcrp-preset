// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply that came back blank.
//
// A reply can come back with no story for several reasons, and they call for different
// things: the output limit stopped the model while it was still reasoning (a setting to
// raise), the model ended its turn with nothing written, or reasoned and never wrote, the
// connection to the provider dropped or the stream closed before the model had finished, the
// reader stopped it, the request failed on the provider's side, or the API's answer names a
// content-policy stop (the provider's decision: VCRP reports it, in the API's own words, and
// leaves the request as it is). A model that wrote the whole reply inside its thinking, or
// only its blocks, shows an empty story too. Each is told apart and said once, as the reply
// arrives, from the answer itself when it was read (generationTrace.js): the stop reason, how
// the stream ended, how long it took and how much of it was reply text. The handlers after
// this one leave such a reply alone: its size is not measured (it would drag the average
// reply down, and with it the room every reply is given), the one-shot direction stays for
// the swipe, no rolls note is added to it, no blocks are asked for.
//
// (A reply SillyTavern's Reasoning Auto-Parse moved whole into the Thinking box is not blank:
// replyRescue.js puts it back before this runs.)
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, extension_settings, isGenerating } from "../st.js";
import { extensionName } from "../core/constants.js";
import { stallRetryAsked } from "./streamStall.js";

const THINK_OPEN = /<think(?:ing)?\b[^>]*>/i;
const THINK_CLOSE = /<\/think(?:ing)?\s*>/gi;

/**
 * How a reply is blank: "empty" (nothing, or SillyTavern's "..." placeholder),
 * "thinking-open" (stopped inside its thinking), "thinking" (the thinking closed and nothing
 * after it), "blocks" (blocks and no story), or null for a reply with a story.
 */
export function blankReplyKind(text) {
    const s = String(text || "");
    if (!s.trim() || s.trim() === "...") return "empty";
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

/**
 * A message's blank kind, with whose thinking it is: { kind, own }. An empty message with
 * reasoning beside it is a reply that was all reasoning; `own` says that reasoning is the
 * reply's own text (written in <think>, or parsed out of the reply by SillyTavern) as against
 * the reasoning a provider sends beside a reply, which holds no story.
 */
export function blankKindOf(msg) {
    let kind = blankReplyKind(msg && msg.mes);
    let own = kind === "thinking" || kind === "thinking-open";
    const x = (msg && msg.extra) || {};
    if (kind === "empty" && String(x.reasoning || "").trim()) { kind = "thinking"; own = x.reasoning_type === "parsed"; }
    return { kind, own };
}

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
    ceiling: "VCRP's ceiling per reply (Memory → Reply length)",
    hold: "VCRP's Hold each reply to the target (as it was before 10.0.0-vcrp.18)",
    "": "SillyTavern's Max Response Length (AI Response Configuration)",
};
const n = v => Number(v).toLocaleString("en-US");
/** A time for reading: "42 s", "1 min 12 s". */
export const spell = ms => { const s = Math.max(0, Math.round(Number(ms) / 1000)); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
/** The API's own words for a stop: finish_reason "content_filter", the provider's own word "PROHIBITED_CONTENT". */
export const apiWords = f => (!f ? "" : f.raw && f.native ? `finish_reason "${f.raw}", the provider's own word "${f.native}"` : f.native ? `"${f.native}"` : "");
// A stream silent for this long when it was stopped is worth a word: a connection that dropped
// looks exactly like this from the page.
export const QUIET_MS = 45000;
/** How to check a stop reason by hand (SillyTavern's terminal prints nothing of a streamed answer). */
export const HOW_TO_CHECK = "To see it for yourself: SillyTavern's terminal prints nothing of a streamed answer (only \"Streaming request in progress\" and \"finished\"); with Streaming off (AI Response Configuration) it prints the whole answer, stop reason included.";

/**
 * A blank reply explained: { cause, advice }, from the answer itself when it was read
 * (generationTrace.js, msg.extra.vcrp_finish), else from the reply's shape. `own`: a "thinking"
 * reply's thinking is the reply's own text (see blankKindOf). Pure.
 */
export function explainBlankReply(kind, stamp, { own = true } = {}) {
    const f = stamp && stamp.done ? stamp : null;
    const via = f && f.provider ? ` (served by ${f.provider})` : "";
    const took = f && f.ms >= 1000 ? ` after ${spell(f.ms)}` : "";
    if (f && f.ended === "abort") {
        const quiet = f.quietMs >= QUIET_MS ? `: nothing had arrived for ${spell(f.quietMs)}, so the connection to the provider may have dropped (SillyTavern does not notice a dropped one, and goes on waiting)` : "";
        return { cause: `It was stopped${took} before any story was written${quiet}.`, advice: "Swipe for another." };
    }
    if (f && f.reason === "length") {
        const by = LIMIT_BY[f.limitBy] || LIMIT_BY[""];
        const wrote = f.usage && f.usage.out ? ` It wrote ${n(f.usage.out)} tokens${f.usage.reasoning ? `, ${n(f.usage.reasoning)} of them reasoning,` : ""} and the story never came.` : "";
        const advice = f.limitBy === "cap" ? "Raise the Safety cap, or set it to 0 (off)."
            : f.limitBy === "ceiling" ? "Its prompt left little room under the ceiling: cut the prompt down (Memory → Summarize now, Cut now), or raise the ceiling."
                : f.limitBy === "hold" ? "Swipe for another. (Since 10.0.0-vcrp.18 the target no longer limits a reply.)"
                : "Raise Max Response Length in AI Response Configuration.";
        return { cause: `The request's output limit stopped it${took}: ${f.limit ? `${n(f.limit)} tokens, set by ${by}` : by}.${wrote} On a model that reasons before it writes, that reasoning counts against the limit.`, advice };
    }
    if (f && f.reason === "filter") return { cause: `The API's answer names a content-policy stop for this reply (${apiWords(f) || "content filter"})${via}, and nothing was written.`, advice: "That decision is the provider's: VCRP sent the request as it was, and does not send it again or change it." };
    if (f && f.reason === "tool") return { cause: `The model ended its reply with a tool call (${f.native || "tool call"}) on a request that offers no tools, instead of writing${via}: a slip of the model's.`, advice: "Swipe for another." };
    if (f && f.reason === "other") return { cause: `The provider ended the reply${took} with nothing written, and its only word for why is "${f.native || "none"}"${via}: no reason given.`, advice: "Swipe for another; VCRP does not send this one again by itself." };
    if (f && f.ended === "error") return { cause: `The connection broke${took}, before the reply had ended${f.error ? `: ${f.error}` : ""}.`, advice: "Swipe for another." };
    if (f && (f.reason === "error" || f.error)) return { cause: `The request failed on the provider's side${f.error ? `: ${f.error}` : ""}${via}.`, advice: "Swipe for another; if it keeps failing, check the model and the provider in AI Response Configuration." };
    if (f && f.ended === "closed") return { cause: `The stream ended${took} with no stop reason and no end marker: the connection closed before the model had finished${via}.`, advice: "Swipe for another." };
    if (f && f.reason === "stop" && kind === "empty") {
        if (f.text > 0) return { cause: `The reply's text arrived (${n(f.text)} characters) and the message is empty all the same: something in SillyTavern took it out after it arrived (a regex script that runs on AI output, or another extension).`, advice: "Look in Extensions → Regex for a script that removes it; swipe for another." };
        const reasoned = f.usage && f.usage.reasoning ? ` after ${n(f.usage.reasoning)} tokens of reasoning` : "";
        return { cause: `The model ended its turn${reasoned} with nothing written, and the provider gave no reason${via}.`, advice: "Swipe for another." };
    }
    if (f && f.reason === "stop" && kind === "thinking" && !own) {
        const reasoned = f.usage && f.usage.reasoning ? ` (${n(f.usage.reasoning)} tokens)` : "";
        return { cause: `The model reasoned${reasoned} and ended its turn without writing the reply${via}. The Thinking box holds that reasoning, not a story.`, advice: "Swipe for another." };
    }
    if (f && f.reason === "stop" && kind === "thinking") return { cause: "The whole reply is inside its thinking: nothing follows the closing tag. If it wrote the story, it wrote it in there.", advice: "Open the thinking to read it, or swipe for another. If it happens often on a model that reasons on its own (Gemini 4), turn Chain of Thought off (Presets & CoT): asked to think aloud as well, it can put the whole reply in the thinking." };
    if (f && f.reason === "stop" && kind === "thinking-open") return { cause: "The reply ended on its own without closing its thinking: everything it wrote, the story too if there is one, sits inside the open <think>.", advice: "Read it there, or swipe for another. If it happens often on a model that reasons on its own (Gemini 4), turn Chain of Thought off (Presets & CoT)." };
    if (f && f.reason === "unknown" && kind === "empty") return { cause: `The reply ended${took} with nothing written; the answer's word for why is "${f.native}"${via}.`, advice: "Swipe for another." };
    const [cause, advice] = WHY[kind] || WHY.empty;
    return { cause, advice };
}

/** The same, as one text: what happened, then what to do. */
export function blankReplyWhy(kind, stamp, opts) {
    const { cause, advice } = explainBlankReply(kind, stamp, opts);
    return `${cause} ${advice}`.trim();
}

// ── One plain retry, for a reply nothing explains ────────────────────────────
// SillyTavern's own Auto-swipe never retries an empty reply (its filter passes an empty
// text on purpose, so a broken API cannot loop it). VCRP swipes once for a reply that came
// back with no story and no reason: the same request, sent again, as swiping by hand would.
// Not when the API's answer names a content-policy stop or gives no reason at all (said, and
// left to the reader), not when a limit stopped it (the same limit would stop it again), and
// not when the reader stopped it themselves, unless they asked for it to be sent again
// (streamStall.js). Never a second time for one message (SillyTavern starts the new swipe
// with the last one's extras, so the mark below travels with it), never while something is
// generating. Off in Global Settings.

const RETRY_MS = 700;
const RETRY_KINDS = new Set(["empty", "thinking"]);

/** The switch (Global Settings), on unless turned off. */
export function blankRetryOn() {
    const gs = extension_settings[extensionName] && extension_settings[extensionName].globalSettings;
    return !gs || gs.blankRetry !== false;
}

/**
 * Would this blank reply be retried? Pure: the kind, the message, its place, its stamp.
 * `stallRetry`: the reader asked for a stream that had gone quiet to be stopped and sent again.
 */
export function blankRetryWanted(kind, msg, index, chat, { stallRetry = false } = {}) {
    if (!msg || !Array.isArray(chat)) return false;
    if (index !== chat.length - 1) return false;
    if (msg.extra && msg.extra.vcrp_blank_retry) return false;
    const f = msg.extra && msg.extra.vcrp_finish;
    const read = f && f.done ? f : null;
    // Stopped on this side: the reader's doing, and theirs to send again.
    if (read && read.ended === "abort") return Boolean(stallRetry);
    // Thinking left open: a limit's doing unless the answer says the model ended on its own.
    if (kind === "thinking-open") return Boolean(read) && read.reason === "stop";
    if (!RETRY_KINDS.has(kind)) return false;
    if (!read) return true;                                // the answer was not read: nothing says why
    // The model ended with nothing, slipped into a tool call, the provider failed, or the stream
    // closed with no reason. Not a content-policy stop, not "no reason given", not a limit.
    return read.reason === "stop" || read.reason === "error" || read.reason === "tool" || !read.reason;
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
    const say = (text, title, level = "warning") => { if (typeof toastr !== "undefined") toastr[level](text, title, { timeOut: 14000, extendedTimeOut: 6000 }); };
    // The reader tapped "stop and send again" on a stream that had gone quiet (asked once, used once).
    const asked = stallRetryAsked();
    const { kind, own } = blankKindOf(msg);
    if (!kind) {
        if (asked) say("Stopped. What had arrived is kept as the reply: Continue it, or swipe for another.", "VCRP: stopped", "info");
        return;
    }
    // One cut off by the length limit while thinking was already said (replyCut.js).
    if (kind === "thinking-open" && msg.extra && msg.extra.vcrp_cut === "thinking") return;
    const f = msg.extra && msg.extra.vcrp_finish;
    const back = msg.extra && msg.extra.vcrp_rescued === "open" ? "SillyTavern's Reasoning Auto-Parse had put all of it in the Thinking box; VCRP put it back into the message as it came. " : "";
    const { cause, advice } = explainBlankReply(kind, f, { own });
    if (blankRetryWanted(kind, msg, id, chat, { stallRetry: asked }) && (asked || blankRetryOn())) {
        msg.extra = { ...(msg.extra || {}), vcrp_blank_retry: 1 };
        say(`${back}${cause} VCRP sends the same request once more${asked ? "" : " by itself"}.`, "VCRP: an empty reply, retrying", "info");
        setTimeout(async () => {
            let started = false;
            try { started = await swipeForAnother(id); } catch (e) { started = false; }
            if (!started) say("VCRP could not swipe by itself here (this SillyTavern offers no way to, or something else is generating). Swipe for another yourself.", "VCRP: an empty reply");
        }, RETRY_MS);
        return;
    }
    // The reader's own Stop needs no telling, unless the stream had gone quiet under them.
    if (f && f.done && f.ended === "abort" && !(f.quietMs >= QUIET_MS)) return;
    const retried = msg.extra && msg.extra.vcrp_blank_retry ? "VCRP sent the request a second time already. " : "";
    say(`${retried}${back}${cause} ${advice}`.trim(), "VCRP: an empty reply");
}
