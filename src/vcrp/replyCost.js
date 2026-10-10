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
    const output = Math.max(0, outputTokens(msg) - p.from);
    const price = budget.price;
    const parts = {
        read: p.read * price.read / 1e6, write: p.write * budget.write / 1e6, plain: p.plain * price.input / 1e6, output: output * price.output / 1e6,
    };
    const cost = parts.read + parts.write + parts.plain + parts.output;
    const prev = p.continued && msg.extra && msg.extra.vcrp_cost ? msg.extra.vcrp_cost : null;
    const add = (a, b) => (a || 0) + (b || 0);
    const record = prev ? {
        ...prev, total: add(prev.total, cost), output: add(prev.output, output), parts: (prev.parts || 1) + 1,
        tokens: { read: add(prev.tokens.read, p.read), write: add(prev.tokens.write, p.write), plain: add(prev.tokens.plain, p.plain) },
        pieces: { read: add(prev.pieces.read, parts.read), write: add(prev.pieces.write, parts.write), plain: add(prev.pieces.plain, parts.plain), output: add(prev.pieces.output, parts.output) },
    } : {
        total: cost, output, parts: 1, cold: p.cold, model: price.label,
        tokens: { read: p.read, write: p.write, plain: p.plain }, pieces: parts,
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
    const lines = [
        `About ${usd(c.total)} for this reply on ${c.model}${c.parts > 1 ? ` (${c.parts} parts, with Continue)` : ""}, ${c.cold ? "cache cold: the prompt was written to it in full" : "cache warm"}.`,
        `Read from the cache: ${k(t.read || 0)} tokens, ${usd(p.read || 0)}`,
        `Written to the cache: ${k(t.write || 0)} tokens, ${usd(p.write || 0)}`,
        `Sent fresh: ${k(t.plain || 0)} tokens, ${usd(p.plain || 0)}`,
        `Written by the model: ${k(c.output || 0)} tokens, ${usd(p.output || 0)}`,
        "An estimate from VCRP's own token counts; hidden reasoning is not included.",
    ];
    return { short: `≈ ${usd(c.total)}`, detail: lines.join("\n") };
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
