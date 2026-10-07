// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: marking the prompt cache.
//
// A cache is only read where a new request's marker meets one an earlier request wrote,
// over an identical prompt up to that point. Anthropic's own API also looks a few blocks
// back for an older marker; Bedrock (one of OpenRouter's Claude providers) does not, so on
// that route the markers have to land on the same message from one turn to the next.
//
// SillyTavern's cachingAtDepth marks the newest user turn and the user turn two switches
// back. That only lines up when nothing sits between the last reply and the newest message,
// and VCRP's per-turn rules (Output RULES, an in-chat slot at depth 1) sit exactly there:
// measured live, every reply and summary call read only the fixed part of the prompt from
// cache and wrote the whole chat history again.
//
// So VCRP marks the last two replies instead. A reply never changes once it is in the chat
// (VCRP strips its <Blocks> in every turn, see blockHistory.js), so this turn's newer marker
// is next turn's older one, on the same text: read from cache, every time, on any provider.
// What comes after the last reply (the newest message, the per-turn rules) is not cached at
// all, which is cheaper than SillyTavern writing it to the cache at double price every turn.
//
// The OpenRouter + Claude route only; "Mark the cache from VCRP" in Story Memory, on by
// default. It needs SillyTavern's own markers off (claude.cachingAtDepth: -1): with both,
// a live request on Bedrock failed with a 400, the route evidently adding a marker of its
// own and taking the count past Claude's limit of four.
// ─────────────────────────────────────────────────────────────────────────────

const textOf = m => typeof (m && m.content) === "string" ? m.content
    : Array.isArray(m && m.content) ? m.content.filter(p => p && p.type === "text").map(p => p.text || "").join("") : "";

/**
 * Indices the markers go on, newest first: the last two replies (assistant messages with
 * text). A trailing assistant message is a prefill or a reply being continued, and is skipped.
 */
export function cacheMarkIndices(messages) {
    const marks = [];
    let end = messages.length;
    if (end && messages[end - 1].role === "assistant") end--;
    for (let i = end - 1; i >= 0 && marks.length < 2; i--) {
        if (messages[i].role === "assistant" && textOf(messages[i]).trim()) marks.push(i);
    }
    return marks;
}

/** Puts a cache_control marker on the last text part of each marked message. */
export function markCache(messages, ttl = "1h") {
    const control = ttl === "5m" ? { type: "ephemeral" } : { type: "ephemeral", ttl: "1h" };
    for (const i of cacheMarkIndices(messages)) {
        const m = messages[i];
        if (typeof m.content === "string") m.content = [{ type: "text", text: m.content }];
        if (!Array.isArray(m.content) || !m.content.length) continue;
        const parts = m.content;
        for (let p = parts.length - 1; p >= 0; p--) {
            if (parts[p] && parts[p].type === "text") { parts[p] = { ...parts[p], cache_control: control }; break; }
        }
    }
}
