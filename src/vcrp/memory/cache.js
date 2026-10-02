// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: marking the prompt cache without config.yaml.
//
// SillyTavern only asks Claude to cache when its server config says so (claude.cachingAtDepth,
// claude.extendedTTL), and that file can't be edited from the browser. This does the same
// marking from VCRP, for the OpenRouter route: the cache_control markers ride on the messages
// themselves, which SillyTavern passes to OpenRouter as they are.
//
// Same placement as SillyTavern's cachingAtDepth 0 (skip a trailing prefill, skip system
// messages, mark the newest user turn and the user turn two role switches back), so if both
// are on they mark the same messages and stay inside Anthropic's limit of four markers.
// Off by default: "Mark the cache from VCRP" in Story Memory.
// ─────────────────────────────────────────────────────────────────────────────

/** Indices the markers go on, newest first. */
export function cacheMarkIndices(messages, depth = 0) {
    const marks = [];
    let passedPrefill = false, d = 0, prev = "";
    for (let i = messages.length - 1; i >= 0; i--) {
        const role = messages[i].role;
        if (!passedPrefill && role === "assistant") continue;
        passedPrefill = true;
        if (role === "system") continue;
        if (role !== prev) {
            if (d === depth || d === depth + 2) marks.push(i);
            if (d === depth + 2) break;
            d++;
            prev = role;
        }
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
