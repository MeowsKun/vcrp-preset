// ─────────────────────────────────────────────────────────────────────────────
// The Notebook tab of a reply's card: what that reply did to the Author's Notebook, a
// spoiler. Every line is blurred until hovered or tapped, as V11 keeps it behind a warning.
// Drawn by the card's treatments (blocks/treatments.js) from the block's own lines, then, in
// the chat, from what VCRP applied (features/blocks/chat.js): its ids, nothing it refused.
// Everything shown is escaped.
// ─────────────────────────────────────────────────────────────────────────────

import { esc } from "../../blocks/text.js";
import { describeNotebookChange } from "./model.js";

const ICONS = [
    [/^truth\s*\+/i, "✍️"], [/^truth\s*[-–—−]/i, "📖"], [/^clue\b/i, "🔎"], [/^learned\b/i, "👁️"], [/^t\s*\d+\s*$/i, "📓"],
];
const OP_ICONS = { entry: "✍️", clue: "🔎", learned: "👁️", out: "📖" };
const WARN = `<div class="vcrp-nb-warn">Spoilers: what the story keeps hidden. Hover or tap a line to read it.</div>`;
const row = (text, icon = "") => `<div class="vcrp-nb-line" tabindex="0">${icon ? `<b>${icon}</b> ` : ""}<span>${esc(text)}</span></div>`;

/** The block's lines, or null when there is nothing but its template. */
export function parseNotebookCard(body) {
    const lines = String(body || "").split("\n")
        .map(l => l.replace(/<[^>]+>/g, " ").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim())
        .filter(l => l && !/^\[[^\]]*\]$/.test(l) && !/^no changes?\.?$/i.test(l));
    return lines.length ? { lines } : null;
}

/** The block as the model wrote it. */
export function renderNotebookCard(parsed) {
    return `<div class="vcrp-nb">${WARN}${parsed.lines.map(l => row(l, (ICONS.find(([re]) => re.test(l)) || [null, ""])[1])).join("")}</div>`;
}

const DETAILS = [["hiddenFrom", "Hidden from"], ["when", "Comes out when"], ["changes", "What it changes"], ["clueIdeas", "Clue ideas"]];

/** What the reply did, as applied (notebookChangesAt): a new truth with its lines, a clue, who found out, what came out. */
export function renderNotebookApplied(applied) {
    if (!applied.length) {
        return `<div class="vcrp-nb">${WARN}<div class="set-desc">Nothing here changed the notebook: it was already there, or past what the rules allow.</div></div>`;
    }
    const rows = [];
    for (const ch of applied) {
        rows.push(row(describeNotebookChange(ch), OP_ICONS[ch.op] || ""));
        if (ch.op !== "entry") continue;
        for (const [key, label] of DETAILS) {
            const v = Array.isArray(ch[key]) ? ch[key].join(", ") : ch[key];
            if (v) rows.push(row(`${label}: ${v}`));
        }
    }
    return `<div class="vcrp-nb">${WARN}${rows.join("")}</div>`;
}
