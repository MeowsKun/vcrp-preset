// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what each reply cost, on a small badge by the reply (Memory tab: "Show each reply's
// cost", on by default; off removes the badges).
//
// Estimated the way Story Memory's spend estimate is (SillyTavern does not hand extensions
// the bill), but for every chat, Story Memory on or not: the prompt split into what was read
// from the cache, what was written to it and what went in fresh, priced on the selected
// model, plus the reply itself (its text and the reasoning SillyTavern shows; hidden
// reasoning it never sees is not counted). A Continue adds its part to the reply it
// continues. Kept with the message (and its swipe), so a reply keeps its badge.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, extension_settings } from "../st.js";
import { extensionName } from "../core/constants.js";
import { currentMemoryBudget, promptSpendSplit, estimateTokens, memoryNow } from "./memory/index.js";
import { isCold } from "./memory/window.js";
import { vcrpGenerationKind, vcrpGenerationRaw } from "./generation.js";
import { isStoryReply } from "./storyReplies.js";

const META = "vcrp_cost";        // { lastRequestAt }: this chat's cache clock, for warm or cold
const BADGE = "vcrp-cost-badge";

let pending = null;    // the request being answered: { index, read, write, plain, cold, from }
let stampedOver = null;

/** The badges are on (Memory tab). */
export function costBadgesOn() {
    const g = (extension_settings[extensionName] && extension_settings[extensionName].globalSettings) || {};
    return g.costBadges !== false;
}
export function setCostBadges(on) {
    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    s.globalSettings = s.globalSettings || {};
    s.globalSettings.costBadges = !!on;
    drawAllCostBadges();
}

const outputTokens = m => estimateTokens(String((m && m.mes) || "") + String((m && m.extra && m.extra.reasoning) || ""));
// What the API billed the reply's output at, hidden reasoning counted, when its answer was
// read as it passed (generationTrace.js stamps it on the reply before this runs); else null.
const billedOutput = m => {
    const f = m && m.extra && m.extra.vcrp_finish;
    const out = f && f.usage && f.usage.out;
    return typeof out === "number" && out > 0 ? out : null;
};

// A reply whose prompt came less than this much from the cache paid (nearly) full price for it.
const COLD_SHARE = 0.5;
// The prompt as the API billed it, when the answer was read and said: { read, write, plain } in
// tokens (read from the cache, written to it, sent fresh); else null.
const billedInput = m => {
    const u = m && m.extra && m.extra.vcrp_finish && m.extra.vcrp_finish.usage;
    const input = u && typeof u.input === "number" ? u.input : 0;
    if (!(input > 0)) return null;
    const read = Math.min(input, Math.max(0, Number(u.cached) || 0));
    const write = Math.min(input - read, Math.max(0, Number(u.written) || 0));
    return { read, write, plain: input - read - write };
};

/** After the roleplay prompt is built (injection.js): what it will cost to read, by kind. */
export function vcrpCostAfterPrompt(messages, dryRun) {
    stampedOver = null;
    if (dryRun || !Array.isArray(messages) || !chat_metadata) return;
    const gen = vcrpGenerationKind();
    if (gen === "quiet") return;
    const budget = currentMemoryBudget();
    const st = chat_metadata[META] && typeof chat_metadata[META] === "object" ? chat_metadata[META] : (chat_metadata[META] = { lastRequestAt: 0 });
    const cold = !budget || isCold({ lastRequestAt: st.lastRequestAt }, memoryNow(), budget);
    stampedOver = st.lastRequestAt || 0;
    st.lastRequestAt = memoryNow();
    if (gen === "impersonate" || !budget) { pending = null; return; }
    const chat = ((getContext() || {}).chat) || [];
    const raw = vcrpGenerationRaw();
    const index = gen === "continue" || raw === "swipe" ? chat.length - 1 : chat.length;
    const { read, write, plain } = promptSpendSplit(messages, cold);
    pending = { index, read, write, plain, cold, from: gen === "continue" ? outputTokens(chat[index]) : 0, continued: gen === "continue" };
}

/** When this chat's last reply request went out, by this module's own clock (kept with Story Memory on or off); 0 when none has. */
export function costClock() {
    const st = chat_metadata && chat_metadata[META];
    return (st && Number(st.lastRequestAt)) || 0;
}

/** Another chat is open: the last one's request is not this one's to price (its clock stays). */
export function forgetCostPending() {
    pending = null;
    stampedOver = null;
}

/** The prompt was built but never sent (Cancel in the payload preview): nothing to count. */
export function vcrpCostRequestCancelled() {
    const st = chat_metadata && chat_metadata[META];
    if (st && stampedOver !== null) st.lastRequestAt = stampedOver;
    stampedOver = null;
    pending = null;
}

/**
 * MESSAGE_RECEIVED (first, before anything adds to the reply): the reply's cost, kept with
 * it. A Continue adds to what the reply already had.
 */
export function vcrpCostOnReply(messageId, type) {
    if (type === "first_message") return;
    const chat = ((getContext() || {}).chat) || [];
    const id = Number(messageId);
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system) return;
    if (!pending || pending.index !== id) {
        // SillyTavern starts a new swipe with a copy of the last one's extras: a swipe with no
        // count of its own (no price for the model, another preset) must not show that cost.
        if (type === "swipe" && msg.extra && msg.extra.vcrp_cost) {
            delete msg.extra.vcrp_cost;
            const info = Array.isArray(msg.swipe_info) && typeof msg.swipe_id === "number" ? msg.swipe_info[msg.swipe_id] : null;
            if (info && info.extra) delete info.extra.vcrp_cost;
        }
        return;
    }
    const budget = currentMemoryBudget();
    const p = pending;
    pending = null;
    if (!budget) return;
    // As billed when the answer said (a Continue's answer counts its own part only); else
    // estimated from the text, the part already there taken off on a Continue.
    const billed = billedOutput(msg);
    const output = billed !== null ? billed : Math.max(0, outputTokens(msg) - p.from);
    const reasoning = billed !== null && msg.extra.vcrp_finish.usage.reasoning > 0 ? msg.extra.vcrp_finish.usage.reasoning : 0;
    const price = budget.price;
    // The prompt as billed too, when the answer said: what was read from the cache, what was
    // written to it, and the rest sent fresh. Else VCRP's own count and its guess at the cache.
    const inBill = billedInput(msg);
    const t = inBill || { read: p.read, write: p.write, plain: p.plain };
    const cold = inBill ? inBill.read < (inBill.read + inBill.write + inBill.plain) * COLD_SHARE : p.cold;
    const parts = {
        read: t.read * price.read / 1e6, write: t.write * budget.write / 1e6, plain: t.plain * price.input / 1e6, output: output * price.output / 1e6,
    };
    const cost = parts.read + parts.write + parts.plain + parts.output;
    const prev = p.continued && msg.extra && msg.extra.vcrp_cost ? msg.extra.vcrp_cost : null;
    const add = (a, b) => (a || 0) + (b || 0);
    const record = prev ? {
        ...prev, total: add(prev.total, cost), output: add(prev.output, output), parts: (prev.parts || 1) + 1,
        tokens: { read: add(prev.tokens.read, t.read), write: add(prev.tokens.write, t.write), plain: add(prev.tokens.plain, t.plain) },
        pieces: { read: add(prev.pieces.read, parts.read), write: add(prev.pieces.write, parts.write), plain: add(prev.pieces.plain, parts.plain), output: add(prev.pieces.output, parts.output) },
        billed: !!prev.billed && billed !== null, billedIn: !!prev.billedIn && !!inBill, reasoning: add(prev.reasoning, reasoning),
    } : {
        total: cost, output, parts: 1, cold, model: price.label,
        tokens: { read: t.read, write: t.write, plain: t.plain }, pieces: parts,
        billed: billed !== null, billedIn: !!inBill, reasoning,
    };
    msg.extra = msg.extra || {};
    msg.extra.vcrp_cost = record;
    const info = Array.isArray(msg.swipe_info) && typeof msg.swipe_id === "number" ? msg.swipe_info[msg.swipe_id] : null;
    if (info && typeof info === "object") { info.extra = info.extra || {}; info.extra.vcrp_cost = record; }
}

// ── The badge ────────────────────────────────────────────────────────────────

const usd = n => (n < 0.001 ? "<$0.001" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
const k = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** The badge's words and its breakdown. */
export function costBadgeText(c) {
    const t = c.tokens || {}, p = c.pieces || {};
    const whole = c.billed && c.billedIn;   // priced from the API's own counts, prompt and output
    const cache = c.billedIn
        ? (c.cold ? "little or none of the prompt came from the cache, so it was paid for in full" : "most of the prompt was read from the cache")
        : (c.cold ? "cache cold: the prompt was written to it in full" : "cache warm");
    const lines = [
        `${whole ? "" : "About "}${usd(c.total)} for this reply on ${c.model}${c.parts > 1 ? ` (${c.parts} parts, with Continue)` : ""}: ${cache}.`,
        `Read from the cache: ${k(t.read || 0)} tokens, ${usd(p.read || 0)}`,
        `Written to the cache: ${k(t.write || 0)} tokens, ${usd(p.write || 0)}`,
        `Sent fresh: ${k(t.plain || 0)} tokens, ${usd(p.plain || 0)}`,
        `Written by the model: ${k(c.output || 0)} tokens${c.billed && c.reasoning > 0 ? ` (${k(c.reasoning)} of them its reasoning)` : ""}, ${usd(p.output || 0)}`,
        whole ? "From the API's own token counts for this reply (the prompt, what was cached, the output with its reasoning), at the prices in the Memory tab."
            : c.billed ? "The output is the API's own count, reasoning included; the prompt's share is VCRP's estimate."
                : "An estimate from VCRP's own token counts; hidden reasoning is not included.",
    ];
    return { short: `${whole ? "" : "≈ "}${usd(c.total)}`, detail: lines.join("\n") };
}

// ── The chat's costs, read back ──────────────────────────────────────────────
// Every reply keeps what it cost (above). Read back over a chat they answer the questions a
// target raises: what does a reply really come to, how many went over the goal, how often did
// the cache help, how much of the output is reasoning nobody sees.

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };

/**
 * The chat's replies by cost (pure). `goal` and `ceiling` in dollars.
 * @returns {null | {replies, total, mean, median, max, overGoal, overCeiling, billed, hits, cachedShare, output, reasoning, warmMean, coldMean}}
 */
export function costReport(chat, { goal = 0, ceiling = 0 } = {}) {
    // A reply the reader has hidden since was paid for like any other: it stays in the count.
    const rows = (Array.isArray(chat) ? chat : []).map(m => (isStoryReply(m) && m.extra && m.extra.vcrp_cost) || null)
        .filter(c => c && typeof c.total === "number");
    if (!rows.length) return null;
    const sum = (list, f) => list.reduce((n, x) => n + (f(x) || 0), 0);
    const totals = rows.map(c => c.total);
    const total = sum(rows, c => c.total);
    const billed = rows.filter(c => c.billedIn);
    const warm = rows.filter(c => !c.cold), cold = rows.filter(c => c.cold);
    const prompt = sum(billed, c => (c.tokens.read || 0) + (c.tokens.write || 0) + (c.tokens.plain || 0));
    const withOut = rows.filter(c => c.billed);
    return {
        replies: rows.length, total, mean: total / rows.length, median: median(totals), max: Math.max(...totals),
        overGoal: goal > 0 ? rows.filter(c => c.total > goal).length : 0,
        overCeiling: ceiling > 0 ? rows.filter(c => c.total > ceiling).length : 0,
        billed: billed.length,
        hits: billed.filter(c => !c.cold).length,                                   // replies whose prompt mostly came from the cache
        cachedShare: prompt > 0 ? sum(billed, c => c.tokens.read) / prompt : null,  // of all prompt tokens billed, the share read from it
        output: withOut.length ? Math.round(sum(withOut, c => c.output) / withOut.length) : null,
        reasoning: withOut.length ? Math.round(sum(withOut, c => c.reasoning) / withOut.length) : null,
        warm: warm.length, cold: cold.length,
        warmMean: warm.length ? sum(warm, c => c.total) / warm.length : null,
        coldMean: cold.length ? sum(cold, c => c.total) / cold.length : null,
    };
}

/** The report in sentences, for the Memory tab and to copy: [headline, ...lines]. [] with no priced reply. */
export function costReportLines(chat, { goal = 0, ceiling = 0, model = "" } = {}) {
    const r = costReport(chat, { goal, ceiling });
    if (!r) return [];
    const pct = x => `${Math.round(x * 100)}%`;
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const lines = [
        `${n(r.replies, "reply", "replies")} priced${model ? ` on ${model}` : ""}: ${usd(r.total)} in all, ${usd(r.mean)} a reply on average (half of them under ${usd(r.median)}, the dearest ${usd(r.max)}).`,
    ];
    if (goal > 0) lines.push(r.overGoal ? `${n(r.overGoal, "reply", "replies")} came to more than your ${usd(goal)} target${ceiling > 0 ? `, ${r.overCeiling ? n(r.overCeiling, "one", "of them") + ` over the ${usd(ceiling)} ceiling (sent before it was in force, or under another price)` : `none over the ${usd(ceiling)} ceiling`}` : ""}.` : `None came to more than your ${usd(goal)} target.`);
    if (r.warm && r.cold) lines.push(`With the cache (${n(r.warm, "reply", "replies")}): ${usd(r.warmMean)} each. Without it (${n(r.cold, "reply", "replies")}): ${usd(r.coldMean)} each.`);
    else if (r.cold) lines.push(`Every one of them paid for its prompt without the cache (${usd(r.coldMean)} each).`);
    if (r.billed) lines.push(`By the API's own counts (${n(r.billed, "reply", "replies")}): the prompt was mostly read from the cache on ${r.hits} of them (${pct(r.hits / r.billed)})${r.cachedShare !== null ? `, and ${pct(r.cachedShare)} of all the prompt tokens billed came from it` : ""}.`);
    else lines.push("No reply here carries the API's own count of its prompt yet (kept from 10.0.0-vcrp.18 on): the prompt's share of each figure is VCRP's estimate.");
    if (r.output) lines.push(`A reply's output averages ${k(r.output)} tokens${r.reasoning ? `, ${k(r.reasoning)} of them reasoning you do not see` : ""}.`);
    return lines;
}

/** Draws (or takes away) the badge of message `id`. */
export function drawCostBadge(id, doc = typeof document !== "undefined" ? document : null) {
    const el = doc && doc.querySelector(`#chat .mes[mesid="${id}"]`);
    if (!el) return;
    const old = el.querySelector(`.${BADGE}`);
    const msg = (((getContext() || {}).chat) || [])[Number(id)];
    const c = msg && !msg.is_user && msg.extra && msg.extra.vcrp_cost;
    if (!costBadgesOn() || !c || typeof c.total !== "number") { if (old) old.remove(); return; }
    const { short, detail } = costBadgeText(c);
    const badge = old || doc.createElement("div");
    badge.className = BADGE;
    badge.textContent = short;
    badge.title = detail;
    badge.style.cssText = `font-size:0.68rem; opacity:0.75; cursor:pointer; margin-top:2px; color:${c.cold ? "#f59e0b" : "#10b981"};`;
    if (!old) {
        badge.addEventListener("click", e => {
            e.stopPropagation();
            if (typeof toastr !== "undefined") toastr.info(badge.title.replace(/\n/g, "<br>"), "VCRP: this reply's cost", { timeOut: 9000, escapeHtml: false });
        });
        const host = el.querySelector(".mesAvatarWrapper") || el.querySelector(".mes_block .ch_name") || el.querySelector(".mes_block") || el;
        host.appendChild(badge);
    }
}

/** Every message on screen (a chat opened, more loaded, the setting changed). */
export function drawAllCostBadges(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    doc.querySelectorAll("#chat .mes[mesid]").forEach(el => drawCostBadge(el.getAttribute("mesid"), doc));
}
