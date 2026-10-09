// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what each Pura setting and tracker costs, for the Pura panel and the BLOCKS tab.
//
// Three kinds of tokens, priced on the selected model (the Memory tab's price table, or the
// custom price set there):
//   cached   text that holds still (Pura's main prompt, HTML, Diegetic Stats, the modes, the
//            tracker rules): written to the cache once, then read at a fraction of the price;
//   fresh    text sent after your newest message on every reply (Grounded Prose, the
//            randomisers, a random voice, Formatting, a tracker's format and carried state):
//            the full input price each time;
//   written  what the model writes for a tracker: the output price, the dearest of the three,
//            measured from this chat's recent replies once the tracker has appeared.
// A randomiser counts as the size of an average roll, not the whole list it rolls from.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { PURA_TRACKERS } from "../../../data/pura.js";
import { priceForModel } from "../memory/budget.js";
import { memoryBudgetSettings, estimateTokens } from "../memory/index.js";
import { vcrpActiveModel, vcrpWithoutSwipedReply } from "../generation.js";
import { carriedTrackerState } from "../blockHistory.js";
import { puraSettings, puraMainPrompt, puraSystemBlock, puraLateBlock } from "./index.js";

const RECENT = 20;   // replies a tracker's written size is measured over

// ── Sizes ────────────────────────────────────────────────────────────────────

// The index just after the }} closing the macro that opens at `at`, or -1.
function macroEnd(s, at) {
    let depth = 0;
    for (let j = at; j < s.length - 1; j++) {
        if (s[j] === "{" && s[j + 1] === "{") { depth++; j++; } else if (s[j] === "}" && s[j + 1] === "}") { depth--; j++; if (depth === 0) return j + 1; }
    }
    return -1;
}
// `body` split on `sep` outside any nested {{…}}.
function splitTop(body, sep) {
    const parts = [];
    let depth = 0, cur = "";
    for (let j = 0; j < body.length; j++) {
        if (body.startsWith("{{", j)) { depth++; cur += "{{"; j++; continue; }
        if (body.startsWith("}}", j)) { depth--; cur += "}}"; j++; continue; }
        if (depth === 0 && body.startsWith(sep, j)) { parts.push(cur); cur = ""; j += sep.length - 1; continue; }
        cur += body[j];
    }
    parts.push(cur);
    return parts;
}

/** The text a request carries: each {{random}} as its average-length option, a {{roll}} as a number. */
export function expectedText(text) {
    const s = String(text || "");
    let out = "", i = 0;
    for (;;) {
        const at = s.indexOf("{{random", i);
        if (at < 0) { out += s.slice(i); break; }
        out += s.slice(i, at);
        const end = macroEnd(s, at);
        if (end < 0) { out += s.slice(at); break; }
        const inner = s.slice(at + 2, end - 2);
        const colons = /^random\s*::/.test(inner);
        const opts = splitTop(inner.replace(/^random\s*::?/, ""), colons ? "::" : ",").map(expectedText);
        const avg = opts.reduce((n, o) => n + o.length, 0) / Math.max(1, opts.length);
        out += opts.reduce((best, o) => (Math.abs(o.length - avg) < Math.abs(best.length - avg) ? o : best), opts[0] || "");
        i = end;
    }
    return out.replace(/\{\{roll[^}]*\}\}/g, "50");
}

export const tokensOf = text => estimateTokens(expectedText(text));

// ── Prices ───────────────────────────────────────────────────────────────────

/** The selected model's price row ({ label, input, output, read } per million tokens), or null. */
export function puraPrice() {
    try { return priceForModel(vcrpActiveModel().model, memoryBudgetSettings().customPrice); } catch (e) { return null; }
}

/** Dollars per reply for so many tokens of each kind, or null without a price. */
export function costOf({ fresh = 0, cached = 0, written = 0 } = {}, price = puraPrice()) {
    if (!price) return null;
    const read = price.read != null ? price.read : price.input / 10;
    return (fresh * price.input + cached * read + written * price.output) / 1e6;
}

export function usd(n) {
    if (n == null) return "";
    if (n < 0.0001) return "under $0.0001";
    return `$${n.toFixed(n < 0.01 ? 4 : n < 0.1 ? 3 : 2)}`;
}
const num = n => Number(n || 0).toLocaleString("en-US");

/** One Pura setting's cost if it is on: "≈ 910 tokens, sent fresh every reply ($0.0046 a reply)". */
export function settingCostLabel(text, { fresh = false } = {}) {
    const tokens = tokensOf(text);
    const c = costOf(fresh ? { fresh: tokens } : { cached: tokens });
    return `≈ ${num(tokens)} tokens, ${fresh ? "sent fresh every reply" : "cached"}${c != null ? ` (${usd(c)} a reply${fresh ? "" : " once cached"})` : ""}`;
}

/** What the Pura engine sends with the current settings: its cached and fresh parts. */
export function puraEngineCost(variant, s = puraSettings()) {
    const language = localProfile && String(localProfile.userLanguage || "").trim();
    const cached = tokensOf(puraMainPrompt(variant, s) + puraSystemBlock(s));
    const fresh = tokensOf(puraLateBlock(variant, "reply", s, { language }));
    return { cached, fresh, cost: costOf({ cached, fresh }) };
}

/** The panel's summary line. */
export function puraEngineCostLabel(variant, s = puraSettings()) {
    const { cached, fresh, cost } = puraEngineCost(variant, s);
    const price = puraPrice();
    const where = price ? ` on ${price.label}` : " (no price for this model: set one in the Memory tab to see dollars)";
    return `Pura's text with these settings: ≈ ${num(cached)} tokens cached and ≈ ${num(fresh)} sent fresh every reply, about ${cost != null ? usd(cost) : "?"} a reply once cached${where}. Pura's trackers are priced in the BLOCKS tab.`;
}

// ── Trackers ─────────────────────────────────────────────────────────────────

// How much the model writes for a tracker: its average size where it appeared, and how often.
function measuredWritten(block, replies = RECENT) {
    let chat = [];
    try { chat = vcrpWithoutSwipedReply(((getContext() || {}).chat || []).filter(m => !m.is_system)); } catch (e) { return null; }
    const recent = chat.filter(m => !m.is_user && typeof m.mes === "string").slice(-replies);
    if (!recent.length) return null;
    const re = new RegExp(`<${block.tag}\\b[^>]*>([\\s\\S]*?)<\\/${block.tag}\\s*>`, "i");
    const sizes = recent.map(m => (m.mes.match(re) || [])[1]).filter(b => b != null && b.trim()).map(b => estimateTokens(b));
    if (!sizes.length) return { seen: 0, of: recent.length, avg: 0, perReply: 0 };
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    return { seen: sizes.length, of: recent.length, avg, perReply: avg * sizes.length / recent.length };
}

// The tokens of a tracker's state handed back every turn (see blockHistory.js).
function carriedTokens(block) {
    let state = [];
    try { state = carriedTrackerState(); } catch (e) { return 0; }
    const mine = state.find(x => x.block && x.block.id === block.id);
    if (!mine) return 0;
    if (mine.names) return estimateTokens(mine.names.join(", "));
    return estimateTokens((mine.entries || []).map(e => e.text).join("\n"));
}

/** One Pura tracker's cost: { rules, format, carried, written, cost }. */
export function trackerCost(block) {
    const rules = tokensOf(PURA_TRACKERS[block.puraRules] || "");
    let format = 0;
    try { format = typeof block.build === "function" ? tokensOf(block.build()) : 0; } catch (e) { format = 0; }
    const carried = carriedTokens(block);
    const written = measuredWritten(block);
    const cost = costOf({ fresh: format + carried, cached: rules, written: written ? written.perReply : 0 });
    return { rules, format, carried, written, cost };
}

/** Its line in the BLOCKS tab. */
export function trackerCostLabel(block) {
    const t = trackerCost(block);
    const sent = `sends ${num(t.format + t.carried)} tokens${t.carried ? ` (${num(t.carried)} of carried state)` : ""}`;
    const wrote = !t.written ? "writes: no replies yet"
        : t.written.seen ? `writes ~${num(t.written.avg)} in ${t.written.seen} of the last ${t.written.of} replies`
            : `not written in the last ${t.written.of} replies`;
    return `${t.cost != null ? `≈ ${usd(t.cost)} a reply · ` : ""}${sent}, ${wrote} · rules ${num(t.rules)} cached`;
}

/** The Pura trackers in the stack together, per reply, or null without a price. */
export function trackersCost(blocks) {
    const list = (blocks || []).filter(b => b && b.group === "pura" && b.puraRules);
    if (!list.length || !puraPrice()) return null;
    return list.reduce((n, b) => n + (trackerCost(b).cost || 0), 0);
}
