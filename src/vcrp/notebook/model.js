// ─────────────────────────────────────────────────────────────────────────────
// Author's Notebook: the parser, the rules and the text the model reads.
//
// Megumin Suite V11's (Megumin-Suite-Beta, commit 2935045: state/modules/notebook/parse.js,
// model.js and render.js), ported as written: the same two blocks, the same rules, the
// same wording for the model. What is VCRP's is where the state comes from (notebook/
// index.js): it is read back from the chat's own replies each turn, so a swipe, an edit or
// a deleted message changes it exactly as it changed the story, with no history kept apart.
//
// Two blocks, both written after the story:
//   <Notebook>         the setup: two or three full entries
//   <Notebook_Update>  one line per change:
//                        Clue T1: <the clue this turn's story showed>
//                        Learned T1: <who found it out>
//                        Truth-: T1           (it came out)
//                        Truth+: T3           (a new truth, its lines follow)
//
// The rules live here, not only in the prompt:
//   - ids are ours: a new truth gets the next free id whatever the model wrote, and ids
//     are never reused (a forgotten T2 stays gone);
//   - at most LIVE_CAP truths are live; a new one past that is ignored;
//   - a truth written again word for word is the same truth, not a new one;
//   - first wins: one clue, one Learned and one Truth- per truth per reply;
//   - the model can't edit a truth. Only the reader's own changes (edit, forget, reveal,
//     restore) change one.
// A truth is revealed by Truth-, or when Learned empties its Hidden from list.
//
// Pure: no SillyTavern, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

export const NOTEBOOK_TAGS = ["Notebook", "Notebook_Update"];
export const LIVE_CAP = 3;

export const emptyNotebook = () => ({ truths: {}, next: 1 });
export const isLive = t => Boolean(t) && t.revealedSeq == null && !t.revealedHow;
export const liveTruths = state => Object.values((state && state.truths) || {}).filter(isLive);
export const pastTruths = state => Object.values((state && state.truths) || {}).filter(t => !isLive(t));

export function statKey(s) {
    return String(s || "")
        .replace(/["“”'‘’]/g, "")
        .replace(/[*_`~]/g, "")
        .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every body of <Tag>…</Tag> in a reply (an unclosed last one included), thinking left out. */
export function extractTagBodies(text, tag) {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)(<\\/${tag}\\s*>|$)`, "gi");
    const src = String(text || "")
        .replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "")
        .replace(/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/gi, "")
        .replace(/<\/?details\b[^>]*>/gi, "");
    let m;
    while ((m = re.exec(src)) !== null) {
        out.push(m[1]);
        if (!m[2]) break;
    }
    return out;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Entry field labels → keys. Anything else in an entry ("Clues planted:", a copied
// "Live truths" line) is not the model's to write and is left out.
const FIELD_KEYS = [
    [/^truth$/, "truth"],
    [/^hidden\s*from$/, "hiddenFrom"],
    [/^comes?\s*out\s*when$/, "when"],
    [/^what\s*it\s*changes$/, "changes"],
    [/^clue\s*ideas?$/, "clueIdeas"],
];

/** "T1", "t 1", "#T1", "**T1**" → "T1"; anything else → null. */
export function truthId(raw) {
    const m = String(raw || "").replace(/[*_`#[\]()]/g, "").trim().match(/^t\s*(\d+)$/i);
    return m ? `T${Number(m[1])}` : null;
}

function cleanLine(raw) {
    return String(raw || "")
        .replace(/<!--[\s\S]*?(-->|$)/g, "")
        .replace(/<\/?[a-z][^>]*>/gi, " ")
        .replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "")
        .replace(/\*\*|__/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// The template's own lines ("[change lines]") are instructions, not values.
const isTemplateLine = l => /^\[[^\]]*\]$/.test(l) || /^no changes?\.?$/i.test(l);

function fieldOf(line) {
    const m = line.match(/^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
    if (!m) return null;
    const label = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    const hit = FIELD_KEYS.find(([re]) => re.test(label));
    return hit ? { key: hit[1], value: m[2].trim() } : null;
}

/** "Mira, Old Tomas and the reader" → ["Mira", "Old Tomas", "the reader"]. */
export function splitNames(text) {
    return String(text || "")
        .split(/\s*(?:,|;|\/|\band\b|&)\s*/i)
        .map(s => s.replace(/[.*_"“”]/g, "").trim())
        .filter(s => s && !/^(no ?one|nobody|none|-)$/i.test(s));
}

function finishEntry(e) {
    if (!e || !e.truth) return null;
    return {
        op: "entry", id: e.id || null, truth: e.truth, hiddenFrom: splitNames(e.hiddenFrom),
        when: e.when || "", changes: e.changes || "", clueIdeas: e.clueIdeas || "",
    };
}

// Field lines into entries. An id line ("T2") starts a new entry, and so does a second
// Truth: line, for a model that drops the id lines.
function readEntries(lines, startId = null) {
    const out = [];
    let cur = { id: startId };
    for (const line of lines) {
        const id = truthId(line.replace(/[:.—–-]+$/, ""));
        if (id) {
            const done = finishEntry(cur);
            if (done) out.push(done);
            cur = { id };
            continue;
        }
        const f = fieldOf(line);
        if (!f) continue;
        if (f.key === "truth" && cur.truth) {
            const done = finishEntry(cur);
            if (done) out.push(done);
            cur = { id: null };
        }
        if (!cur[f.key]) cur[f.key] = f.value;
    }
    const done = finishEntry(cur);
    if (done) out.push(done);
    return out;
}

const bodyLines = body => String(body || "").split("\n").map(cleanLine).filter(l => l && !isTemplateLine(l));

// ── The prose check ──────────────────────────────────────────────────────────

const STOP = new Set(("the a an and or but of to in on at by for with from into onto over under about after before " +
    "this that these those there their they them then than his her hers him she he its it's was were is are be been " +
    "being has have had not no never only just very some any all each every what when where which who whom why how " +
    "story turn clue page reply shows showed shown says said scene moment").split(" "));
const stem = w => (w.length > 5 ? w.slice(0, 5) : w);

/** The reply's story text: no thinking, no blocks, no tags. */
export function storyProse(text) {
    return String(text || "")
        .replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "")
        .replace(/<Blocks\b[^>]*>[\s\S]*?(<\/Blocks\s*>|$)/gi, "")
        .replace(/<(Notebook|Notebook_Update)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, "")
        .replace(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi, "")
        .replace(/<[^>]+>/g, " ");
}

// The words a clue line is about: lowercase, four letters or more, no small words, and no
// names (capitalised words), since a name alone says nothing about whether the clue itself
// is on the page.
function clueWords(clue) {
    const words = String(clue || "").match(/[\p{L}][\p{L}'’-]*/gu) || [];
    return words
        .filter(w => !/^\p{Lu}/u.test(w))
        .map(w => w.toLowerCase().replace(/['’]s$/, ""))
        .filter(w => w.length >= 4 && !STOP.has(w));
}

/** Does the prose share a real word with the clue? A clue with nothing to compare counts as found. */
export function clueInProse(clue, prose) {
    const want = clueWords(clue);
    if (!want.length) return true;
    const have = new Set((String(prose || "").toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || []).map(w => stem(w.replace(/['’]s$/, ""))));
    return want.some(w => have.has(stem(w)));
}

// A change line, as opposed to a field of a Truth+ entry ("Clue ideas:" is a field).
const CHANGE_LINE = /^(?:(?:clue|learned)\s*:?\s*t\s*\d|truth\s*[+-])/i;

// VCRP: spellings models use for the same change lines, read as written in the rules: the id
// in brackets ("Clue (T1):", "Learned [T1]:") and a dash that is not a hyphen ("Truth–: T1").
const normUpdateLine = l => l
    .replace(/^(clue|learned)\s*[([]\s*(t\s*\d+)\s*[)\]]/i, "$1 $2")
    .replace(/^truth\s*[–—−]/i, "Truth-");

/** Update lines (and any Truth+ entries) from one <Notebook_Update> body; `prose` for the clue check. */
export function parseUpdateLines(body, prose) {
    const ops = [];
    const lines = bodyLines(body).map(normUpdateLine);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;
        if ((m = line.match(/^truth\s*\+\s*:?\s*(.*)$/i))) {
            // Its lines run to the next change line.
            const own = [];
            let j = i + 1;
            while (j < lines.length && !CHANGE_LINE.test(lines[j])) own.push(lines[j++]);
            i = j - 1;
            const lead = m[1].trim();
            const id = truthId(lead.split(/\s+/)[0]);
            // "Truth+: T3 the ferryman is..." or "Truth+: the ferryman is..." put the truth on the same line.
            const rest = id ? lead.replace(/^\S+\s*[:—–-]?\s*/, "") : lead;
            const entries = readEntries(rest ? [`Truth: ${rest}`, ...own] : own, id);
            if (entries[0]) ops.push({ ...entries[0], op: "entry", id: entries[0].id || id });
            continue;
        }
        if ((m = line.match(/^truth\s*-\s*:?\s*(.*)$/i))) {
            const id = truthId(m[1].split(/[\s:—–-]+/)[0]);
            if (id) ops.push({ op: "out", id });
            continue;
        }
        if ((m = line.match(/^(clue|learned)\s*:?\s*(t\s*\d+)\s*[:—–-]?\s*(.*)$/i))) {
            const id = truthId(m[2]);
            const value = m[3].trim();
            if (!id || !value) continue;
            if (m[1].toLowerCase() === "clue") ops.push({ op: "clue", id, text: value, found: clueInProse(value, prose) });
            else ops.push({ op: "learned", id, names: splitNames(value) });
        }
    }
    return ops;
}

/** Everything a reply wrote to the notebook: { ops } or null. */
export function parseNotebook(text) {
    const prose = storyProse(text);
    // A model that echoes its instructions or the notebook it was given has not written
    // anything: those sections never count.
    const src = String(text || "").replace(/<(Notebook_Setup|Notebook_Update_Rules|Author_Notebook)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, "");
    const ops = [];
    for (const body of extractTagBodies(src, "Notebook")) ops.push(...readEntries(bodyLines(body)));
    for (const body of extractTagBodies(src, "Notebook_Update")) ops.push(...parseUpdateLines(body, prose));
    return ops.length ? { ops } : null;
}

// ── The rules ────────────────────────────────────────────────────────────────

const READER = new Set(["reader", "the reader"]);

/** The Hidden from name this one means: exact, "the reader", then a unique first name. */
export function findHiddenName(list, name) {
    const k = statKey(name);
    if (!k) return -1;
    const keys = list.map(statKey);
    const i = keys.indexOf(k);
    if (i >= 0) return i;
    if (READER.has(k)) return keys.findIndex(x => READER.has(x));
    const first = k.split(" ")[0];
    const hits = keys.map((x, j) => (x.split(" ")[0] === first ? j : -1)).filter(j => j >= 0);
    return hits.length === 1 && first.length > 2 ? hits[0] : -1;
}

function reveal(t, seq, how) {
    t.revealedSeq = typeof seq === "number" ? seq : 0;
    t.revealedHow = how;
}

const EDITABLE = ["truth", "hiddenFrom", "when", "changes", "clueIdeas", "clues"];
const READER_OPS = new Set(["forget", "edit", "reveal", "restore"]);

/**
 * One reply's (or one reader change's) ops applied to the notebook at turn `seq`.
 * Returns { state, applied, notes }; `prev` is left as it was.
 */
export function applyNotebook(prev, parsed, { seq = 0 } = {}) {
    const state = JSON.parse(JSON.stringify(prev || emptyNotebook()));
    state.truths = state.truths || {};
    state.next = state.next || 1;
    const applied = [];
    const notes = [];
    if (!parsed || !Array.isArray(parsed.ops)) return { state, applied, notes };
    const idMap = {};     // the id the model wrote for a new truth → the one it got
    const done = new Set();

    for (const op of parsed.ops) {
        if (!op) continue;

        if (op.op === "entry") {
            const same = Object.values(state.truths).find(t => statKey(t.truth) === statKey(op.truth));
            if (same) { if (op.id) idMap[op.id] = same.id; continue; }
            if (liveTruths(state).length >= LIVE_CAP) { notes.push(`New truth left out: ${LIVE_CAP} are already live.`); continue; }
            const hiddenFrom = (op.hiddenFrom || []).filter(Boolean);
            if (!hiddenFrom.length) { notes.push("New truth left out: it is hidden from no one."); continue; }
            const id = `T${state.next++}`;
            if (op.id) idMap[op.id] = id;
            state.truths[id] = {
                id, truth: op.truth, hiddenFrom,
                when: op.when || "", changes: op.changes || "", clueIdeas: op.clueIdeas || "",
                clues: [], createdSeq: seq, revealedSeq: null, revealedHow: null,
            };
            applied.push({ op: "entry", id, text: op.truth, hiddenFrom, when: op.when || "", changes: op.changes || "", clueIdeas: op.clueIdeas || "" });
            continue;
        }

        const id = idMap[op.id] || op.id;
        const t = state.truths[id];
        if (!t) { notes.push(`${op.id || "?"} is not in the notebook.`); continue; }

        // VCRP: a reader's change names its truth by id and by what it said then. Once the reply
        // that wrote it is swiped or edited, the id can be another truth's, and the change is left
        // out rather than applied to that one.
        if (READER_OPS.has(op.op) && op.was && statKey(t.truth) !== op.was) { notes.push(`${id} is not the truth your change was for.`); continue; }

        // The reader's own changes, from the Focus tab.
        if (op.op === "forget") {
            delete state.truths[id];
            applied.push({ op: "forget", id, text: t.truth });
            continue;
        }
        if (op.op === "edit") {
            // VCRP: each field in the shape the rest reads (a chat file edited by hand, or broken,
            // must not leave a truth that cannot be drawn).
            for (const k of EDITABLE) {
                const v = op.fields && typeof op.fields === "object" ? op.fields[k] : undefined;
                if (v === undefined || v === null) continue;
                if (k === "hiddenFrom") t.hiddenFrom = Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()) : splitNames(v);
                else if (k === "clues") { if (Array.isArray(v)) t.clues = v.filter(c => c && typeof c.text === "string").map(c => ({ text: c.text, seq: Number(c.seq) || 0, found: c.found !== false })); }
                else t[k] = String(v);
            }
            if (isLive(t) && !t.hiddenFrom.length) reveal(t, seq, "user");
            applied.push({ op: "edit", id, text: t.truth });
            continue;
        }
        if (op.op === "reveal") {
            if (isLive(t)) { reveal(t, seq, "user"); applied.push({ op: "out", id, text: t.truth }); }
            continue;
        }
        if (op.op === "restore") {
            if (!isLive(t)) {
                if (liveTruths(state).length >= LIVE_CAP) { notes.push(`${id} stays in the past: ${LIVE_CAP} are already live.`); continue; }
                t.revealedSeq = null; t.revealedHow = null;
                applied.push({ op: "restore", id, text: t.truth });
            }
            continue;
        }

        // The model's ops: first wins, and only on a live truth.
        const key = `${op.op}|${id}`;
        if (done.has(key)) continue;
        done.add(key);
        if (!isLive(t)) { notes.push(`${id} has already come out.`); continue; }

        if (op.op === "clue") {
            const clue = { text: op.text, seq, found: op.found !== false };
            t.clues.push(clue);
            applied.push({ op: "clue", id, text: op.text, found: clue.found });
        } else if (op.op === "learned") {
            const who = [];
            for (const name of op.names || []) {
                const i = findHiddenName(t.hiddenFrom, name);
                if (i < 0) continue;
                who.push(t.hiddenFrom[i]);
                t.hiddenFrom.splice(i, 1);
            }
            if (!who.length) { notes.push(`${id}: ${(op.names || []).join(", ") || "no one"} was not on its Hidden from list.`); continue; }
            applied.push({ op: "learned", id, text: who.join(", ") });
            if (!t.hiddenFrom.length) {
                reveal(t, seq, "learned");
                applied.push({ op: "out", id, text: t.truth });
            }
        } else if (op.op === "out") {
            reveal(t, seq, "out");
            applied.push({ op: "out", id, text: t.truth });
        }
    }
    return { state, applied, notes };
}

// ── What the model reads ─────────────────────────────────────────────────────

/** "setup" (no live truth: write the notebook), "running", or "off". */
export function notebookPhase(state, { on = true } = {}) {
    if (!on) return "off";
    return liveTruths(state).length ? "running" : "setup";
}

function truthLines(t) {
    const lines = [t.id, `Truth: ${t.truth}`, `Hidden from: ${t.hiddenFrom.join(", ")}`];
    if (t.when) lines.push(`Comes out when: ${t.when}`);
    if (t.changes) lines.push(`What it changes: ${t.changes}`);
    if (t.clueIdeas) lines.push(`Clue ideas: ${t.clueIdeas}`);
    if (t.clues.length) {
        lines.push("Clues planted:");
        for (const c of t.clues) lines.push(`- turn ${c.seq}: ${c.text}`);
    }
    return lines;
}

/** <Author_Notebook>: the live truths only. "" when none. */
export function renderNotebookForPrompt(state) {
    const live = liveTruths(state);
    if (!live.length) return "";
    const out = ["<Author_Notebook>"];
    live.forEach((t, i) => { if (i) out.push(""); out.push(...truthLines(t)); });
    out.push("", `Live truths: ${live.length} of ${LIVE_CAP}. Next id: T${state.next || 1}.`, "</Author_Notebook>");
    return out.join("\n");
}

/** One applied change as a line for the card. */
export function describeNotebookChange(ch) {
    switch (ch && ch.op) {
        case "entry": return `${ch.id} written: ${ch.text}`;
        case "clue": return `${ch.id} clue: ${ch.text}${ch.found === false ? " (not found in the reply)" : ""}`;
        case "learned": return `${ch.id} learned by ${ch.text}`;
        case "out": return `${ch.id} came out: ${ch.text}`;
        case "edit": return `${ch.id} edited`;
        case "forget": return `${ch.id} deleted`;
        case "restore": return `${ch.id} activated again`;
        default: return "";
    }
}
