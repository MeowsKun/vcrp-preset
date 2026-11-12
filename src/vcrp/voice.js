// ─────────────────────────────────────────────────────────────────────────────
// VCRP: voices. How each character spoke when the story began, kept in front of the writer,
// and a meter that says when one of them no longer speaks that way.
//
// A long story wears its characters down: the blunt one softens, the formal one loosens,
// everyone ends up sounding like the same agreeable person. The card says who a character is;
// it does not say how this story has been writing them. Their own lines do. Dialogue Colors
// tags each spoken line with its speaker (dialogueColors.js), so the chat already holds every
// character's lines in order, and nothing here calls a model:
//
//   - Voice anchors: each character's earliest lines of some length, in their own words. For
//     the characters in the scene they ride with the per-turn rules ([[focus]], after the chat,
//     never cached), once those lines lie far enough back that the model no longer sees them
//     as recent. The reader can write a character's lines themselves, hide one, or leave a
//     character out.
//   - The drift meter: a character's latest lines measured against their earliest, by counting
//     (how long the lines run, contractions, questions and exclamations, hesitation, soft and
//     harsh words, the words they open and close on). It cannot tell a character who has grown
//     from one who has drifted, so it decides nothing by itself: it tells the Focus audit when
//     to look (focus/index.js), and the audit, which reads, makes the call.
//
// Without speaker names on the lines (the add-on off, or a model that leaves them out) there
// is nothing to read, and both stay quiet; the reader's own lines still go out.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata } from "../st.js";
import { localProfile } from "../core/state.js";
import { speakerLines, lockedColors } from "./dialogueColors.js";
import { sceneNames } from "./scene.js";
import { anchorOf, resolveAnchor } from "./memory/index.js";

const META = "vcrp_voice";        // chat_metadata: { chars: { key: { name, own: [text], hidden: [text], off, from } } }

export const ANCHOR_KEPT = 4;     // lines kept for a character (the reader's own first)
export const ANCHOR_SENT = 2;     // of them, sent
const SENT_CHARACTERS = 4;        // characters sent at most, the scene's order
const ANCHOR_MIN_WORDS = 5;       // shorter says too little of a voice ("Fine.")
const ANCHOR_MAX_WORDS = 40;      // longer is a speech, not a sample
const ANCHOR_AGE = 16;            // messages a line must lie back before it is sent: nearer, it is in plain sight
const LINE_CHARS = 260;           // of one line, sent

// The meter's samples: the earliest lines against the latest, never overlapping.
export const METER_MIN_LINES = 40;   // tagged lines a character needs before the meter reads them
const BASE_LINES = 30;
const RECENT_LINES = 30;             // enough to span more than the scene being played
export const DRIFT_SHIFTING = 35;    // from here the meter says "shifting"
export const DRIFT_MARK = 55;        // from here "drifting": an audit is called for

/** The switches (the profile's): anchors sent, and the meter deciding when audits run. On by default. */
export function voiceSettings() {
    const v = (localProfile && localProfile.focus && localProfile.focus.voice) || {};
    return { anchors: v.anchors !== false, meter: v.meter !== false };
}

// ── Reading the chat ─────────────────────────────────────────────────────────

const WORD = /[\p{L}][\p{L}'’-]*/gu;
const wordsOf = s => (String(s || "").match(WORD) || []).map(w => w.toLowerCase().replace(/’/g, "'"));
const sameLine = s => wordsOf(s).join(" ");

/**
 * Every tagged line in `chat`, by speaker, oldest first: Map key → { name, lines: [{ text, at }] }.
 * `user` (the reader's character) is left out: their lines are the reader's. A name is matched
 * to the speakers already met the way the colors are, so "Mara Reyes" joins "Mara".
 */
export function linesBySpeaker(chat, { user = "", names = lockedColors() } = {}) {
    const known = {};
    for (const [k, v] of Object.entries(names || {})) known[k] = { name: (v && v.name) || k, color: (v && v.color) || "" };
    const mine = new Set(wordsOf(user));
    const isUser = name => { const w = wordsOf(name); return w.length > 0 && w.every(x => mine.has(x)); };
    const out = new Map();
    (Array.isArray(chat) ? chat : []).forEach((m, at) => {
        if (!m || m.is_user || m.is_system || typeof m.mes !== "string" || !m.mes.includes("<font")) return;
        for (const l of speakerLines(m.mes, known)) {
            if (isUser(l.name)) continue;
            if (!known[l.key]) known[l.key] = { name: l.name, color: "" };
            if (!out.has(l.key)) out.set(l.key, { name: known[l.key].name || l.name, lines: [] });
            out.get(l.key).lines.push({ text: l.text, at });
        }
    });
    return out;
}

// One reading of the chat serves the prompt, the meter and the tab: read again only when the
// chat has changed (another chat, another length, another newest message).
let cache = { chat: null, length: -1, last: "", user: "", colors: "", value: null };
function readChat() {
    let ctx = null;
    try { ctx = getContext() || {}; } catch (e) { ctx = {}; }
    // The whole chat, a reply being swiped included: its few lines change no reading, and a
    // reading must not shift with what the last generation happened to be.
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const lastMes = chat.length ? String((chat[chat.length - 1] || {}).mes || "") : "";
    const user = typeof ctx.name1 === "string" ? ctx.name1 : "";
    const colors = Object.keys(lockedColors()).join("|");
    if (cache.chat === chat && cache.length === chat.length && cache.last === lastMes && cache.user === user && cache.colors === colors && cache.value) return cache.value;
    const value = { chat, speakers: linesBySpeaker(chat, { user }) };
    cache = { chat, length: chat.length, last: lastMes, user, colors, value };
    return value;
}

/** For tests, and when another chat is opened. */
export function forgetVoiceReading() {
    cache = { chat: null, length: -1, last: "", user: "", colors: "", value: null };
}

// ── The reader's part (kept with the chat) ───────────────────────────────────

function state(create = false) {
    if (!chat_metadata) return null;
    let st = chat_metadata[META];
    if ((!st || typeof st !== "object" || !st.chars || typeof st.chars !== "object") && create) st = chat_metadata[META] = { chars: {} };
    return st && st.chars && typeof st.chars === "object" ? st : null;
}
const saved = key => { const st = state(); return (st && st.chars[key]) || null; };
function entry(key, name) {
    const st = state(true);
    if (!st) return null;
    if (!st.chars[key]) st.chars[key] = { name: name || key, own: [], hidden: [], off: false };
    const e = st.chars[key];
    if (!Array.isArray(e.own)) e.own = [];
    if (!Array.isArray(e.hidden)) e.hidden = [];
    return e;
}
const save = async () => { try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Voices: could not save the chat's data", e); } };
const tidy = s => String(s || "").replace(/\s+/g, " ").trim().replace(/^["“„«]+|["”»]+$/g, "").trim().slice(0, 400);

/** Adds a line the reader wrote for a character (a new character when `key` is not known). */
export async function addOwnLine(key, text, name = "") {
    const line = tidy(text);
    const k = String(key || name || "").trim().toLowerCase();
    if (!line || !k) return false;
    const e = entry(k, name || k);
    if (!e || e.own.some(x => sameLine(x) === sameLine(line))) return false;
    e.own.push(line);
    await save();
    return true;
}

/** Takes one of the reader's own lines back out. */
export async function removeOwnLine(key, text) {
    const e = saved(key);
    if (!e || !Array.isArray(e.own)) return false;
    const before = e.own.length;
    e.own = e.own.filter(x => sameLine(x) !== sameLine(text));
    if (e.own.length === before) return false;
    await save();
    return true;
}

/** Hides one of a character's early lines: the next one in the chat takes its place. */
export async function hideLine(key, text, name = "") {
    const e = entry(key, name);
    if (!e || e.hidden.includes(sameLine(text))) return false;
    e.hidden.push(sameLine(text));
    await save();
    return true;
}

/** Puts every hidden line of a character back. */
export async function showHiddenLines(key) {
    const e = saved(key);
    if (!e || !Array.isArray(e.hidden) || !e.hidden.length) return false;
    e.hidden = [];
    await save();
    return true;
}

/** Leaves a character out of the prompt (their lines stay listed), or lets them back in. */
export async function setVoiceOff(key, off, name = "") {
    const e = entry(key, name);
    if (!e) return;
    e.off = !!off;
    await save();
}

// A character the story has changed speaks differently for good reason, and their first lines
// would pull them back. The reader can say so: from then on that character's voice is taken
// from their last dozen lines on (their anchors and the meter's "before" both), so the meter
// reads them again once they have spoken enough since.
const ACCEPTED_LINES = 12;
function linesSince(chat, sp, e) {
    if (!sp) return [];
    if (!e || !e.from) return sp.lines;
    const at = resolveAnchor(chat, e.from);
    return at > 0 ? sp.lines.filter(l => l.at >= at) : sp.lines;
}

/** "This is their voice now": the character's voice is read from their latest lines on. */
export async function acceptVoiceNow(key) {
    const { chat, speakers } = readChat();
    const sp = speakers.get(key);
    if (!sp || !sp.lines.length) return false;
    const e = entry(key, sp.name);
    if (!e) return false;
    const first = sp.lines[Math.max(0, sp.lines.length - ACCEPTED_LINES)];
    e.from = anchorOf(chat, first.at);
    e.hidden = [];
    await save();
    return true;
}

/** Back to the character's first lines in the chat. */
export async function resetVoiceStart(key) {
    const e = saved(key);
    if (!e || !e.from) return false;
    delete e.from;
    await save();
    return true;
}

// ── Voice anchors ────────────────────────────────────────────────────────────

/** The earliest lines of some length among `lines`, none twice, `hidden` (normalised) left out. */
export function earliestLines(lines, { hidden = [], limit = ANCHOR_KEPT } = {}) {
    const skip = new Set(hidden);
    const seen = new Set();
    const out = [];
    for (const l of lines || []) {
        const n = wordsOf(l.text).length;
        const k = sameLine(l.text);
        if (n < ANCHOR_MIN_WORDS || n > ANCHOR_MAX_WORDS || skip.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push({ text: l.text, at: l.at });
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Every character with lines on file, for the tab: [{ key, name, off, total, since, anchors:
 * [{ text, at, own }], hidden }]. The reader's own lines come first; `at` is the message a
 * line is from; `since`: the reader took this character's voice from a later point.
 */
export function voiceCharacters() {
    const { chat, speakers } = readChat();
    const st = state();
    const keys = new Set([...speakers.keys(), ...Object.keys((st && st.chars) || {})]);
    const out = [];
    for (const key of keys) {
        const sp = speakers.get(key);
        const e = (st && st.chars[key]) || {};
        const own = (Array.isArray(e.own) ? e.own : []).map(text => ({ text, at: -1, own: true }));
        const early = sp ? earliestLines(linesSince(chat, sp, e), { hidden: Array.isArray(e.hidden) ? e.hidden : [], limit: Math.max(0, ANCHOR_KEPT - own.length) }).map(l => ({ ...l, own: false })) : [];
        if (!own.length && !early.length && !sp) continue;
        out.push({ key, name: (sp && sp.name) || e.name || key, off: !!e.off, total: sp ? sp.lines.length : 0, since: !!e.from, anchors: [...own, ...early], hidden: Array.isArray(e.hidden) ? e.hidden.length : 0 });
    }
    return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// Who a name from the scene list stands for among the characters on file: the same name, or
// one holding the other word for word ("Mara" and "Mara Reyes"), when only one fits.
function matchCharacter(chars, name) {
    const w = wordsOf(name);
    if (!w.length) return null;
    const exact = chars.find(c => wordsOf(c.name).join(" ") === w.join(" ") || c.key === w.join(" "));
    if (exact) return exact;
    const loose = chars.filter(c => { const theirs = wordsOf(c.name); return theirs.length && (w.every(x => theirs.includes(x)) || theirs.every(x => w.includes(x))); });
    return loose.length === 1 ? loose[0] : null;
}

/**
 * Whose anchors go out now: [{ name, lines: [text] }]. The characters in the scene (the newest
 * scene list; without one, whoever spoke in the last few replies), each with lines that lie
 * far enough back (the reader's own always count).
 */
export function anchorsInScene() {
    const { chat, speakers } = readChat();
    const chars = voiceCharacters().filter(c => !c.off && c.anchors.length);
    if (!chars.length) return [];
    let present = [];
    try { present = sceneNames().map(n => matchCharacter(chars, n)).filter(Boolean); } catch (e) { present = []; }
    if (!present.length) {
        // No scene list: whoever spoke in the last three replies, the latest speaker first.
        const from = (() => { let seen = 0, i = chat.length - 1; for (; i >= 0 && seen < 3; i--) if (chat[i] && !chat[i].is_user && !chat[i].is_system) seen++; return i + 1; })();
        const recent = [];
        for (const [key, sp] of speakers) {
            const last = sp.lines.length ? sp.lines[sp.lines.length - 1].at : -1;
            if (last >= from) recent.push({ key, last });
        }
        present = recent.sort((a, b) => b.last - a.last).map(r => chars.find(c => c.key === r.key)).filter(Boolean);
    }
    const out = [];
    const taken = new Set();
    for (const c of present) {
        if (taken.has(c.key)) continue;
        taken.add(c.key);
        const lines = c.anchors.filter(a => a.own || a.at <= chat.length - 1 - ANCHOR_AGE).slice(0, ANCHOR_SENT)
            .map(a => (a.text.length > LINE_CHARS ? `${a.text.slice(0, LINE_CHARS - 1)}…` : a.text));
        if (lines.length) out.push({ name: c.name, lines });
        if (out.length >= SENT_CHARACTERS) break;
    }
    return out;
}

/** The lines of the block as the model reads them ("- Mara: "…" | "…""), or "" with none to send. */
export function voiceAnchorLines() {
    if (!voiceSettings().anchors) return "";
    let list = [];
    try { list = anchorsInScene(); } catch (e) { console.warn("[VCRP] Voices: the anchors could not be read:", e); return ""; }
    return list.map(c => `- ${c.name}: ${c.lines.map(l => `"${l.replace(/"/g, "'")}"`).join(" | ")}`).join("\n");
}

// ── The drift meter ──────────────────────────────────────────────────────────
//
// Each line gives a few numbers (lineMeasures). A character's earliest lines and their latest
// are two samples of those numbers, and for each measure the question is the statistician's:
// is the difference between the two larger than lines of this character differ among
// themselves? (Welch's t: the difference of the means over its standard error.) A measure
// counts only past t = 2, where chance alone stops explaining it, so a character whose lines
// have always varied a great deal needs a great deal of change to register. Calibrated on real
// chats (tools/voice_calibrate.mjs prints numbers only): the same lines split at random reach
// the mark about once in a hundred readings.

const CONTRACTED = /^(?:[a-z]+n't|[a-z]+'(?:re|ll|ve|m|d)|(?:it|that|he|she|there|what|who|here|where|how|let)'s|gonna|wanna|gotta|ain't|y'all|dunno|lemme|gimme|kinda|sorta|'em|'cause|cuz|c'mon)$/;
const UNCONTRACTED = /\b(?:(?:do|does|did|is|are|was|were|will|would|could|should|have|has|had|must) not|can ?not|i am|(?:you|we|they) are|(?:it|that|he|she|there) is|(?:i|you|we|they|he|she|it) will)\b/g;
const SOFT = new Set(("sorry apologize apologise apologies okay alright please thank thanks understand understood gentle gently safe promise care "
    + "trust feel feelings comfortable comfort worry worried forgive patience patient kind kindly glad grateful proud deserve "
    + "together support listen listening slowly easy fine sweetheart").split(" "));
const HARSH = new Set(("fuck fucking fucked shit damn damned hell bastard bitch ass asshole crap idiot idiots fool fools stupid pathetic brat moron "
    + "useless worthless shut piss pissed bloody screw scum filth filthy trash garbage coward weak weakling dumb dumbass hate "
    + "disgusting insolent kneel obey silence quiet").split(" "));
const EDGE_SKIP = new Set(("the a an and or but i you he she it we they this that is are was were to of in on at for with my your his her do "
    + "not no yes me him them us what who how why when where there here if so then now be have has had will would can could").split(" "));

/** One spoken line in numbers: { words, question, exclaim, hesitant, contracted, uncontracted, soft, harsh, edges: [word] }. */
export function lineMeasures(text) {
    const s = String(text || "");
    const w = wordsOf(s);
    const end = s.replace(/["”’'»*_\s)]+$/, "");
    let contracted = 0, soft = 0, harsh = 0;
    for (const x of w) {
        if (CONTRACTED.test(x)) contracted++;
        if (SOFT.has(x)) soft++;
        if (HARSH.has(x)) harsh++;
    }
    return {
        words: w.length,
        question: /\?[!?]*$/.test(end) ? 1 : 0,
        exclaim: /![!?]*$/.test(end) && !/\?[!?]*$/.test(end) ? 1 : 0,
        hesitant: /…|\.{3}|—|–|\b(\p{L})-\1/u.test(s) ? 1 : 0,
        contracted,
        uncontracted: (s.toLowerCase().replace(/’/g, "'").match(UNCONTRACTED) || []).length,
        soft, harsh,
        // The words a line opens and closes on: where a speaker's habits sit ("Tch.", "…, darling.").
        edges: [...new Set([w[0], w[w.length - 1]])].filter(x => x && x.length >= 2 && !EDGE_SKIP.has(x)),
    };
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const variance = (a, m = mean(a)) => (a.length > 1 ? a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1) : 0);

/**
 * What a set of spoken lines measures, each measure with its values line by line (for the
 * comparison) and its figure for the whole set (for saying it): how long the lines run, how
 * they end, how formal, soft or harsh the words are, the words the speaker opens and closes on.
 */
export function voiceProfile(lines) {
    const ms = (lines || []).map(l => lineMeasures(typeof l === "string" ? l : (l && l.text) || "")).filter(m => m.words > 0);
    const words = ms.reduce((n, m) => n + m.words, 0);
    const sum = k => ms.reduce((n, m) => n + m[k], 0);
    const marked = ms.filter(m => m.contracted + m.uncontracted > 0);
    const edges = new Map();
    for (const m of ms) for (const x of m.edges) edges.set(x, (edges.get(x) || 0) + 1);
    return {
        lines: ms.length, words,
        perLine: ms.length ? words / ms.length : 0,
        questions: ms.length ? sum("question") / ms.length : 0,
        exclaims: ms.length ? sum("exclaim") / ms.length : 0,
        hesitant: ms.length ? sum("hesitant") / ms.length : 0,
        soft: words ? sum("soft") / words * 100 : 0,
        harsh: words ? sum("harsh") / words * 100 : 0,
        formal: marked.length >= FORMAL_MIN_LINES ? sum("uncontracted") / (sum("contracted") + sum("uncontracted")) : null,
        edges,
        // Line by line, for the comparison.
        values: {
            length: ms.map(m => Math.log(m.words)),
            questions: ms.map(m => m.question),
            exclaims: ms.map(m => m.exclaim),
            hesitant: ms.map(m => m.hesitant),
            soft: ms.map(m => (m.soft - m.harsh) / m.words * 100),
            formal: marked.map(m => m.uncontracted / (m.contracted + m.uncontracted)),
        },
    };
}

const FORMAL_MIN_LINES = 8;   // lines with something to contract, before formality is read at all
const T_CHANCE = 2;           // below this a difference is what chance does
const T_FULL = 3.5;           // from here a measure counts in full
const HABIT_P = 0.05;         // a lost habit counts when chance would lose it this seldom

/**
 * Welch's t for two samples: how many standard errors the second's mean lies from the first's.
 * 0 when either is too small. Two samples that never vary and still differ (no line trailed
 * off before, every line does now) are as far apart as samples get: ±99.
 */
export function welchT(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    const ma = mean(a), mb = mean(b);
    const se = Math.sqrt(variance(a, ma) / a.length + variance(b, mb) / b.length);
    if (se > 0) return (mb - ma) / se;
    return mb === ma ? 0 : (mb > ma ? 99 : -99);
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const pct = x => `${Math.round(x * 100)}%`;
const per100 = x => (Math.round(x * 10) / 10).toFixed(1);

/**
 * How far `now` has moved from `base` (two voiceProfile readings): { score: 0-100, parts:
 * [{ key, amount: 0-1, t, text }] }, the parts that moved most first. A part's amount is 0 up
 * to what chance does (t = 2) and 1 from t = 3.5. `names`: the cast, never taken for a habit.
 */
export function voiceDrift(base, now, names = []) {
    const parts = [];
    const measure = (key, text) => {
        const t = welchT(base.values[key], now.values[key]);
        const amount = clamp01((Math.abs(t) - T_CHANCE) / (T_FULL - T_CHANCE));
        if (amount > 0) parts.push({ key, amount, t, text: text(t > 0) });
    };
    measure("length", up => `lines run ${up ? "longer" : "shorter"} (about ${Math.round(base.perLine)} words to ${Math.round(now.perLine)})`);
    if (base.formal !== null && now.formal !== null) {
        measure("formal", up => `${up ? "fewer" : "more"} contractions (spelled out ${pct(base.formal)} of the time, now ${pct(now.formal)})`);
    }
    measure("soft", up => `${up ? "softer" : "harder"} words (reassuring ${per100(base.soft)} to ${per100(now.soft)}, harsh ${per100(base.harsh)} to ${per100(now.harsh)} in 100)`);
    measure("questions", up => `${up ? "more" : "fewer"} questions (${pct(base.questions)} of lines to ${pct(now.questions)})`);
    measure("exclaims", up => `${up ? "more" : "fewer"} exclamations (${pct(base.exclaims)} of lines to ${pct(now.exclaims)})`);
    measure("hesitant", up => `${up ? "more" : "less"} trailing off and breaking off (${pct(base.hesitant)} of lines to ${pct(now.hesitant)})`);
    // The words they opened and closed their lines on, and no longer do. A word used n times
    // early and never lately is lost by chance (base / all lines) to the power n of the time.
    const skip = new Set(names.flatMap(wordsOf));
    const share = base.lines / Math.max(1, base.lines + now.lines);
    const lost = [...base.edges].filter(([w, n]) => !skip.has(w) && !(now.edges.get(w) > 0) && share ** n < HABIT_P).sort((a, b) => b[1] - a[1]);
    if (lost.length) {
        const p = share ** lost[0][1];
        parts.push({ key: "habits", amount: clamp01((-Math.log10(p) - 1.3) / 1.2), t: 0, text: `no longer opens or closes a line on ${lost.slice(0, 3).map(([w]) => `"${w}"`).join(", ")}` });
    }
    parts.sort((a, b) => b.amount - a.amount);
    const top = parts.slice(0, 3).map(x => x.amount);
    const score = top.length ? Math.round(100 * (0.6 * top[0] + 0.4 * (top.reduce((a, b) => a + b, 0) / 3))) : 0;
    return { score, parts };
}

/** The earliest and the latest of a character's lines, never overlapping; null with too few. */
export function meterSamples(lines) {
    const n = (lines || []).length;
    if (n < METER_MIN_LINES) return null;
    const recent = Math.min(RECENT_LINES, Math.floor(n / 2));
    const base = Math.min(BASE_LINES, n - recent);
    return { base: lines.slice(0, base), recent: lines.slice(n - recent) };
}

export const driftLevel = score => (score >= DRIFT_MARK ? "drifting" : score >= DRIFT_SHIFTING ? "shifting" : "steady");

/**
 * The meter's reading of every character with enough lines: [{ key, name, score, level, says:
 * [text], lines }], the furthest moved first. `says`: what moved, in words, the most first.
 */
export function driftReadings() {
    let chat, speakers;
    try { ({ chat, speakers } = readChat()); } catch (e) { return []; }
    const names = [...speakers.values()].map(s => s.name);
    const out = [];
    for (const [key, sp] of speakers) {
        const s = meterSamples(linesSince(chat, sp, saved(key)));
        if (!s) continue;
        const d = voiceDrift(voiceProfile(s.base), voiceProfile(s.recent), names);
        out.push({ key, name: sp.name, score: d.score, level: driftLevel(d.score), says: d.parts.filter(x => x.amount >= 0.25).slice(0, 3).map(x => x.text), lines: sp.lines.length });
    }
    return out.sort((a, b) => b.score - a.score);
}

/** The characters the meter reads as drifting now (at the mark or past it). */
export function driftingNow() {
    return voiceSettings().meter ? driftReadings().filter(r => r.score >= DRIFT_MARK) : [];
}

/** True when the meter has anyone to read: enough tagged lines for at least one character. */
export const meterHasReadings = () => driftReadings().length > 0;

/**
 * For a Focus audit: how each recurring character first spoke, and what the meter counted, as
 * the auditor reads it. "" when there are no lines on file.
 */
export function voiceForAudit() {
    let chars = [];
    try { chars = voiceCharacters().filter(c => c.anchors.length); } catch (e) { return ""; }
    if (!chars.length) return "";
    const readings = new Map(driftReadings().map(r => [r.key, r]));
    const lines = chars.slice(0, 6).map(c => {
        const r = readings.get(c.key);
        const counted = r && r.says.length ? `\n  Counted since (a pointer, not a finding): ${r.says.join("; ")}.` : "";
        return `- ${c.name}: ${c.anchors.slice(0, 3).map(a => `"${a.text.replace(/"/g, "'").slice(0, LINE_CHARS)}"`).join(" | ")}${counted}`;
    });
    return `<early_voices>\nHow these characters spoke when the story began, in their own lines. For character drift, read the replies against these as well as the card: a voice may change because the story changed the character, never by wearing down.\n${lines.join("\n")}\n</early_voices>`;
}
