// ─────────────────────────────────────────────────────────────────────────────
// VCRP: how each generation ended, from the API's own answer.
//
// SillyTavern keeps a reply's text and, when shown, its reasoning; not why the model stopped
// (the output limit, a content filter, an error on the provider's side) nor what it wrote
// (its hidden reasoning is tokens paid for and never seen). A reply that comes back with
// nothing in it is then a guess. So VCRP reads the answer to each of SillyTavern's
// chat-completion requests as it passes: a copy of the response, read alongside the one
// SillyTavern reads, with the request and that copy untouched. Kept, for the last few: the
// stop reason as the provider gave it, the output tokens (reasoning counted) and the limit
// the request went out with. The reply that arrives next is stamped with it
// (msg.extra.vcrp_finish): the blank-reply note says what happened (blankReply.js), the cut
// is known for certain (replyCut.js), the cost badge and Story Memory count the output as
// billed (replyCost.js, memory/index.js), and Setup Check shows the last replies (health.js).
//
// What the answers look like: OpenRouter, OpenAI and the OpenAI-shaped sources give choices
// with finish_reason (OpenRouter adds native_finish_reason, the provider's own word) and a
// usage object; Google gives candidates with finishReason and usageMetadata; Anthropic gives
// stop_reason and usage (streamed: a message_delta event). The same reader takes a whole
// JSON answer or a stream of "data:" lines.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpGenerationKind, vcrpGenerationRaw, vcrpStorySeq } from "./generation.js";
import { sentReplyLimit, sentReplyLimitBy } from "./replyLength.js";

export const GENERATE_PATH = "/api/backends/chat-completions/generate";
const KEEP = 12;            // generations remembered
const STAMP_WAIT_MS = 1500; // a reply's handlers wait this long, at most, for its answer to be read through

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

/** A provider's stop reason, in VCRP's words: "stop" | "length" | "filter" | "error" | "tool" | "other". */
export function normalizeStopReason(raw) {
    const r = String(raw || "").trim();
    if (!r) return "";
    const u = r.toUpperCase();
    if (/^(STOP|END_TURN|STOP_SEQUENCE|COMPLETED?|FINISH(ED)?)$/.test(u)) return "stop";
    if (/^(LENGTH|MAX_TOKENS|MAX_OUTPUT_TOKENS|TOKEN_LIMIT)$/.test(u)) return "length";
    if (/^(CONTENT_FILTER|SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|REFUSAL|LANGUAGE|UNEXPECTED_TOOL_CALL|OTHER)$/.test(u)) return "filter";
    if (/^(ERROR|FAILED)$/.test(u)) return "error";
    if (/^(TOOL_CALLS?|FUNCTION_CALL|TOOL_USE|MALFORMED_FUNCTION_CALL)$/.test(u)) return "tool";
    return "other";
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
    if (choice && typeof choice === "object") {
        if (choice.finish_reason) { out.native = String(choice.native_finish_reason || choice.finish_reason); out.reason = normalizeStopReason(choice.finish_reason); }
        else if (choice.native_finish_reason) { out.native = String(choice.native_finish_reason); out.reason = normalizeStopReason(choice.native_finish_reason); }
    }
    if (obj.usage && typeof obj.usage === "object") {
        const u = obj.usage;
        if (num(u.completion_tokens) !== null || num(u.output_tokens) !== null) {
            out.usage = out.usage || {};
            if (num(u.completion_tokens) !== null) out.usage.out = u.completion_tokens;
            if (num(u.output_tokens) !== null) out.usage.out = u.output_tokens;   // Anthropic (message_delta carries the final count)
            const det = u.completion_tokens_details;
            if (det && num(det.reasoning_tokens) !== null) out.usage.reasoning = det.reasoning_tokens;
            if (num(u.prompt_tokens) !== null) out.usage.input = u.prompt_tokens;
            if (num(u.input_tokens) !== null) out.usage.input = u.input_tokens;
            const pdet = u.prompt_tokens_details;
            if (pdet && num(pdet.cached_tokens) !== null) out.usage.cached = pdet.cached_tokens;
            if (num(u.cache_read_input_tokens) !== null) out.usage.cached = u.cache_read_input_tokens;
        }
    }
    // Anthropic: a whole message, or the streamed delta that ends it.
    if (obj.stop_reason) { out.native = String(obj.stop_reason); out.reason = normalizeStopReason(obj.stop_reason); }
    if (obj.type === "message_delta" && obj.delta && obj.delta.stop_reason) { out.native = String(obj.delta.stop_reason); out.reason = normalizeStopReason(obj.delta.stop_reason); }
    if (obj.type === "message_start" && obj.message && obj.message.usage) readObject({ usage: obj.message.usage }, out);
    if (obj.type === "error") out.error = errorText(obj.error) || "an error with no message";
    // Google.
    const cand = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
    if (cand && cand.finishReason) { out.native = String(cand.finishReason); out.reason = normalizeStopReason(cand.finishReason); }
    if (obj.promptFeedback && obj.promptFeedback.blockReason) { out.native = String(obj.promptFeedback.blockReason); out.reason = "filter"; }
    const um = obj.usageMetadata;
    if (um && typeof um === "object" && num(um.candidatesTokenCount) !== null) {
        out.usage = out.usage || {};
        out.usage.out = (um.candidatesTokenCount || 0) + (num(um.thoughtsTokenCount) || 0);
        if (num(um.thoughtsTokenCount) !== null) out.usage.reasoning = um.thoughtsTokenCount;
        if (num(um.promptTokenCount) !== null) out.usage.input = um.promptTokenCount;
        if (num(um.cachedContentTokenCount) !== null) out.usage.cached = um.cachedContentTokenCount;
    }
}

/**
 * What an answer's text says: { reason, native, usage, error }. A whole JSON answer, or a
 * stream of "data:" lines (the last stop reason and the last usage count). Pure.
 */
export function readGenerationBody(text) {
    const out = { reason: "", native: "", usage: null, error: "", provider: "", genId: "" };
    const done = () => { if (!out.reason && out.error) out.reason = "error"; return out; };
    const s = String(text || "").trim();
    if (!s) return out;
    if (s[0] === "{" || s[0] === "[") {
        try { readObject(JSON.parse(s), out); return done(); } catch (e) { /* a stream that happens to start with a brace: read line by line */ }
    }
    for (const raw of s.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const body = line.slice(5).trim();
        if (!body || body === "[DONE]") continue;
        try { readObject(JSON.parse(body), out); } catch (e) { /* a partial or non-JSON line */ }
    }
    return done();
}

// ── Watching SillyTavern's requests ──────────────────────────────────────────

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
        at: Date.now(), kind, story, raw: vcrpGenerationRaw(),
        model: String(body.model || ""), source: String(body.chat_completion_source || ""), stream: body.stream === true,
        limit, limitBy: limit && limit === sentReplyLimit() ? sentReplyLimitBy() : "",
        status: 0, reason: "", native: "", usage: null, error: "", provider: "", genId: "", done: false, stamped: false, waiters: [],
    };
    records.push(rec);
    while (records.length > KEEP) records.shift();
    return rec;
}

function finish(rec, read) {
    Object.assign(rec, read);
    // A refused request (SillyTavern's or the provider's HTTP error) with no word of why.
    if (rec.status >= 400 && !rec.error) rec.error = `the request was refused (HTTP ${rec.status})`;
    if (!rec.reason && rec.error) rec.reason = "error";
    rec.done = true;
    const w = rec.waiters; rec.waiters = [];
    w.forEach(fn => { try { fn(); } catch (e) { /* a waiter's own trouble */ } });
}

function watch(rec, res) {
    rec.status = Number(res && res.status) || 0;
    let clone;
    try { clone = res.clone(); } catch (e) { finish(rec, { error: "the answer could not be read alongside" }); return; }
    clone.text().then(
        t => finish(rec, readGenerationBody(t)),
        e => finish(rec, { error: rec.error || `stopped before the end${e && e.name === "AbortError" ? " (cancelled)" : ""}` }),
    );
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
            result.then(res => { try { watch(rec, res); } catch (e) { finish(rec, { error: "the answer could not be read alongside" }); } },
                err => finish(rec, { error: errorText(err) || "the request failed" }));
        }
        return result;
    };
    installed = true;
    return true;
}

/** For tests: the wrapper installs again on a fresh scope. */
export function vcrpResetGenerationTrace() {
    installed = false;
    records.length = 0;
    seqTaken = 0;
    helperUntil = 0;
}

/** The generations remembered, oldest first (copies). */
export function vcrpGenerationRecords() {
    return records.map(r => ({ ...r, waiters: undefined }));
}

/** The latest generation of one of `kinds` ("reply", "continue", "impersonate", "quiet"), or null. */
export function vcrpLastGeneration(kinds = ["reply", "continue"]) {
    for (let i = records.length - 1; i >= 0; i--) if (kinds.includes(records[i].kind)) return { ...records[i], waiters: undefined };
    return null;
}

const whenDone = (rec, ms) => new Promise(resolve => {
    if (rec.done) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    rec.waiters.push(() => { clearTimeout(t); resolve(); });
});

/** What a reply is stamped with: the record's facts, without its machinery. */
export function finishStamp(rec) {
    return {
        done: !!rec.done, reason: rec.reason || "", native: rec.native || "", error: rec.error || "", status: rec.status || 0,
        limit: rec.limit || 0, limitBy: rec.limitBy || "", model: rec.model || "", at: rec.at,
        provider: rec.provider || "", genId: rec.genId || "",
        usage: rec.usage ? { ...rec.usage } : null,
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
    // (and whether it was cut) is not this reply's. A Continue adds to a reply and keeps its marks.
    if (type !== "continue" && msg.extra) {
        delete msg.extra.vcrp_finish;
        delete msg.extra.vcrp_cut;
    }
    let rec = null;
    for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        if (r.story && !r.stamped) { rec = r; break; }
    }
    if (!rec) return;
    rec.stamped = true;
    await whenDone(rec, STAMP_WAIT_MS);
    const stamp = finishStamp(rec);
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
