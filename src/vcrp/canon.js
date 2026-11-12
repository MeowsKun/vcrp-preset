// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Canon sheet.
//
// The few facts of a story that must never change: who people are to one another, what the
// world allows, what was promised. Kept per chat, written or approved by the reader, and sent
// with every reply in the cached part of the prompt (the always-on knowledgebase slot, before
// the chat), where a line costs a fraction of its price after the first request. A preset
// from before that slot gets it after the chat instead, every turn.
//
// Most of its lines come from Story Memory's fact ledger: the panel offers the facts that
// have stood longest (and the pinned ones), and a fact taken from there is pinned in the
// ledger too, so no summary rewords it without the reader's review (summarize.js). Nothing is
// added by itself. The continuity check (continuity.js) reads each reply against the sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { chat_metadata } from "../st.js";

const META = "vcrp_canon";        // chat_metadata: { items: [{ id, text, from }], seq }
export const CANON_SOFT_MAX = 30; // lines; past it the panel says the sheet is getting long
const LINE_MAX = 400;             // characters one line may take

const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, LINE_MAX);
const key = s => clean(s).toLowerCase().replace(/[.!\s]+$/, "");

function state(create = false) {
    if (!chat_metadata) return null;
    let st = chat_metadata[META];
    if ((!st || typeof st !== "object" || !Array.isArray(st.items)) && create) st = chat_metadata[META] = { items: [], seq: 0 };
    return st && Array.isArray(st.items) ? st : null;
}

/** This chat's Canon lines, in order: [{ id, text, from }] (copies). `from` is the ledger fact a line came from, or "". */
export function canonItems() {
    const st = state();
    return st ? st.items.filter(i => i && clean(i.text)).map(i => ({ id: i.id, text: clean(i.text), from: i.from || "" })) : [];
}

/**
 * Adds a line. Returns the new item, or null when it is empty or already on the sheet (the
 * same words, or the same ledger fact).
 */
export function addCanon(text, from = "") {
    const line = clean(text);
    if (!line) return null;
    const st = state(true);
    if (!st) return null;
    if (st.items.some(i => key(i.text) === key(line) || (from && i.from === from))) return null;
    st.seq = (Number(st.seq) || 0) + 1;
    const item = { id: `K${st.seq}`, text: line, from: String(from || "") };
    st.items.push(item);
    return { ...item };
}

/** Rewords a line (an emptied line is removed). Returns true when something changed. */
export function editCanon(id, text) {
    const st = state();
    const item = st && st.items.find(i => i.id === id);
    if (!item) return false;
    const line = clean(text);
    if (!line) return removeCanon(id);
    if (line === item.text) return false;
    item.text = line;
    return true;
}

/** Takes a line off the sheet. */
export function removeCanon(id) {
    const st = state();
    if (!st) return false;
    const before = st.items.length;
    st.items = st.items.filter(i => i.id !== id);
    return st.items.length !== before;
}

// Which kinds of fact are most likely to be canon, first.
const CATEGORY_RANK = ["relationship", "person", "world", "promise", "secret", "place", "condition", "item", "thread"];
const chapterNumber = id => Number(String(id || "").replace(/\D/g, "")) || 0;

/**
 * Ledger facts worth offering for the sheet (pure): the pinned ones first, then the facts
 * that have stood longest unchanged, people and their ties before places and things. Facts
 * already on the sheet are left out.
 * @param {{id:string,cat:string,text:string,since?:string,updated?:string,pinned?:boolean}[]} ledger
 */
export function canonSuggestions(ledger, items = canonItems(), limit = 8) {
    const taken = new Set(items.map(i => i.from).filter(Boolean));
    const said = new Set(items.map(i => key(i.text)));
    const rank = f => { const r = CATEGORY_RANK.indexOf(f.cat); return r < 0 ? CATEGORY_RANK.length : r; };
    return (Array.isArray(ledger) ? ledger : [])
        .filter(f => f && f.id && clean(f.text) && !taken.has(f.id) && !said.has(key(f.text)))
        // A fact never reworded since the chapter that set it down has stood the longest.
        .map(f => ({ f, stood: f.updated && f.since && f.updated !== f.since ? chapterNumber(f.updated) : chapterNumber(f.since) }))
        .sort((a, b) => (b.f.pinned ? 1 : 0) - (a.f.pinned ? 1 : 0) || a.stood - b.stood || rank(a.f) - rank(b.f))
        .slice(0, limit)
        .map(x => ({ id: x.f.id, cat: x.f.cat, text: clean(x.f.text), pinned: !!x.f.pinned }));
}

// A line must not close the tag it is sent in.
const guard = s => String(s).replace(/<(\/?)canon\b/gi, "‹$1canon");

/** The sheet as the model reads it; "" when it is empty. */
export function canonBlock(items = canonItems()) {
    if (!items.length) return "";
    return `<canon>\nThe facts of this story that never change. Nothing in a reply contradicts them, and they outrank anything else remembered of the story.\n${items.map(i => `- ${guard(i.text)}`).join("\n")}\n</canon>`;
}

/** About how many tokens the sheet takes in the prompt (the same estimate Story Memory uses). */
export const canonTokens = (items = canonItems()) => Math.ceil(canonBlock(items).length / 3.5);
