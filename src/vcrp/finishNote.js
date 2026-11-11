// ─────────────────────────────────────────────────────────────────────────────
// VCRP: how a reply ended, kept under the reply itself.
//
// A toast is gone in seconds, and the question "why did this come back empty?" is asked
// later. So a reply that did not end normally carries a small line under it, drawn from what
// was read of its answer and kept with the message (generationTrace.js): no reply because the
// output limit was used up, because the model ended its turn with nothing or only reasoned,
// because the stream closed or the connection broke, because it was stopped, because the
// request failed, or because the API's answer names a content-policy stop; or a reply with
// text that one of those cut short. Tap it for the details, in the API's own words: the stop
// reason as given, who served the request, what was written and read, the limit and what set
// it, how long it took and how much of what arrived was reply text. A reply that ended on its
// own with its story has none.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { blankKindOf, blankReplyWhy, spell, apiWords, HOW_TO_CHECK, QUIET_MS } from "./blankReply.js";

const NOTE = "vcrp-finish-note";
const LIMIT_BY = { cap: "VCRP's Safety cap", hold: "VCRP's Hold each reply to the target", "": "SillyTavern's Max Response Length" };
const k = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
const ENDED = { closed: "the stream closed with no stop reason and no end marker", abort: "stopped on this side", error: "the connection broke" };

/** The numbers of a stamp, as one line ("" with none). */
export function finishNumbers(f) {
    if (!f) return "";
    const bits = [];
    const words = apiWords(f);
    if (words) bits.push(`stop reason as the API gave it: ${words}`);
    if (ENDED[f.ended]) bits.push(ENDED[f.ended]);
    if (f.provider) bits.push(`served by ${f.provider}`);
    if (f.model) bits.push(f.model);
    if (f.usage && typeof f.usage.out === "number") bits.push(`wrote ${k(f.usage.out)} tokens${f.usage.reasoning ? ` (${k(f.usage.reasoning)} of them reasoning)` : ""}`);
    if (f.usage && f.usage.input) bits.push(`read ${k(f.usage.input)}${f.usage.cached ? ` (${k(f.usage.cached)} from the cache)` : ""}`);
    if (f.limit) bits.push(`limit ${k(f.limit)}, from ${LIMIT_BY[f.limitBy] || LIMIT_BY[""]}`);
    if (typeof f.ms === "number") bits.push(`took ${spell(f.ms)}${typeof f.firstMs === "number" ? ` (first text or reasoning after ${spell(f.firstMs)})` : ""}`);
    if (typeof f.text === "number" && typeof f.ms === "number") bits.push(`${k(f.text)} characters of reply and ${k(f.think || 0)} of reasoning arrived`);
    if (f.genId) bits.push(f.genId);
    return bits.join(" · ");
}

/**
 * What to say under a reply about how it ended: { short, detail, level }, or null for a
 * reply that ended on its own with its story (and for anything that is not a reply). Pure.
 */
export function finishNoteFor(msg) {
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return null;
    const f = msg.extra && msg.extra.vcrp_finish && msg.extra.vcrp_finish.done ? msg.extra.vcrp_finish : null;
    const { kind, own } = blankKindOf(msg);
    const stopped = f && (f.reason === "filter" || f.reason === "length" || f.reason === "error" || f.reason === "other" || Boolean(f.error));
    if (!kind && !stopped) return null;
    const numbers = finishNumbers(f);
    const withNumbers = text => (numbers ? `${text}\n${numbers}` : text);
    const limit = f && f.limit ? ` (${k(f.limit)}, ${LIMIT_BY[f.limitBy] || LIMIT_BY[""]})` : "";
    if (kind) {
        const short = !f ? "No reply came back (no stop reason was recorded)."
            : f.ended === "abort" ? `No reply: it was stopped ${f.quietMs >= QUIET_MS ? `after nothing had arrived for ${spell(f.quietMs)}` : "before anything was written"}.`
                : f.reason === "length" ? `No reply: the output limit${limit} was used up before the story.`
                    : f.reason === "filter" ? `No reply: the API's answer names a content-policy stop (${f.native || "content filter"}).`
                        : f.reason === "tool" ? `No reply: the model ended in a tool call instead (${f.native || "tool call"}).`
                            : f.reason === "other" ? `No reply: the provider ended it with no reason given (its word: ${f.native || "none"}).`
                                : f.ended === "error" ? "No reply: the connection broke before the end."
                                    : f.reason === "error" || f.error ? `No reply: the request failed${f.error ? ` (${String(f.error).slice(0, 80)})` : ""}.`
                                        : f.ended === "closed" ? "No reply: the stream closed before the model had finished."
                                            : kind === "thinking" ? (own ? "No story: the reply is all thinking." : "No reply: the model reasoned and wrote nothing.")
                                                : kind === "thinking-open" ? "No story after the thinking: the reply never closed its <think>."
                                                    : kind === "blocks" ? "No story: the reply holds only its blocks."
                                                        : f.text > 0 ? "No reply: its text arrived, and something here took it out."
                                                            : "No reply: the model ended its turn with nothing written.";
        const why = blankReplyWhy(kind, f, { own });
        return { short, detail: withNumbers(f && f.reason === "filter" ? `${why} ${HOW_TO_CHECK}` : why), level: "blank" };
    }
    const short = f.reason === "filter" ? `Cut short: the API's answer names a content-policy stop (${f.native || "content filter"}).`
        : f.reason === "length" ? `Cut short by the output limit${limit}.`
            : f.reason === "other" ? `The provider ended this reply with no reason given (its word: ${f.native || "none"}): it may be cut short.`
                : `The request ended with an error${f.error ? ` (${String(f.error).slice(0, 80)})` : ""}.`;
    const detail = f.reason === "filter" ? `The API's answer names a content-policy stop partway through this reply. That decision is the provider's: VCRP sent the request as it was. ${HOW_TO_CHECK}`
        : f.reason === "length" ? "The request's output limit stopped this reply partway. Continue writes the rest; raise the limit named below if it happens often."
            : f.reason === "other" ? "The provider ended this reply without a reason of its own; it may be incomplete. Continue writes on from where it stops."
                : "The request ended with an error on the provider's side; the reply may be incomplete.";
    return { short, detail: withNumbers(detail), level: "cut" };
}

/** Draws (or takes away) the line under message `id`. */
export function drawFinishNote(id, doc = typeof document !== "undefined" ? document : null) {
    const el = doc && doc.querySelector(`#chat .mes[mesid="${id}"]`);
    if (!el) return;
    const old = el.querySelector(`.${NOTE}`);
    const msg = (((getContext() || {}).chat) || [])[Number(id)];
    const note = finishNoteFor(msg);
    if (!note) { if (old) old.remove(); return; }
    const line = old || doc.createElement("div");
    line.className = `${NOTE} ${note.level}`;
    line.textContent = `⚠ ${note.short} Tap for details.`;
    line.title = note.detail;
    if (!old) {
        line.addEventListener("click", e => {
            e.stopPropagation();
            if (typeof toastr !== "undefined") toastr.info(String(line.title).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"), "VCRP: how this reply ended", { timeOut: 15000, extendedTimeOut: 8000, escapeHtml: false });
        });
        const host = el.querySelector(".mes_block") || el;
        host.appendChild(line);
    }
}

/** Every message on screen (a chat opened, more loaded). */
export function drawAllFinishNotes(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    doc.querySelectorAll("#chat .mes[mesid]").forEach(el => drawFinishNote(el.getAttribute("mesid"), doc));
}
