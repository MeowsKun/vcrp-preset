// ─────────────────────────────────────────────────────────────────────────────
// Pura's tracker cards (VCRP).
//
// Pura's Director Preset draws its trackers with regex scripts: a pattern for each
// tracker and an HTML card it is replaced with. The same scripts (data/pura.js, generated
// from Pura's own file) draw them here, inside the block card's tab, so they look exactly
// as Pura designed them.
//
// One difference, for safety: SillyTavern sanitizes a message before Pura's regexes ever
// see it, but this card is built outside that. So everything the model wrote is escaped
// before it goes into Pura's HTML, and text outside any tracker is shown as plain text.
//
// Follows the treatment contract (treatments.js): null when nothing in the body is a Pura
// tracker, and the pane falls back to the plain renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { esc } from "./text.js";
import { PURA_RENDERERS } from "../../data/pura.js";

const LATE = new Set(["Replace Bold Markdown", "Remove Empty Choice Rows"]);
const compiled = PURA_RENDERERS.map(r => ({ ...r, re: new RegExp(r.source, r.flags.includes("g") ? r.flags : r.flags + "g") }));
const structural = compiled.filter(r => !LATE.has(r.name));
const bold = compiled.find(r => r.name === "Replace Bold Markdown");
const emptyRows = compiled.find(r => r.name === "Remove Empty Choice Rows");

// {{user}} and {{char}} in Pura's cards, the way SillyTavern would fill them.
function names() {
    try {
        const ctx = globalThis.SillyTavern && typeof globalThis.SillyTavern.getContext === "function" ? globalThis.SillyTavern.getContext() : null;
        const name = (v, fallback) => (typeof v === "string" && v ? v : fallback);
        return { user: name(ctx && ctx.name1, "user"), char: name(ctx && ctx.name2, "char") };
    } catch (e) { return { user: "user", char: "char" }; }
}

// A replacement string's $1…$99, the way String.replace reads them: a two-digit number
// only when that group exists.
function fill(replace, groups, who) {
    return replace
        .replace(/\$(\d\d?)/g, (m, d) => {
            let n = Number(d);
            let rest = "";
            if (n > groups.length && d.length === 2) { n = Number(d[0]); rest = d[1]; }
            if (n < 1 || n > groups.length) return m;
            return esc(groups[n - 1] == null ? "" : groups[n - 1]) + rest;
        })
        .replace(/\{\{user\}\}/gi, esc(who.user))
        .replace(/\{\{char\}\}/gi, esc(who.char));
}

/** A block body drawn with Pura's cards, or null when it holds no Pura tracker. */
export function renderPura(body) {
    const who = names();
    const cards = [];
    let text = String(body || "");
    for (const r of structural) {
        r.re.lastIndex = 0;
        text = text.replace(r.re, (...args) => {
            // (match, g1…gn, offset, string[, groups]): the groups sit between match and offset.
            const offsetAt = args.findIndex((a, i) => i > 0 && typeof a === "number");
            const groups = args.slice(1, offsetAt);
            cards.push(fill(r.replace, groups, who));
            return `\u0000${cards.length - 1}\u0000`;
        });
    }
    if (!cards.length) return null;
    // Whatever is left between the cards is the model's own text: shown, escaped, as is.
    let html = text.split(/\u0000(\d+)\u0000/).map((part, i) => (i % 2 ? cards[Number(part)] : esc(part.trim()).replace(/\n/g, "<br>"))).join("");
    if (bold) html = html.replace(bold.re, bold.replace);
    if (emptyRows) html = html.replace(emptyRows.re, "");
    return html;
}

/** One treatment for every Pura block: the parse is the drawing. */
export const PURA_TREATMENT = {
    parse: body => renderPura(body),
    render: html => `<div class="pura-cards">${html}</div>`,
    cls: "pura-pane",
};
