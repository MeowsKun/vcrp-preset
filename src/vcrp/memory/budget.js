// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: what a request costs, and how big the prompt may be.
//
// The expensive request is the cache miss: every token is written to the cache at
// 1.25x the input price (5-minute cache) or 2x (1-hour cache). A hit reads the cached
// part at a tenth of the input price or less. So the budget is set by the miss: the
// prompt carried after a cold start is sized so that even a full miss stays under the
// per-request target. While the cache is warm the prompt may grow past that, up to a
// ceiling, because reads are cheap.
//
// Pure: no SillyTavern, no DOM. Prices are $ per million tokens.
// ─────────────────────────────────────────────────────────────────────────────

// First match wins, so the more specific pattern goes first. Matched against the model
// id SillyTavern has selected, e.g. "claude-opus-5-5" or "anthropic/claude-opus-5.5".
export const MODEL_PRICES = [
    { re: /opus[-.]?5[-.]5/, label: "Claude Opus 5.5", input: 4, output: 20, read: 0.20 },
    { re: /opus[-.]?5(?![-.]?\d)/, label: "Claude Opus 5", input: 5, output: 25, read: 0.50 },
    { re: /opus[-.]?4[-.]?[5-8]/, label: "Claude Opus 4.5-4.8", input: 5, output: 25, read: 0.50 },
    { re: /(?:fable|mythos)[-.]?5[-.]1/, label: "Claude Fable 5.1", input: 10, output: 50, read: 0.25 },
    { re: /fable|mythos/, label: "Claude Fable 5", input: 10, output: 50, read: 1.00 },
    { re: /sonnet[-.]?5/, label: "Claude Sonnet 5 / 5.5", input: 2, output: 10, read: 0.20 },
    { re: /sonnet[-.]?4[-.]?[56]/, label: "Claude Sonnet 4.5 / 4.6", input: 3, output: 15, read: 0.30 },
    { re: /haiku[-.]?4[-.]?5/, label: "Claude Haiku 4.5", input: 1, output: 5, read: 0.10 },
];

export const BUDGET_DEFAULTS = {
    targetCost: 0.30,       // $ per request, worst case
    ttl: "1h",              // must match SillyTavern's claude.extendedTTL (1h) or not (5m)
    outputTokens: 2500,     // reply + visible CoT + hidden thinking, per request
    warmCeiling: 100000,    // the most the prompt may carry while the cache is warm
    minVerbatim: 10000,     // recent messages always kept word for word, whatever the budget
    customPrice: null,      // { input, output, read } for a model the table does not know
    review: true,           // new chapters wait for the reader's approval before they count
    recallTokens: 1000,     // old chapters brought back per request when the scene touches them (0 = off)
    memoryCap: 3000,        // the most the always-carried memory text may take; older facts move to recall
    markCache: true,        // VCRP puts the cache markers on (OpenRouter + Claude), on the last two replies: see cache.js
    // VCRP counts tokens by length (about 3.5 characters each); markup-heavy text such as the
    // preset itself runs denser. Sizing the cold-start prompt a little under the budget keeps
    // that error from pushing a break-time request over the target.
    safety: 0.92,
};

/** The price row for a model id, or null when it is unknown and no custom price is set. */
export function priceForModel(modelId, customPrice = null) {
    if (customPrice && customPrice.input > 0) return { label: "Custom price", ...customPrice };
    const id = String(modelId || "").toLowerCase();
    return MODEL_PRICES.find(p => p.re.test(id)) || null;
}

export const ttlMs = ttl => (ttl === "5m" ? 5 : 60) * 60 * 1000;

/**
 * The token sizes that keep requests inside the target.
 *   coldTokens  the prompt a full cache miss can afford: what VCRP cuts down to at a cold start
 *   warmTokens  the most the prompt may carry while the cache is warm
 */
export function computeBudget(price, settings = {}) {
    const s = { ...BUDGET_DEFAULTS, ...settings };
    if (!price) return null;
    const write = price.input * (s.ttl === "5m" ? 1.25 : 2);
    const outputCost = s.outputTokens * price.output / 1e6;
    const forInput = Math.max(0, s.targetCost - outputCost);
    const coldTokens = Math.floor(forInput / write * 1e6 * s.safety);
    return {
        price, write, outputCost, coldTokens,
        warmTokens: Math.max(coldTokens, s.warmCeiling),
        minVerbatim: s.minVerbatim,
        outputTokens: s.outputTokens,
        ttl: s.ttl, ttlMs: ttlMs(s.ttl),
    };
}

/** What one request costs: `read` tokens come from the cache, `write` are written to it, the rest is plain input. */
export function requestCost(budget, { read = 0, write = 0, plain = 0, output = 0 }) {
    const p = budget.price;
    return (read * p.read + write * budget.write + plain * p.input + output * p.output) / 1e6;
}

/** The two numbers the meter shows: a request now if the cache is warm, and if it is cold. */
export function costEstimate(budget, promptTokens, newTokens = 4500) {
    const output = budget.outputTokens;
    return {
        warm: requestCost(budget, { read: Math.max(0, promptTokens - newTokens), write: Math.min(promptTokens, newTokens), output }),
        cold: requestCost(budget, { write: promptTokens, output }),
    };
}
