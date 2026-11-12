// ─────────────────────────────────────────────────────────────────────────────
// VCRP: how each generation ended, from the API's own answer.
//
// SillyTavern keeps a reply's text and, when shown, its reasoning; not why the model stopped
// (the output limit, a content filter, an error on the provider's side) nor what it wrote
// (its hidden reasoning is tokens paid for and never seen). Its server prints nothing of a
// streamed answer either: "Streaming request in progress", then "Streaming request finished".
// A reply that comes back with nothing in it is then a guess. So VCRP reads the answer to each
// of SillyTavern's chat-completion requests as it passes: a copy of the response, read
// alongside the one SillyTavern reads, with the request and that copy untouched. Kept, for the
// last few: the stop reason in the API's own words, the output tokens (reasoning counted), the
// limit the request went out with, how long it took, how much of what arrived was reply text
// and how much reasoning, and how the stream itself ended (its end marker, a close with none,
// the reader's Stop, a broken connection). The reply that arrives next is stamped with it
// (msg.extra.vcrp_finish): the blank-reply note says what happened (blankReply.js), the cut
// is known for certain (replyCut.js), the cost badge and Story Memory count the output as
// billed (replyCost.js, memory/index.js), and Setup Check shows the last replies (health.js).
//
// What the answers look like: OpenRouter, OpenAI and the OpenAI-shaped sources give choices
// with finish_reason (OpenRouter adds native_finish_reason, the provider's own word) and a
// usage object; Google gives candidates with finishReason and usageMetadata; Anthropic gives
// stop_reason and usage (streamed: a message_delta event). The same reader takes a whole
// JSON answer or a stream of "data:" lines.
//
// A stream that goes quiet: SillyTavern's server does not notice a provider connection that
// dropped mid-stream (it neither ends the answer nor reports an error), so the page would wait
// forever. The silence is watched here and told to whoever asked (streamStall.js).
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpGenerationKind, vcrpGenerationRaw, vcrpStorySeq } from "./generation.js";
import { sentReplyLimit, sentReplyLimitBy } from "./replyLength.js";

export const GENERATE_PATH = "/api/backends/chat-completions/generate";
const KEEP = 12;            // generations remembered
const STAMP_WAIT_MS = 1500; // a reply's handlers wait this long, at most, for its answer to be read through
const WHOLE_MAX = 4_000_000; // a whole (unstreamed) answer is kept up to this size to be read at its end
const CONTENT_MAX = 600_000; // a reply's text is kept up to this size, until its message has been stamped

const records = [];
let installed = false;

// Which request is the story's own. Other requests reach the same endpoint: the helper
// model's (sent straight to its connection profile), another extension's raw generation.
// SillyTavern announces none of those, so by the kind of the last generation alone they
// would pass for a reply's. A story generation's request is the first one sent after that
// generation started (generation.js counts them), and never one the helper announced.
let seqTaken = 0;        // the story generation whose request has been seen
let helperUntil = 0;     // the helper said its request is the next one (until this time)
const HELPER_HINT_MS = 4000;

/** The helper model is about to send a request of its own (vcrp/helper): not a reply's. */
export function vcrpTraceHelperRequest() {
    helperUntil = Date.now() + HELPER_HINT_MS;
}

// ── Reading an answer ────────────────────────────────────────────────────────

/**
 * A provider's stop reason, in VCRP's words:
 *   "stop"    the model ended its turn
 *   "length"  the output limit
 *   "filter"  a content-policy stop, by the API's own word for one
 *   "tool"    the reply ended in a tool call (on a request that offers no tools: the model's slip)
 *   "error"   the provider failed
 *   "other"   the provider's own word for no reason given (Google's OTHER)
 *   "unknown" a word VCRP does not know
 * Only a word that names a content-policy stop is called a filter: OTHER ("unknown reason",
 * in Google's own reference) and the tool-call endings are not.
 */
export function normalizeStopReason(raw) {
    const r = String(raw || "").trim();
    if (!r) return "";
    const u = r.toUpperCase();
    if (/^(STOP|END_TURN|STOP_SEQUENCE|COMPLETED?|FINISH(ED)?|EOS)$/.test(u)) return "stop";
    if (/^(LENGTH|MAX_TOKENS|MAX_OUTPUT_TOKENS|TOKEN_LIMIT)$/.test(u)) return "length";
    if (/^(CONTENT_FILTER|SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|IMAGE_RECITATION|REFUSAL)$/.test(u)) return "filter";
    if (/^(ERROR|FAILED)$/.test(u)) return "error";
    if (/^(TOOL_CALLS?|FUNCTION_CALL|TOOL_USE|MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL|TOO_MANY_TOOL_CALLS)$/.test(u)) return "tool";
    if (/^(OTHER|FINISH_REASON_UNSPECIFIED|UNSPECIFIED|UNKNOWN|LANGUAGE|NO_IMAGE|IMAGE_OTHER|MALFORMED_RESPONSE)$/.test(u)) return "other";
    return "unknown";
}

/**
 * One stop reason out of the two OpenRouter gives: its own word (finish_reason) and the
 * provider's (native_finish_reason). Either naming a content-policy stop makes it one; else
 * the provider's own word is the more exact (MALFORMED_FUNCTION_CALL under OpenRouter's
 * "error", OTHER under its "stop"), unless that word only says the turn ended, or is unknown.
 */
export function combineStopReasons(normalized, native) {
    const a = normalizeStopReason(normalized), b = normalizeStopReason(native);
    if (!a || !b) return a || b;
    if (a === "filter" || b === "filter") return "filter";
    if (b === "unknown" || b === "stop") return a;
    return b;
}

const num = v => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const errorText = e => {
    if (!e) return "";
    if (typeof e === "string") return e;
    const m = e.message || e.error || e.detail || e.type;
    return typeof m === "string" ? m : (m && typeof m === "object" ? errorText(m) : JSON.stringify(e));
};

// One parsed object (a whole answer, or one streamed chunk) read into the record.
function readObject(obj, out) {
    if (!obj || typeof obj !== "object") return;
    // OpenRouter names the provider that served the request, and the generation's id (its
    // Activity page finds a request by it).
    if (typeof obj.provider === "string" && obj.provider) out.provider = obj.provider;
    if (typeof obj.id === "string" && obj.id && !out.genId) out.genId = obj.id;
    // SillyTavern's own refusals come as { error: true, response: "why" }.
    if (obj.error) out.error = errorText(obj.error === true ? (obj.response || obj.message || obj.detail || "the request was refused") : obj.error) || "an error with no message";
    // OpenAI-shaped (OpenRouter, OpenAI, DeepSeek, Z.AI, custom endpoints).
    const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
    if (choice && typeof choice === "object" && (choice.finish_reason || choice.native_finish_reason)) {
        const word = choice.finish_reason ? String(choice.finish_reason) : "";
        const own = choice.native_finish_reason ? String(choice.native_finish_reason) : "";
        out.native = own || word;
        out.raw = own && word && own.toLowerCase() !== word.toLowerCase() ? word : "";
        out.reason = combineStopReasons(word, own);
    }
    if (obj.usage && typeof obj.usage === "object") {
        const u = obj.usage;
        if (num(u.completion_tokens) !== null || num(u.output_tokens) !== null) {
            out.usage = out.usage || {};
            if (num(u.completion_tokens) !== null) out.usage.out = u.completion_tokens;
            if (num(u.output_tokens) !== null) out.usage.out = u.output_tokens;   // Anthropic (message_delta carries the final count)
            const det = u.completion_tokens_details;
            if (det && num(det.reasoning_tokens) !== null) out.usage.reasoning = det.reasoning_tokens;
            // The whole prompt as billed, with what of it was read from the cache and what was
            // written to it. OpenAI-shaped answers count the cached part inside prompt_tokens;
            // Anthropic's own count input_tokens beside it, so the three are added up here.
            if (num(u.prompt_tokens) !== null) out.usage.input = u.prompt_tokens;
            const pdet = u.prompt_tokens_details;
            if (pdet && num(pdet.cached_tokens) !== null) out.usage.cached = pdet.cached_tokens;
            if (pdet && num(pdet.cache_write_tokens) !== null) out.usage.written = pdet.cache_write_tokens;
            if (num(u.input_tokens) !== null) {
                const read = num(u.cache_read_input_tokens), made = num(u.cache_creation_input_tokens);
                out.usage.input = u.input_tokens + (read || 0) + (made || 0);
                if (read !== null) out.usage.cached = read;
                if (made !== null) out.usage.written = made;
            }
        }
    }
    // Anthropic: a whole message, or the streamed delta that ends it.
    if (obj.stop_reason) { out.native = String(obj.stop_reason); out.raw = ""; out.reason = normalizeStopReason(obj.stop_reason); }
    if (obj.type === "message_delta" && obj.delta && obj.delta.stop_reason) { out.native = String(obj.delta.stop_reason); out.raw = ""; out.reason = normalizeStopReason(obj.delta.stop_reason); }
    if (obj.type === "message_start" && obj.message && obj.message.usage) readObject({ usage: obj.message.usage }, out);
    if (obj.type === "error") out.error = errorText(obj.error) || "an error with no message";
    // Google.
    const cand = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
    if (cand && cand.finishReason) { out.native = String(cand.finishReason); out.raw = ""; out.reason = normalizeStopReason(cand.finishReason); }
    if (obj.promptFeedback && obj.promptFeedback.blockReason) { out.native = String(obj.promptFeedback.blockReason); out.raw = ""; out.reason = "filter"; }
    const um = obj.usageMetadata;
    if (um && typeof um === "object" && num(um.candidatesTokenCount) !== null) {
        out.usage = out.usage || {};
        out.usage.out = (um.candidatesTokenCount || 0) + (num(um.thoughtsTokenCount) || 0);
        if (num(um.thoughtsTokenCount) !== null) out.usage.reasoning = um.thoughtsTokenCount;
        if (num(um.promptTokenCount) !== null) out.usage.input = um.promptTokenCount;
        if (num(um.cachedContentTokenCount) !== null) out.usage.cached = um.cachedContentTokenCount;
    }
}

// The reply text and the reasoning in one object, as they arrived: whatever SillyTavern then
// made of them.
function replyParts(obj) {
    let text = "", think = "";
    if (!obj || typeof obj !== "object") return { text, think };
    const str = v => (typeof v === "string" ? v : "");
    const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
    if (choice && typeof choice === "object") {
        const d = choice.delta || choice.message || null;
        if (d && typeof d === "object") {
            if (Array.isArray(d.content)) d.content.forEach(p => { text += str(p && p.text); });
            else text += str(d.content);
            think += str(d.reasoning) || str(d.reasoning_content);
        }
        text += str(choice.text);
    }
    // Anthropic: streamed deltas, or a whole message.
    if (obj.type === "content_block_delta" && obj.delta) { text += str(obj.delta.text); think += str(obj.delta.thinking); }
    if (obj.role === "assistant" && Array.isArray(obj.content)) obj.content.forEach(p => { if (p && p.type === "thinking") think += str(p.thinking); else text += str(p && p.text); });
    // Google.
    const cand = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
    const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
    parts.forEach(p => { if (p && p.thought) think += str(p.text); else text += str(p && p.text); });
    return { text, think };
}

/**
 * Reads an answer as it arrives. push(text, now) takes the next piece (lines may be split
 * across pieces); result(how) gives what has been read: { reason, native, raw, usage, error,
 * provider, genId, text, think, firstMs, ended }. `how` is how the body ended: "end" (it
 * ended: "done" when a stop reason, the end marker or a whole answer was read, "closed" when
 * it ended with none), "abort" (cancelled on this side) or "error" (the connection broke).
 * `startedAt`: when the request was sent, for firstMs.
 */
export function createAnswerReader(startedAt = 0) {
    const out = { reason: "", native: "", raw: "", usage: null, error: "", provider: "", genId: "", text: 0, think: 0, firstMs: null };
    let pending = "";      // a line not finished yet
    let whole = "";        // everything, until it is clear the answer is a stream
    let content = "";      // the reply text as it arrived (kept beside the record, never with the chat)
    let stream = false, sawDone = false, parsedWhole = false;
    const take = (obj, now) => {
        readObject(obj, out);
        const part = replyParts(obj);
        if ((part.text || part.think) && out.firstMs === null && now) out.firstMs = Math.max(0, now - startedAt);
        out.text += part.text.length;
        out.think += part.think.length;
        if (part.text && content.length < CONTENT_MAX) content += part.text;
    };
    const line = (raw, now) => {
        const l = raw.trim();
        if (!l.startsWith("data:")) return;
        stream = true;
        whole = "";
        const body = l.slice(5).trim();
        if (!body) return;
        if (body === "[DONE]") { sawDone = true; return; }
        try { take(JSON.parse(body), now); } catch (e) { /* a partial or non-JSON line */ }
    };
    return {
        push(text, now = 0) {
            if (!text) return;
            if (!stream && whole.length < WHOLE_MAX) whole += text;
            pending += text;
            let i;
            while ((i = pending.indexOf("\n")) >= 0) { line(pending.slice(0, i), now); pending = pending.slice(i + 1); }
        },
        result(how = "end", now = 0) {
            if (pending.trim()) { line(pending, now); pending = ""; }
            if (!stream && !parsedWhole) {
                const s = whole.trim();
                if (s && (s[0] === "{" || s[0] === "[")) { try { take(JSON.parse(s), now); parsedWhole = true; } catch (e) { /* not a whole answer */ } }
            }
            if (!out.reason && out.error) out.reason = "error";
            const ended = how !== "end" ? how : (out.reason || sawDone || parsedWhole ? "done" : "closed");
            return { ...out, usage: out.usage ? { ...out.usage } : null, ended };
        },
        /** The reply text that arrived so far, as the model wrote it. */
        content: () => content,
    };
}

/**
 * What an answer's text says: a whole JSON answer, or a stream of "data:" lines (the last stop
 * reason and the last usage count). Pure.
 */
export function readGenerationBody(text) {
    const r = createAnswerReader(0);
    r.push(String(text || ""));
    return r.result("end");
}

// ── Watching SillyTavern's requests ──────────────────────────────────────────

// A stream that has gone quiet. OpenRouter sends comment lines on a waiting stream to keep the
// connection open (its documentation gives no interval), so a long silence there is unusual;
// elsewhere a model may reason in silence for minutes.
const STALL_MS = { openrouter: 90000 };
const STALL_MS_ELSE = 240000;
const STALL_EVERY_MS = 5000;
let stallListener = null;
let stallLimit = 0, stallEvery = STALL_EVERY_MS;

/** For tests: how long a stream may stay quiet, and how often it is looked at (0, 0 puts both back). */
export function vcrpSetStallTimes(limit = 0, every = 0) {
    stallLimit = limit > 0 ? limit : 0;
    stallEvery = every > 0 ? every : STALL_EVERY_MS;
}

/**
 * Who is told about a story's stream going quiet: fn("stall" | "resume" | "end", { quietMs,
 * source, model, at }). One listener (streamStall.js); null takes it away.
 */
export function vcrpOnStreamStall(fn) {
    stallListener = typeof fn === "function" ? fn : null;
}

const tell = (what, rec) => {
    if (!stallListener) return;
    try { stallListener(what, { quietMs: Math.max(0, Date.now() - (rec.lastByteAt || rec.at)), source: rec.source, model: rec.model, at: rec.at }); } catch (e) { /* the listener's own trouble */ }
};

function watchStall(rec) {
    if (!rec.story || !rec.stream || typeof setInterval !== "function") return;
    const limit = stallLimit || STALL_MS[rec.source] || STALL_MS_ELSE;
    rec.stallTimer = setInterval(() => {
        if (rec.done) { clearInterval(rec.stallTimer); rec.stallTimer = null; return; }
        const quiet = Date.now() - (rec.lastByteAt || rec.at);
        if (quiet >= limit && !rec.stalled) { rec.stalled = true; tell("stall", rec); }
        else if (quiet < limit && rec.stalled) { rec.stalled = false; tell("resume", rec); }
    }, stallEvery);
    if (rec.stallTimer && typeof rec.stallTimer.unref === "function") rec.stallTimer.unref();
}

function startRecord(input, init) {
    const url = typeof input === "string" ? input : (input && typeof input === "object" && typeof input.url === "string" ? input.url : "");
    if (!url || !url.includes(GENERATE_PATH)) return null;
    let body = {};
    try { body = init && typeof init.body === "string" ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    const limit = Number(body.max_tokens ?? body.max_completion_tokens) || 0;
    let kind = vcrpGenerationKind();
    let story = false;
    if (helperUntil && Date.now() <= helperUntil) { kind = "helper"; helperUntil = 0; }
    else if (kind === "reply" || kind === "continue") {
        const seq = vcrpStorySeq();
        if (seq !== seqTaken) { story = true; seqTaken = seq; }
        else kind = "other";   // a second request under the same story generation: someone else's
    }
    const rec = {
        at: Date.now(), kind, story, raw: "", gen: vcrpGenerationRaw(),
        model: String(body.model || ""), source: String(body.chat_completion_source || ""), stream: body.stream === true,
        limit, limitBy: limit && limit === sentReplyLimit() ? sentReplyLimitBy() : "",
        status: 0, reason: "", native: "", usage: null, error: "", provider: "", genId: "",
        text: 0, think: 0, firstMs: null, ms: null, quietMs: null, ended: "", lastByteAt: 0, stalled: false, stallTimer: null,
        done: false, stamped: false, waiters: [],
    };
    records.push(rec);
    while (records.length > KEEP) records.shift();
    return rec;
}

function finish(rec, read) {
    Object.assign(rec, read);
    const now = Date.now();
    rec.ms = Math.max(0, now - rec.at);
    rec.quietMs = Math.max(0, now - (rec.lastByteAt || rec.at));   // how long nothing had arrived when it ended
    // A refused request (SillyTavern's or the provider's HTTP error) with no word of why.
    if (rec.status >= 400 && !rec.error) rec.error = `the request was refused (HTTP ${rec.status})`;
    if (!rec.reason && rec.error) rec.reason = "error";
    if (!rec.ended) rec.ended = rec.error ? "error" : "done";
    rec.done = true;
    if (rec.stallTimer) { clearInterval(rec.stallTimer); rec.stallTimer = null; }
    if (rec.stalled) { rec.stalled = false; tell("end", rec); }
    const w = rec.waiters; rec.waiters = [];
    w.forEach(fn => { try { fn(); } catch (e) { /* a waiter's own trouble */ } });
}

const isAbort = e => Boolean(e) && (e.name === "AbortError" || /\babort/i.test(String(e.message || e)));

function watch(rec, res) {
    rec.status = Number(res && res.status) || 0;
    let clone;
    try { clone = res.clone(); } catch (e) { finish(rec, { error: "the answer could not be read alongside", ended: "error" }); return; }
    const reader = createAnswerReader(rec.at);
    const end = how => { const read = reader.result(how, Date.now()); rec.content = reader.content(); return read; };
    // The reader's Stop cancels the request: not an error, and what was read until then stands.
    const broke = e => {
        const read = end(isAbort(e) ? "abort" : "error");
        if (read.ended === "error" && !read.error) read.error = `the connection broke before the end${e && e.message ? ` (${e.message})` : ""}`;
        finish(rec, read);
    };
    const body = clone.body;
    if (!body || typeof body.getReader !== "function" || typeof TextDecoder === "undefined") {
        clone.text().then(t => { reader.push(t, Date.now()); finish(rec, end("end")); }, broke);
        return;
    }
    const stream = body.getReader();
    const decoder = new TextDecoder();
    const pump = () => stream.read().then(({ done, value }) => {
        const now = Date.now();
        if (done) { reader.push(decoder.decode(), now); finish(rec, end("end")); return null; }
        if (value && value.length) rec.lastByteAt = now;
        reader.push(decoder.decode(value, { stream: true }), now);
        return pump();
    });
    pump().catch(broke);
}

/**
 * Wraps fetch once so every chat-completion request's answer is read as it passes. The
 * request goes out as it is, the promise SillyTavern gets is the same one, and only a copy
 * of the response is read. Returns true the first time it installs.
 */
export function vcrpInstallGenerationTrace(scope = globalThis) {
    if (installed || !scope || typeof scope.fetch !== "function") return false;
    const orig = scope.fetch;
    scope.fetch = function vcrpTracedFetch(input, init) {
        const result = orig.apply(this, arguments);
        let rec = null;
        try { rec = startRecord(input, init); } catch (e) { rec = null; }
        if (rec && result && typeof result.then === "function") {
            try { watchStall(rec); } catch (e) { /* no timers here */ }
            result.then(res => { try { watch(rec, res); } catch (e) { finish(rec, { error: "the answer could not be read alongside", ended: "error" }); } },
                err => finish(rec, isAbort(err) ? { ended: "abort" } : { error: errorText(err) || "the request failed", ended: "error" }));
        }
        return result;
    };
    installed = true;
    return true;
}

/** For tests: the wrapper installs again on a fresh scope. */
export function vcrpResetGenerationTrace() {
    installed = false;
    records.forEach(r => { if (r.stallTimer) { clearInterval(r.stallTimer); r.stallTimer = null; } });
    records.length = 0;
    seqTaken = 0;
    helperUntil = 0;
    vcrpSetStallTimes(0, 0);
}

const plain = r => ({ ...r, waiters: undefined, stallTimer: undefined, content: undefined });

// The text of the reply stamped last, as the model sent it: for the handler that puts a reply
// back when SillyTavern left its message empty (replyRescue.js). Kept until it is asked for.
let arrived = null;

/**
 * The reply text that arrived for message `messageId`, as the model wrote it (before
 * SillyTavern parsed, trimmed or moved any of it), or null when its answer was not read
 * through. Given once: the text is let go of after.
 */
export function vcrpArrivedText(messageId) {
    const a = arrived;
    arrived = null;
    return a && a.id === Number(messageId) ? a.text : null;
}

/** The generations remembered, oldest first (copies). */
export function vcrpGenerationRecords() {
    return records.map(plain);
}

/** The latest generation of one of `kinds` ("reply", "continue", "impersonate", "quiet"), or null. */
export function vcrpLastGeneration(kinds = ["reply", "continue"]) {
    for (let i = records.length - 1; i >= 0; i--) if (kinds.includes(records[i].kind)) return plain(records[i]);
    return null;
}

const whenDone = (rec, ms) => new Promise(resolve => {
    if (rec.done) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    rec.waiters.push(() => { clearTimeout(t); resolve(); });
});

/**
 * What a reply is stamped with: the record's facts, without its machinery.
 *   reason / native / raw   VCRP's word for the stop; the provider's own; OpenRouter's, when it differs
 *   ended                   "done" | "closed" (the stream ended with no stop reason and no end marker)
 *                           | "abort" (stopped on this side) | "error" (the connection broke)
 *   ms / firstMs / quietMs  the whole request; until the first reply text or reasoning; how long
 *                           nothing had arrived when it ended
 *   text / think            characters of reply text and of reasoning that arrived
 */
export function finishStamp(rec) {
    return {
        done: !!rec.done, reason: rec.reason || "", native: rec.native || "", raw: rec.raw || "", error: rec.error || "", status: rec.status || 0,
        limit: rec.limit || 0, limitBy: rec.limitBy || "", model: rec.model || "", at: rec.at,
        provider: rec.provider || "", genId: rec.genId || "",
        usage: rec.usage ? { ...rec.usage } : null,
        ended: rec.ended || "", ms: num(rec.ms), firstMs: num(rec.firstMs), quietMs: num(rec.quietMs),
        text: rec.text || 0, think: rec.think || 0,
    };
}

/**
 * MESSAGE_RECEIVED, before the handlers that read the reply: the reply is stamped with how
 * its generation ended (msg.extra.vcrp_finish). Waits a moment, if need be, for the answer
 * to be read through; the handlers after this one then see the whole of it.
 */
export async function vcrpFinishOnReply(messageId, type) {
    if (type === "first_message") return;
    const chat = ((getContext() || {}).chat) || [];
    const msg = chat[Number(messageId)];
    if (!msg || msg.is_user || msg.is_system) return;
    // SillyTavern starts a new swipe with a copy of the last one's extras: how THAT one ended
    // (and whether it was cut, or put back) is not this reply's. A Continue adds to a reply and
    // keeps its marks.
    if (type !== "continue" && msg.extra) {
        delete msg.extra.vcrp_finish;
        delete msg.extra.vcrp_cut;
        delete msg.extra.vcrp_rescued;
        delete msg.extra.vcrp_continuity;   // what the last swipe was found to contradict
    }
    arrived = null;
    let rec = null;
    for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        if (r.story && !r.stamped) { rec = r; break; }
    }
    if (!rec) return;
    rec.stamped = true;
    await whenDone(rec, STAMP_WAIT_MS);
    const stamp = finishStamp(rec);
    // What the model sent, for the handler after this one; only an answer read to its end counts.
    arrived = { id: Number(messageId), text: rec.done && typeof rec.content === "string" ? rec.content : null };
    rec.content = undefined;
    msg.extra = { ...(msg.extra || {}), vcrp_finish: stamp };
    // With the swipe too: SillyTavern puts a swipe's own extras back when it is shown again.
    const info = Array.isArray(msg.swipe_info) && typeof msg.swipe_id === "number" ? msg.swipe_info[msg.swipe_id] : null;
    if (info && typeof info === "object") { info.extra = info.extra || {}; info.extra.vcrp_finish = { ...stamp }; }
}

/** The output tokens a reply was billed for (its reasoning counted), when its answer said; else null. */
export function billedOutputTokens(msg) {
    const f = msg && msg.extra && msg.extra.vcrp_finish;
    const out = f && f.usage && num(f.usage.out);
    return out !== null && out !== undefined && out > 0 ? out : null;
}
