// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the thread ledger.
//
// The World State block lists the story's open ends every reply: Unresolved Threads, Planted
// Seeds ("what | what it hints at | turns since planted"), Consequence Timers ("what | the
// ripple | turns remaining"). The model keeps that list from one reply to the next and is a
// poor bookkeeper: a thread sits reworded and unmoved for fifty replies, a timer's "2 turns"
// stays 2 turns, a seed's count drifts, and an open end quietly leaves the list without ever
// having been settled. So VCRP keeps the book instead. It reads every reply's World State, in
// order, and knows for each line when it first appeared, when its wording last changed, when
// a timer falls due by its own count, and when a line left the list. Read from the chat each
// time, with no model call, so a rewind, a swipe or a deleted message is simply read again.
//
// What it is for:
//   - the Plot tab shows the open ends with their real ages, and the ones that left the list;
//   - a thread that has not moved for a long time, a timer that has run out and a seed long
//     unpaid are named to the model with a reply now and then (in [[focus]], after the chat,
//     never cached), so old threads pay off instead of piling up;
//   - any of them can be made a beat (beats.js): "bring this forward", "pick this back up".
// Without the World State block, or with one that does not list them, there is nothing to read.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata } from "../st.js";
import { localProfile } from "../core/state.js";
import { isStoryReply } from "./storyReplies.js";
import { vcrpWithoutSwipedReply } from "./generation.js";

const META = "vcrp_threads";        // chat_metadata: { ignored: [key] }

export const STALE_AFTER = 20;      // replies an open thread may go without moving before it is stale
export const SEED_STALE = 30;       // replies a seed may wait to be paid off
export const NUDGE_EVERY = 8;       // replies between reminders of the same open end
const MAX_NUDGED = 2;               // open ends named in one reminder
const LISTED_WITHIN = 8;            // a section not listed for longer than this is out of date: no reminders from it
const REOPEN_WITHIN = 6;            // a line that comes back this soon after leaving the list is the same thread
const CLOSED_SHOWN = 8;             // lines that left the list, shown in the tab

/** The switch (the profile's): reminders of stale open ends go out. On by default. */
export const threadNudgesOn = () => !(localProfile && localProfile.plot && localProfile.plot.threadNudges === false);

// ── Reading one World State ──────────────────────────────────────────────────

// A line without its dressing: no emoji (the template's own headings each open with one, and a
// model swaps them freely), no emphasis marks.
const plain = s => String(s || "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
const BULLET = /^\s*(?:[*•-]|\d+[.)])\s+/;
// The template's own lines, left as they were.
const TEMPLATE = /active tension, unanswered question|keep to 3.5 max|drop resolved ones|foreshadow or setup element|what it hints at \| turns since planted|pc action\/inaction \| expected ripple/i;
const NOTHING = /^(?:none|n\/?a|nothing|no (?:open|active|unresolved) threads?|[-–—.?]+)\.?$/i;

/** The newest World State's body in a reply's text (closed, or cut off by the end of the reply); "" with none. */
export function worldStateBody(mes) {
    const s = String(mes || "");
    const at = s.toLowerCase().lastIndexOf("<world_state");
    if (at < 0) return "";
    const from = s.indexOf(">", at);
    if (from < 0) return "";
    const end = s.slice(from + 1).search(/<\/World_State\s*>/i);
    return end < 0 ? s.slice(from + 1).replace(/<\/Blocks\s*>[\s\S]*$/i, "") : s.slice(from + 1, from + 1 + end);
}

/**
 * The open ends one World State lists: { threads, seeds, timers }, each a list of lines, or
 * null when that section is not in this World State at all (the compact form leaves them out:
 * that is not a list with nothing on it).
 */
export function worldThreads(body) {
    const out = { threads: null, seeds: null, timers: null };
    let section = "";
    const add = (kind, value) => {
        for (const piece of String(value || "").split(/\s*;\s*/)) {
            const text = plain(piece).replace(/^\[|\]$/g, "").trim();
            if (text && !NOTHING.test(text) && !TEMPLATE.test(text) && text.length <= 400) out[kind].push(text);
        }
    };
    for (const raw of String(body || "").split(/\r?\n/)) {
        const line = plain(raw.replace(BULLET, ""));
        if (!line || /^-{3,}$/.test(line)) continue;
        const bullet = BULLET.test(raw);
        const head = !bullet && line.match(/^([\p{L}][\p{L} /&'’-]{2,40}?)\s*:\s*(.*)$/u);
        if (head) {
            const label = head[1].toLowerCase();
            section = /unresolved|threads/.test(label) ? "threads" : /seeds?\b/.test(label) ? "seeds" : /timers?\b/.test(label) ? "timers" : "";
            if (section) { out[section] = out[section] || []; add(section, head[2]); }
            continue;
        }
        if (section && bullet) add(section, line);
        else if (!bullet) section = "";
    }
    return out;
}

// ── One line and another: the same open end? ─────────────────────────────────

const STOP = new Set(("a an the and or but nor so yet if then than as of to in on at by for with from into onto upon over under about after before "
    + "through between against without within off up down out away back again is was were be been being are am do does did has have had it its "
    + "this that these those there here he she they him her them his hers their theirs i me my mine you your yours we us our ours not no just "
    + "only very too all any each both some more most such what which who whom whose when where why how can could would should will shall may "
    + "might must one still yet now turn turns reply replies since planted remaining left").split(" "));
const stem = w => (w.length > 5 ? w.replace(/(?:ing|ed|es|s)$/, "") : w.replace(/s$/, ""));
/** The content words of a line: lowercase, three letters or more, no small words, lightly stemmed. Numbers are left out: a count ticking up is not the line changing. */
export const lineWords = text => new Set((String(text || "").toLowerCase().replace(/’/g, "'").match(/[\p{L}][\p{L}'-]*/gu) || []).map(w => w.replace(/'s$/, "")).filter(w => w.length >= 3 && !STOP.has(w)).map(stem));
// What a seed or a timer is about: its first cell. The rest is commentary the model rewords.
const subject = (kind, text) => (kind === "threads" ? text : String(text).split("|")[0]);

/** How alike two lines are: the share of the shorter one's words the other holds (0 to 1). */
export function alike(a, b) {
    const A = a instanceof Set ? a : lineWords(a), B = b instanceof Set ? b : lineWords(b);
    if (!A.size || !B.size) return 0;
    let both = 0;
    for (const w of A) if (B.has(w)) both++;
    return both / Math.min(A.size, B.size);
}
const sameSet = (A, B) => A.size === B.size && [...A].every(w => B.has(w));
const sharedWords = (A, B) => { let n = 0; for (const w of A) if (B.has(w)) n++; return n; };

// The same open end, by its words. A model seldom copies its list forward: it rewrites each
// line as the scene moves, so the same thread comes back in other words. Two rules, the sure
// one first (measured on real replies, where half of a list's lines fail the first and a good
// part of those are plainly the line before, reworded):
//   - SAME: at least 0.6 alike, and more than one word behind it unless the words are equal;
//   - REWORDED: at least two words in common and 0.4 alike, for what the first rule left over.
const SAME = 0.6;
const REWORDED = 0.4;
const REWORDED_WORDS = 2;

// A timer's own count, at first sight: "… | 3 turns", "in 2 replies", "(1 turn left)".
function turnsIn(text) {
    const last = String(text).split("|").pop();
    const m = last.match(/(\d{1,3})\s*(?:turns?|replies|reply|rounds?|scenes?)?\b/i);
    return m ? Number(m[1]) : null;
}

// ── The ledger, read from the chat ───────────────────────────────────────────

const KINDS = ["threads", "seeds", "timers"];

/**
 * Every open end the chat's World States have listed, in the order they first appeared (pure):
 * { replies, listed: { threads, seeds, timers }, items: [{ key, kind, text, first, last, moved,
 * closed, due }] }. Numbers are reply numbers (the first reply is 1): `first` listed, `last`
 * listed, wording last `moved`, `closed` when it left the list (null while open), `due` for a
 * timer with a count. `listed[kind]`: the last reply whose World State had that section.
 */
export function readThreads(chat) {
    const items = [];
    const listed = { threads: 0, seeds: 0, timers: 0 };
    let n = 0;
    // Replies the reader has hidden since are read too (storyReplies.js): they are the story's
    // past, and a thread's age counts from where it really first appeared.
    for (const m of Array.isArray(chat) ? chat : []) {
        if (!isStoryReply(m)) continue;
        n++;
        if (!/<world_state/i.test(m.mes)) continue;
        const ws = worldThreads(worldStateBody(m.mes));
        for (const kind of KINDS) {
            if (!ws[kind]) continue;
            listed[kind] = n;
            const open = items.filter(i => i.kind === kind && i.closed === null);
            const taken = new Set();
            // This reply's line is open item `item`, carried on: seen now, and moved when its words changed.
            const carry = (item, text, words) => {
                taken.add(item);
                item.last = n;
                const all = lineWords(text);
                if (!sameSet(all, item.allWords)) { item.moved = n; item.text = text; item.allWords = all; item.words = words; }
            };
            const lines = ws[kind].map(text => ({ text, words: lineWords(subject(kind, text)) })).filter(l => l.words.size);
            // First the sure ones, each line taking the open line it is most alike.
            const rest = [];
            for (const l of lines) {
                let best = null, score = 0;
                for (const i of open) {
                    if (taken.has(i)) continue;
                    const s = alike(l.words, i.words);
                    if (s > score) { best = i; score = s; }
                }
                if (best && score >= SAME && (score === 1 || Math.min(l.words.size, best.words.size) >= 2)) carry(best, l.text, l.words);
                else rest.push(l);
            }
            // Then the reworded ones, among what is left on both sides: the likeliest pair first.
            const pairs = [];
            for (const l of rest) for (const i of open) {
                if (taken.has(i)) continue;
                const s = alike(l.words, i.words), both = sharedWords(l.words, i.words);
                if (both >= REWORDED_WORDS && s >= REWORDED) pairs.push({ l, i, s, both });
            }
            pairs.sort((a, b) => b.s - a.s || b.both - a.both);
            const placed = new Set();
            for (const p of pairs) {
                if (placed.has(p.l) || taken.has(p.i)) continue;
                placed.add(p.l);
                carry(p.i, p.l.text, p.l.words);
            }
            for (const l of rest) {
                if (placed.has(l)) continue;
                // One that left the list a moment ago and is back: the same open end, never closed.
                const back = items.find(i => i.kind === kind && i.closed !== null && !taken.has(i) && n - i.closed <= REOPEN_WITHIN && alike(l.words, i.words) >= 0.75);
                if (back) { back.closed = null; back.last = n; taken.add(back); continue; }
                const turns = kind === "timers" ? turnsIn(l.text) : null;
                const item = { key: `${kind}:${[...l.words].sort().join(" ")}`, kind, text: l.text, first: n, last: n, moved: n, closed: null, due: turns !== null ? n + turns : null, words: l.words, allWords: lineWords(l.text) };
                items.push(item);
                taken.add(item);
            }
            for (const i of open) if (!taken.has(i)) i.closed = n;
        }
    }
    // (the word sets were for the matching; the ledger is what was counted)
    return { replies: n, listed, items: items.map(i => ({ key: i.key, kind: i.kind, text: i.text, first: i.first, last: i.last, moved: i.moved, closed: i.closed, due: i.due })) };
}

// One reading of the chat serves the prompt and the tab; read again when the chat has changed.
let cache = { chat: null, length: -1, last: "", value: null };
const chatNow = () => { try { return ((getContext() || {}).chat) || []; } catch (e) { return []; } };
// `basis`: another list than the chat as it stands (the chat without a reply being swiped). Read
// each time, and never kept in place of the chat's own reading.
function ledgerNow(basis) {
    if (Array.isArray(basis)) return readThreads(basis);
    const chat = chatNow();
    const last = chat.length ? String((chat[chat.length - 1] || {}).mes || "") : "";
    if (cache.chat === chat && cache.length === chat.length && cache.last === last && cache.value) return cache.value;
    const value = readThreads(chat);
    cache = { chat, length: chat.length, last, value };
    return value;
}
/** For tests, and when another chat is opened. */
export function forgetThreadReading() { cache = { chat: null, length: -1, last: "", value: null }; }

// ── The reader's part ────────────────────────────────────────────────────────

const ignoredKeys = () => { const m = chat_metadata && chat_metadata[META]; return m && Array.isArray(m.ignored) ? m.ignored : []; };

/** Never (or again) reminds the model of one open end. */
export async function setThreadIgnored(key, ignored) {
    if (!chat_metadata) return;
    const cur = ignoredKeys().filter(k => k !== key);
    chat_metadata[META] = { ...(chat_metadata[META] || {}), ignored: ignored ? [...cur, key] : cur };
    try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Threads: could not save the chat's data", e); }
}

// ── Ages, and what is overdue ────────────────────────────────────────────────

/**
 * The ledger as the tab shows it: { replies, current: { threads, seeds, timers } (is that
 * section's list up to date?), open: [...], closed: [...] }. An open item carries `age`
 * (replies since it first appeared), `still` (replies since its wording last changed),
 * `overdue` (a timer past its count, by how many replies; a negative number is replies to go),
 * `stale` (it has waited long enough to be named) and `ignored`.
 */
export function threadLedger(basis) {
    const { replies, listed, items } = ledgerNow(basis);
    const ignored = new Set(ignoredKeys());
    const current = Object.fromEntries(KINDS.map(k => [k, listed[k] > 0 && replies - listed[k] <= LISTED_WITHIN]));
    const open = items.filter(i => i.closed === null).map(i => {
        const age = replies - i.first, still = replies - i.moved;
        const overdue = i.kind === "timers" && i.due !== null ? replies - i.due : null;
        const stale = current[i.kind] && (i.kind === "threads" ? still >= STALE_AFTER : i.kind === "seeds" ? age >= SEED_STALE : overdue !== null && overdue >= 0);
        return { ...i, age, still, overdue, stale, ignored: ignored.has(i.key) };
    });
    const closed = items.filter(i => i.closed !== null).sort((a, b) => b.closed - a.closed).slice(0, CLOSED_SHOWN).map(i => ({ ...i, age: i.closed - i.first, ago: replies - i.closed }));
    return { replies, current, listed, open, closed };
}

// How long a stale item has been waiting past its mark: what the reminders are spaced by.
const waited = i => (i.kind === "threads" ? i.still - STALE_AFTER : i.kind === "seeds" ? i.age - SEED_STALE : i.overdue);

/**
 * The open ends to name with the reply about to be written: the stale ones whose turn it is
 * (when they first go stale, then every NUDGE_EVERY replies), the longest waiting first, two
 * at most. Decided by the reply's number alone, so a swipe of the same reply names the same
 * (`basis`: the chat that reply follows, when it is not the chat as it stands).
 */
export function threadsDue(basis) {
    const l = threadLedger(basis);
    return l.open.filter(i => i.stale && !i.ignored && waited(i) % NUDGE_EVERY === 0)
        .sort((a, b) => waited(b) - waited(a)).slice(0, MAX_NUDGED);
}

const count = (n, word) => `${n} ${n === 1 ? word : (word === "reply" ? "replies" : `${word}s`)}`;

/** One open end as the reminder names it. */
export function dueLine(i) {
    const cells = String(i.text).split("|").map(s => s.trim()).filter(Boolean);
    if (i.kind === "threads") return `- An open thread that has not moved in ${count(i.still, "reply")}: "${i.text}"`;
    if (i.kind === "timers") return `- A consequence that was due${i.overdue > 0 ? ` ${count(i.overdue, "reply")} ago` : " now"}: "${cells[0]}"${cells[1] ? ` (what it brings: ${cells[1]})` : ""}`;
    return `- Set up ${count(i.age, "reply")} ago and never paid off: "${cells[0]}"${cells[1] ? ` (it pointed at: ${cells[1]})` : ""}`;
}

/**
 * [[focus]]'s part: the reminder for this reply, or "" (nothing due, the switch off, not a
 * fresh reply). A Continue carries on what is written, and an Impersonate is the reader's turn.
 */
export function threadsNudge(gen = "reply") {
    if (gen !== "reply" || !threadNudgesOn()) return "";
    let due = [];
    try {
        // On a swipe SillyTavern leaves the reply being replaced in the chat: counted, it would be
        // one reply too many, and the swipe would be reminded of something else than the reply was.
        const chat = chatNow(), follows = vcrpWithoutSwipedReply(chat);
        due = threadsDue(follows === chat ? undefined : follows);
    } catch (e) { console.warn("[VCRP] Threads: the ledger could not be read:", e); return ""; }
    if (!due.length) return "";
    return `[OPEN ENDS]\nThe story has left ${due.length === 1 ? "this" : "these"} hanging for a long time. If this scene gives an opening, bring ${due.length === 1 ? "it" : "one of them"} forward in a way that follows from what has happened, or let it be settled for good; do not open something new in its place. If the scene gives no opening, leave it. Never mention this note.\n${due.map(dueLine).join("\n")}`;
}
