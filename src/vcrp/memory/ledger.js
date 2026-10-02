// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: chapters, the fact ledger, and the memory text the prompt carries.
//
// Drift is what this file is built against. Nothing the model wrote is rewritten by
// the model later:
//   - each stretch of chat is summarized once, from the raw messages, into a chapter
//     with a one-line gist;
//   - the "story so far" is those gists in order. Only when there are many are the
//     oldest ten folded into one arc line, and the fold reads the gists, not memory;
//   - durable facts live in a ledger the model can only change one entry at a time:
//     + add, ~ reword, - retire. An entry nobody touches stays word for word.
//
// Pure: parsing, applying changes, composing text. No SillyTavern.
// ─────────────────────────────────────────────────────────────────────────────

export const FACT_CATEGORIES = ["person", "relationship", "place", "item", "condition", "promise", "secret", "world", "thread"];

// Gists kept one by one before the oldest ten fold into an arc line.
export const FOLD_AT = 12, FOLD_COUNT = 10;

const tag = (text, name) => {
    const m = String(text || "").match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
    return m ? m[1].trim() : null;
};

/** Reasoning the model may have written before the answer is not part of it. */
const stripThinking = text => String(text || "").replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, "").trim();

/**
 * One fact change per line:
 *   + category | text        add
 *   ~ F12 | text             reword
 *   - F7 | reason            retire (the reason is optional and only for the reader)
 * A markdown bullet in front ("- + person | ...") is tolerated.
 */
export function parseFactChanges(block) {
    const ops = [];
    const skipped = [];
    for (let raw of String(block || "").split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || /^none\.?$/i.test(line)) continue;
        line = line.replace(/^[*•]\s+/, "").replace(/^-\s+(?=[+~])/, "");
        let m;
        if ((m = line.match(/^\+\s*\[?([A-Za-z]+)\]?\s*\|\s*(.+)$/))) {
            const cat = m[1].toLowerCase();
            ops.push({ op: "+", cat: FACT_CATEGORIES.includes(cat) ? cat : "world", text: m[2].trim() });
        } else if ((m = line.match(/^~\s*\[?(F\d+)\]?\s*\|\s*(.+)$/i))) {
            ops.push({ op: "~", id: m[1].toUpperCase(), text: m[2].trim() });
        } else if ((m = line.match(/^-\s*\[?(F\d+)\]?\s*(?:\|\s*(.*))?$/i))) {
            ops.push({ op: "-", id: m[1].toUpperCase(), reason: (m[2] || "").trim() });
        } else {
            skipped.push(raw.trim());
        }
    }
    return { ops, skipped };
}

/** The summary call's answer. ok is false when the chapter or its gist is missing. */
export function parseSummary(text) {
    const t = stripThinking(text);
    const gist = tag(t, "chapter_gist");
    const chapter = tag(t, "chapter");
    const changes = tag(t, "fact_changes");
    const arc = tag(t, "arc");
    const { ops, skipped } = parseFactChanges(changes || "");
    return { ok: !!(gist && chapter), gist: gist || "", chapter: chapter || "", ops, skipped, arc: arc || "", changesFound: changes !== null };
}

/** The check call's answer: "OK", or corrected tags. Unreadable answers count as unchecked. */
export function parseCheck(text) {
    const t = stripThinking(text);
    if (/^\s*ok\b/i.test(t) && !/<chapter>/i.test(t)) return { verdict: "ok" };
    const fixed = parseSummary(t);
    if (fixed.ok) return { verdict: "corrected", fixed };
    return { verdict: "unreadable" };
}

/** Writes changes back in the format the model reads them in. */
export function formatFactChanges(ops) {
    if (!ops || !ops.length) return "none";
    return ops.map(o => o.op === "+" ? `+ ${o.cat} | ${o.text}` : o.op === "~" ? `~ ${o.id} | ${o.text}` : `- ${o.id}${o.reason ? ` | ${o.reason}` : ""}`).join("\n");
}

/**
 * Applies changes to a copy of the ledger. Unknown ids are reported, not guessed at.
 * @returns {{ledger:object[], retired:object[], nextId:number, applied:object[], skipped:object[]}}
 */
export function applyFactChanges({ ledger = [], retired = [], nextId = 1 }, ops, chapterId) {
    const out = ledger.map(f => ({ ...f }));
    const gone = retired.map(f => ({ ...f }));
    const applied = [], skipped = [];
    for (const o of ops || []) {
        if (o.op === "+") {
            const f = { id: `F${nextId++}`, cat: o.cat, text: o.text, since: chapterId, updated: chapterId };
            out.push(f); applied.push({ ...o, id: f.id });
            continue;
        }
        const i = out.findIndex(f => f.id === o.id);
        if (i < 0) { skipped.push(o); continue; }
        if (o.op === "~") { out[i] = { ...out[i], text: o.text, updated: chapterId }; applied.push(o); }
        else { gone.push({ ...out[i], retiredIn: chapterId, reason: o.reason || "" }); out.splice(i, 1); applied.push(o); }
    }
    return { ledger: out, retired: gone, nextId, applied, skipped };
}

/** The ledger as the summarizer reads it: one fact per line, id first. */
export function formatLedgerForTask(ledger) {
    if (!ledger || !ledger.length) return "(empty)";
    return ledger.map(f => `${f.id} [${f.cat}] ${f.text}`).join("\n");
}

/** The gists still waiting to be folded, oldest first, when there are enough to fold. */
export function gistsToFold(chapters) {
    const open = (chapters || []).filter(c => !c.folded);
    return open.length >= FOLD_AT ? open.slice(0, FOLD_COUNT) : [];
}

const estimate = s => Math.ceil(String(s || "").length / 3.5);
// A fact's age is the chapter that last changed it; the reader's own edits count as newest.
const changedIn = f => (f.updated === "edit" ? Infinity : (parseInt(String(f.updated || f.since || "C0").slice(1), 10) || 0));

/**
 * The memory text within `capTokens`. Over the cap, the facts that changed longest ago are
 * left out of the text, oldest first; they stay in the ledger and come back through recall
 * when the scene touches them (recall.js). Returns the text and the ids left out.
 */
export function composeMemory(parts, isBeforeCut = () => true, capTokens = Infinity) {
    const ledger = parts.ledger || [];
    let text = composeMemoryText(parts, isBeforeCut);
    const hidden = [];
    if (estimate(text) <= capTokens) return { text, hidden };
    const keep = new Set(ledger.map(f => f.id));
    for (const f of [...ledger].sort((a, b) => changedIn(a) - changedIn(b))) {
        keep.delete(f.id);
        hidden.push(f.id);
        text = composeMemoryText({ ...parts, ledger: ledger.filter(x => keep.has(x.id)) }, isBeforeCut);
        if (estimate(text) <= capTokens) return { text, hidden };
    }
    // Still over with every fact out (a chat brought over from the old Memory Core can hold
    // a hundred gists): the oldest gists go next, then the oldest arcs. Their chapters stay,
    // and come back through recall when the scene touches them.
    let chapters = (parts.chapters || []).filter(c => !c.folded && isBeforeCut(c));
    let arcs = [...(parts.arcs || [])];
    const rest = { ...parts, ledger: [] };
    while (estimate(text) > capTokens && (chapters.length || arcs.length)) {
        if (chapters.length) chapters = chapters.slice(1); else arcs = arcs.slice(1);
        text = composeMemoryText({ ...rest, chapters, arcs }, () => true);
    }
    return { text, hidden };
}

/**
 * The memory text the prompt carries. `isBeforeCut(chapter)` keeps it to chapters that
 * end before the cut, so nothing the prompt still carries word for word is told twice.
 * Arcs are always before the cut: they fold the oldest chapters.
 */
export function composeMemoryText({ arcs = [], chapters = [], ledger = [] }, isBeforeCut = () => true) {
    const lines = [];
    for (const a of arcs) lines.push(`- ${a.text}`);
    for (const c of chapters) if (!c.folded && isBeforeCut(c)) lines.push(`- ${c.gist}`);
    const parts = [];
    if (lines.length) parts.push(`<story_so_far>\n${lines.join("\n")}\n</story_so_far>`);
    if (ledger.length) parts.push(`<facts>\n${ledger.map(f => `- [${f.cat}] ${f.text}`).join("\n")}\n</facts>`);
    if (!parts.length) return "";
    return `<story_memory>\nWhat happened before the messages below, and the facts that still hold. Treat both as canon.\n${parts.join("\n")}\n</story_memory>`;
}
