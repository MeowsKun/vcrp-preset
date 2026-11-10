// ─────────────────────────────────────────────────────────────────────────────
// VCRP: how a reply ended, kept under the reply itself.
//
// A toast is gone in seconds, and the question "why did this come back empty?" is asked
// later. So a reply that did not end normally carries a small line under it, drawn from the
// stop reason kept with the message (generationTrace.js): no reply because the provider's
// content filter stopped it, because the output limit was used up, because the request
// failed, because the model ended its turn with nothing; or a reply with text that one of
// those cut short. Tap it for the details: who served the request, what was written and
// read, the limit and what set it. A reply that ended on its own with its story has none.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { blankReplyKind, blankReplyWhy } from "./blankReply.js";

const NOTE = "vcrp-finish-note";
const LIMIT_BY = { cap: "VCRP's Safety cap", hold: "VCRP's Hold each reply to the target", "": "SillyTavern's Max Response Length" };
const k = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** The numbers of a stamp, as one line ("" with none). */
export function finishNumbers(f) {
    if (!f) return "";
    const bits = [];
    if (f.provider) bits.push(`served by ${f.provider}`);
    if (f.model) bits.push(f.model);
    if (f.usage && typeof f.usage.out === "number") bits.push(`wrote ${k(f.usage.out)} tokens${f.usage.reasoning ? ` (${k(f.usage.reasoning)} of them reasoning)` : ""}`);
    if (f.usage && f.usage.input) bits.push(`read ${k(f.usage.input)}${f.usage.cached ? ` (${k(f.usage.cached)} from the cache)` : ""}`);
    if (f.limit) bits.push(`limit ${k(f.limit)}, from ${LIMIT_BY[f.limitBy] || LIMIT_BY[""]}`);
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
    let kind = blankReplyKind(msg.mes);
    if (kind === "empty" && msg.extra && String(msg.extra.reasoning || "").trim()) kind = "thinking";
    const stopped = f && (f.reason === "filter" || f.reason === "length" || f.reason === "error" || Boolean(f.error));
    if (!kind && !stopped) return null;
    const numbers = finishNumbers(f);
    const withNumbers = text => (numbers ? `${text}\n${numbers}` : text);
    if (kind) {
        const short = !f ? "No reply came back (no stop reason was recorded)."
            : f.reason === "filter" ? `No reply: the provider's content filter stopped it (${f.native || "content filter"}).`
                : f.reason === "length" ? `No reply: the output limit${f.limit ? ` (${k(f.limit)}, ${LIMIT_BY[f.limitBy] || LIMIT_BY[""]})` : ""} was used up before the story.`
                    : f.reason === "error" || f.error ? `No reply: the request failed${f.error ? ` (${String(f.error).slice(0, 80)})` : ""}.`
                        : kind === "thinking" ? "No story: the reply is all reasoning."
                            : kind === "blocks" ? "No story: the reply holds only its blocks."
                                : "No reply: the model ended its turn with nothing written.";
        return { short, detail: withNumbers(blankReplyWhy(kind, f)), level: "blank" };
    }
    const short = f.reason === "filter" ? `Cut short by the provider's content filter (${f.native || "content filter"}).`
        : f.reason === "length" ? `Cut short by the output limit${f.limit ? ` (${k(f.limit)}, ${LIMIT_BY[f.limitBy] || LIMIT_BY[""]})` : ""}.`
            : `The request ended with an error${f.error ? ` (${String(f.error).slice(0, 80)})` : ""}.`;
    const detail = f.reason === "filter" ? "The provider's content filter stopped this reply partway. That decision is the provider's: VCRP sent the request as it was."
        : f.reason === "length" ? "The request's output limit stopped this reply partway. Continue writes the rest; raise the limit named below if it happens often."
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
