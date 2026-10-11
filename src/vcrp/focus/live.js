// ─────────────────────────────────────────────────────────────────────────────
// VCRP Focus, every reply: what the last few replies did, read by VCRP itself.
//
// The drift audits read the story every few replies with a call of their own. These checks
// read it on every reply, in the extension: no call, nothing to approve, and nothing sent
// when they find nothing. What they find goes in the per-turn rules ([[focus]], after the
// chat history, so the cache never sees it), worded by index.js.
//   - Swipes: a swipe is shown how the versions it replaces opened and ended. Opus writes
//     near-identical swipes otherwise.
//   - Repeats: phrases reused across the recent replies, the same opening word or the same
//     hand-off ending three replies running, the "not X, but Y" sentence shape.
//   - Writing for {{user}}: the last reply spoke, acted or thought for {{user}}, quoted back.
//     Pattern matching, so it can miss one or take a line for one. Off on the engines meant
//     to write {{user}} (Co-writer, Pura set to write for {{user}}).
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../st.js";
import { isCoWriterEngine, isPuraEngine, puraVariant } from "../../core/engines.js";
import { activeEngine } from "../../engine/meguminOriginal.js";
import { meguminCleanChatHistoryText } from "../../engine/chatText.js";
import { vcrpWithoutSwipedReply } from "../generation.js";
import { castRoster } from "../castLock.js";
import { puraSettings } from "../pura/index.js";

const WINDOW = 6;          // recent replies read
const MIN_REPLIES = 3;     // fewer than this is not a pattern
const REUSED_IN = 3;       // a phrase in this many of them is being reused
const RUN = 3;             // the same opening or ending this many replies running
const SHAPES_MIN = 3;      // "not X, but Y" this many times across them
const MAX_PHRASES = 6;
const PHRASE_WORDS = 4;    // a reused phrase is found by its pieces of this many words
const PHRASE_SHOWN = 14;   // words of a phrase shown
const SWIPES_SHOWN = 3;    // earlier versions of a swiped reply shown
const MAX_USER_LINES = 2;

const STOP = new Set(("a an the and or but nor so yet if then than as of to in on at by for with from into onto upon over under "
    + "about after before through between against without within off up down out away back again is was were be been being are "
    + "am do does did has have had it its this that these those there here he she they him her them his hers their theirs i me my "
    + "mine you your yours we us our ours not no just only very too all any each both some more most such what which who whom "
    + "whose when where why how can could would should will shall may might must one").split(" "));

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
// Phrases are taken inside a clause: never across a sentence, a comma or a line of dialogue.
const CLAUSE = /[.!?…;:,—–()[\]"“”«»\n*_]+/;
const norm = w => w.toLowerCase().replace(/’/g, "'");
// At most `words` words of `s`, on one line.
const clip = (s, words = 14) => {
    const w = String(s).replace(/\s+/g, " ").trim().split(" ");
    return w.length > words ? `${w.slice(0, words).join(" ")}…` : w.join(" ");
};

/** A reply's story: no thinking, blocks, trackers, out-of-character notes or markup. */
export function storyText(mes) {
    const s = String(mes || "")
        .replace(/<(Pura_\w+)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/\(\(\s*OOC\b[\s\S]*?\)\)/gi, "");
    return meguminCleanChatHistoryText(s).trim();
}

const ctx = () => { try { return getContext() || {}; } catch (e) { return {}; } };

/** The replies the next one follows, oldest first: { index, story } (the greeting left out). */
function recentReplies(chat) {
    const out = [];
    for (let i = chat.length - 1; i >= 1 && out.length < WINDOW; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
        const story = storyText(m.mes);
        if (story) out.push({ index: i, story });
    }
    return out.reverse();
}

/** The reader's message a reply at `index` answers ("" when none). */
function answered(chat, index) {
    for (let i = index - 1; i >= 0; i--) if (chat[i] && chat[i].is_user && !chat[i].is_system) return String(chat[i].mes || "");
    return "";
}

// ── Repeats ──────────────────────────────────────────────────────────────────

/** `text` as the words of its clauses. */
function clausesOf(text) {
    return String(text || "").split(CLAUSE).map(c => (c.match(WORD) || []).map(norm)).filter(w => w.length);
}

/** The PHRASE_WORDS-word phrases in a run of words. */
function phrasesIn(words) {
    const out = [];
    for (let i = 0; i + PHRASE_WORDS <= words.length; i++) out.push(words.slice(i, i + PHRASE_WORDS).join(" "));
    return out;
}

/** Names in the story (the cast), as lowercase words. */
function nameWords() {
    const out = new Set();
    for (const n of castRoster()) for (const w of String(n).match(WORD) || []) out.add(norm(w));
    return out;
}

/** The card's own text (or the group's): its phrases are the character's, not the writer's habits. */
function cardText() {
    const c = ctx();
    const chars = c.groupId
        ? (((c.groups || []).find(g => g.id === c.groupId) || {}).members || []).map(av => (c.characters || []).find(ch => ch.avatar === av))
        : [(c.characters || [])[c.characterId]];
    return chars.filter(Boolean).map(ch => [ch.description, ch.personality, ch.scenario, ch.first_mes, ch.mes_example].filter(Boolean).join("\n")).join("\n");
}

/**
 * Phrases in at least REUSED_IN of the replies, whole, most reused first. Phrases the reader
 * used, the card's own and ones that are only names and small words are left out.
 */
export function reusedPhrases(stories, { exclude = [], names = new Set() } = {}) {
    const replies = stories.map(clausesOf);
    const seen = new Map();
    for (const clauses of replies) for (const p of new Set(clauses.flatMap(phrasesIn))) seen.set(p, (seen.get(p) || 0) + 1);
    // Generous: the card or the reader may punctuate the same words differently.
    const excluded = new Set(exclude.flatMap(t => phrasesIn((String(t || "").match(WORD) || []).map(norm))));
    const content = p => p.split(" ").filter(w => w.length >= 3 && !STOP.has(w) && !names.has(w.replace(/'s$/, ""))).length;
    const reused = p => seen.get(p) >= REUSED_IN && !excluded.has(p) && content(p) >= 2;
    // Each reply's stretches of reused words: a phrase longer than PHRASE_WORDS comes out whole
    // ("a smile tugging at the corner of her lips"), not as its overlapping pieces.
    const stretches = new Map();   // stretch -> the replies it is in
    replies.forEach((clauses, r) => {
        for (const w of clauses) {
            const covered = new Array(w.length).fill(false);
            for (let i = 0; i + PHRASE_WORDS <= w.length; i++) if (reused(w.slice(i, i + PHRASE_WORDS).join(" "))) covered.fill(true, i, i + PHRASE_WORDS);
            for (let i = 0; i < w.length; i++) {
                if (!covered[i]) continue;
                let j = i;
                while (j < w.length && covered[j]) j++;
                const stretch = w.slice(i, j).join(" ");
                if (!stretches.has(stretch)) stretches.set(stretch, new Set());
                stretches.get(stretch).add(r);
                i = j;
            }
        }
    });
    const all = [...stretches.keys()];
    const inside = (p, q) => ` ${q} `.includes(` ${p} `);
    const replyCount = p => new Set(all.filter(q => inside(p, q)).flatMap(q => [...stretches.get(q)])).size;
    // "the air thick with unspoken tension" makes "the air thick with" say nothing new.
    return all.filter(p => !all.some(q => q.length > p.length && inside(p, q)))
        .map(p => ({ text: p, replies: replyCount(p) }))
        .sort((a, b) => (b.replies - a.replies) || (b.text.length - a.text.length))
        .slice(0, MAX_PHRASES)
        .map(x => ({ ...x, text: clip(x.text, PHRASE_SHOWN) }));
}

/** How a reply opens: a line of dialogue, or its first word. */
function openingOf(story) {
    const t = String(story).replace(/^[\s*_~>#-]+/, "");
    if (/^["“«„「]/.test(t)) return { key: "\"", label: "a line of dialogue" };
    const w = (t.match(WORD) || [])[0];
    return w ? { key: norm(w), label: `"${w}…"` } : null;
}

const HANDOFF = /\b(?:waits?|waited|waiting|expectant(?:ly)?|for (?:your|an?|his|her|their) (?:answer|response|reply|move|decision)|your (?:move|turn|call)|ball (?:is|was) in)\b/i;

/** True when a reply ends by handing the turn over: on a question, or on someone waiting. */
function endsOnHandoff(story) {
    const t = String(story).replace(/[\s*_~"”’'»)\]]+$/, "");
    if (/\?$/.test(t)) return true;
    const body = t.replace(/[.!?…]+$/, "");
    const from = Math.max(...[".", "!", "?", "…"].map(p => body.lastIndexOf(p))) + 1;
    return HANDOFF.test(body.slice(from));
}

/** How many of the latest replies, running back from the newest, give the same `key` as it. */
function runOf(stories, key) {
    const keys = stories.map(key);
    const last = keys[keys.length - 1];
    if (last === null || last === undefined || last === false) return 0;
    let n = 0;
    for (let i = keys.length - 1; i >= 0 && keys[i] === last; i--) n++;
    return n;
}

// The "not X, but Y" habit: a short thing denied, then what it "really" was.
const SHAPES = [
    /\bnot\s+(?:just\s+|only\s+|merely\s+|quite\s+)?[\p{L}'’]+(?:\s+[\p{L}'’]+){0,2}\s*[,;—–]\s*but\s+(?:a|an|the|something|someone|somewhere|his|her|their|my|your)\b[^.!?\n]{0,30}/giu,
    /\b(?:was|is|were|are)n['’]t\s+(?:just\s+)?[\p{L}'’]+(?:\s+[\p{L}'’]+){0,3}[.;—–]\s+(?:It|This|That|She|He|They)\s+(?:was|is|were|are)\b[^.!?\n]{0,30}/gu,
];

function shapesIn(stories) {
    const hits = [];
    for (const s of stories) for (const re of SHAPES) for (const m of s.matchAll(re)) hits.push(m[0].trim());
    return hits;
}

// ── Writing for {{user}} ─────────────────────────────────────────────────────

const SPEECH = "says|said|asks|asked|replies|replied|answers|answered|whispers|whispered|murmurs|murmured|mutters|muttered|shouts|shouted|yells|yelled|calls|called|tells|told|adds|added|snaps|snapped|growls|growled|breathes|breathed|sighs|sighed|laughs|laughed";
const THINKS = "thinks|thought|wonders|wondered|feels|felt|realizes|realized|realises|realised|decides|decided|hopes|hoped|wishes|wished|fears|feared";
const ACTS = "nods|nodded|smiles|smiled|grins|grinned|laughs|laughed|chuckles|chuckled|smirks|smirked|shrugs|shrugged|sighs|sighed|winks|winked|blushes|blushed|frowns|frowned|gasps|gasped|groans|groaned|moans|moaned|swallows|swallowed|pauses|paused|hesitates|hesitated|steps|stepped|walks|walked|reaches|reached|grabs|grabbed|pulls|pulled|pushes|pushed|leans|leaned|leant|turns|turned|looks|looked|glances|glanced|stares|stared|watches|watched|moves|moved|kneels|knelt|kneeled|kisses|kissed|touches|touched|wraps|wrapped|pins|pinned|presses|pressed|follows|followed|opens|opened|closes|closed|raises|raised|lowers|lowered|shakes|shook|tilts|tilted|crosses|crossed|catches|caught|holds|held|hugs|hugged|slides|slid|slips|slipped|climbs|climbed|drops|dropped|lifts|lifted|places|placed|picks|picked|hands|handed|offers|offered|tries|tried|starts|started|begins|began|agrees|agreed|refuses|refused|sits|sat|stands|stood|runs|ran|takes|took|gives|gave|rises|rose";
// Second person: what "you" says, decides or does in the narration (not sensations: a story
// told to "you" describes what you feel by its nature).
const YOU_DO = "say|said|ask|asked|reply|replied|answer|answered|whisper|whispered|murmur|murmured|tell|told|shout|shouted|nod|nodded|smile|smiled|grin|grinned|laugh|laughed|shrug|shrugged|decide|decided|think|thought|wonder|wondered|realize|realized|realise|realised";

const GENERIC_USER = /^(?:you|user|player|me|anon|anonymous|\{\{user\}\})$/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = w => norm(w).replace(/'s$/, "").replace(/(?:ing|ed|es|s)$/, "");

function stems(text, skip) {
    return new Set((String(text || "").match(WORD) || []).map(norm).filter(w => w.length >= 3 && !STOP.has(w) && !skip.has(w.replace(/'s$/, ""))).map(stem));
}

/** True when most of `line` is the reader's own message told back (an echo, not a takeover). */
function echoes(line, message, skip) {
    const a = stems(line, skip);
    if (!a.size) return true;
    const b = stems(message, skip);
    let hit = 0;
    a.forEach(x => { if (b.has(x)) hit++; });
    return hit / a.size >= 0.5;
}

/** Lines of `story` that write {{user}} (`name`): their speech, thoughts or actions, echoes left out. */
export function userLines(story, name, message = "") {
    const s = String(story || "");
    const out = [];
    const skip = new Set((String(name || "").match(WORD) || []).map(norm));
    const add = (line, said) => {
        const shown = clip(line);
        if (!echoes(said || line, message, skip) && !out.includes(shown)) out.push(shown);
    };
    const names = [];
    const full = String(name || "").trim();
    if (full && !GENERIC_USER.test(full)) {
        names.push(full);
        const first = full.split(/\s+/)[0];
        if (first !== full && first.length >= 3) names.push(first);
    }
    // Narration only, for thoughts and actions: dialogue is the characters talking. For "you",
    // not italics either: in prose those are a character's thoughts ("*You fool,* she thinks").
    const narration = s.replace(/["“][^"“”\n]*["”]/g, " \" ");
    const toYou = narration.replace(/\*[^*\n]+\*/g, " \" ");
    const B = "(^|[^\\p{L}\\p{N}_])";
    const START = "(^|[.!?…]['\"”’*_)]*\\s+|\\n\\s*|\\*)";
    // A line that ends on a question is someone asking, not {{user}} acting.
    const told = (src, m, line) => { if (src[m.index + m[0].length] !== "?") add(line); };
    for (const n of names) {
        const N = esc(n);
        // "Fine," Bob says. / "Fine," says Bob. / Bob says, "Fine."
        for (const re of [
            new RegExp(`["“]([^"“”\\n]{1,300})["”]\\s*,?\\s*${N}\\s+(?:\\p{L}+ly\\s+)?(?:${SPEECH})(?![\\p{L}])`, "gu"),
            new RegExp(`["“]([^"“”\\n]{1,300})["”]\\s*,?\\s*(?:${SPEECH})\\s+${N}(?![\\p{L}])`, "gu"),
        ]) for (const m of s.matchAll(re)) add(m[0], m[1]);
        for (const m of s.matchAll(new RegExp(`${B}${N}\\s+(?:\\p{L}+ly\\s+)?(?:${SPEECH})\\b[^"“\\n.!?]{0,40}[,:]\\s*["“]([^"“”\\n]{1,300})["”]`, "gu"))) add(m[0].slice(m[1].length), m[2]);
        // Bob wonders whether… / Bob's heart races.
        for (const m of narration.matchAll(new RegExp(`${B}(${N}\\s+(?:\\p{L}+ly\\s+)?(?:${THINKS})(?![\\p{L}])[^.!?\\n"]*)`, "gu"))) told(narration, m, m[2]);
        for (const m of narration.matchAll(new RegExp(`${B}(${N}['’]s\\s+(?:heart|pulse|stomach|mind|thoughts)\\s+[^.!?\\n"]*)`, "gu"))) told(narration, m, m[2]);
        // Bob nods and takes her hand. (At the start of a sentence: "she turns to Bob" is not Bob acting.)
        for (const m of narration.matchAll(new RegExp(`${START}(${N}\\s+(?:\\p{L}+ly\\s+)?(?:${ACTS})(?![\\p{L}])[^.!?\\n"]*)`, "gu"))) told(narration, m, m[2]);
    }
    for (const m of toYou.matchAll(new RegExp(`${START}([Yy]ou\\s+(?:\\p{L}+ly\\s+)?(?:${YOU_DO})(?![\\p{L}])[^.!?\\n"]*)`, "gu"))) told(toYou, m, m[2]);
    return out.slice(0, MAX_USER_LINES);
}

/** True on the engines meant to write {{user}}: there, writing for {{user}} is the job. */
export function writesForUser() {
    let engine = null;
    try { engine = activeEngine(); } catch (e) { engine = null; }
    if (isCoWriterEngine(engine)) return true;
    if (isPuraEngine(engine) && puraVariant(engine) === "original") {
        try { return puraSettings().userControl !== "dont"; } catch (e) { return false; }
    }
    return false;
}

// ── Swipes ───────────────────────────────────────────────────────────────────

/**
 * The earlier versions of the reply a swipe replaces, newest last. SillyTavern keeps them in
 * the message's swipes while the new one is written; none of them is the new one yet.
 */
function swipedVersions(chat) {
    const m = chat[chat.length - 1];
    if (!m || m.is_user || m.is_system || chat.length < 2) return [];
    const all = [...(Array.isArray(m.swipes) ? m.swipes : []), m.mes].map(x => (typeof x === "string" ? x : ""));
    const seen = new Set();
    return all.map(storyText).filter(t => t && t !== "..." && !seen.has(t) && seen.add(t));
}

/** How a version went: its opening words and its closing words. */
function gist(story) {
    const w = String(story).replace(/\s+/g, " ").trim().split(" ");
    const flat = s => s.replace(/["“”]/g, "'");
    if (w.length <= 32) return { opened: flat(w.join(" ")), ended: "" };
    return { opened: flat(w.slice(0, 20).join(" ")), ended: flat(w.slice(-12).join(" ")) };
}

// ── All of it ────────────────────────────────────────────────────────────────

/**
 * What the reply about to be written should hear, found in the chat: null for each check
 * that is off or finds nothing. `swipe`: this reply replaces the latest one.
 */
export function focusLiveFindings({ swipes = true, repeats = true, user = true, swipe = false } = {}) {
    const c = ctx();
    const all = Array.isArray(c.chat) ? c.chat : [];
    const chat = swipe ? vcrpWithoutSwipedReply(all) : all;
    const found = { swipe: null, phrases: null, opening: null, ending: null, shapes: null, user: null };
    const recent = recentReplies(chat);
    const stories = recent.map(r => r.story);

    if (swipes && swipe) {
        const versions = swipedVersions(all);
        if (versions.length) found.swipe = { count: versions.length, shown: versions.slice(-SWIPES_SHOWN).map(gist) };
    }

    if (repeats && stories.length >= MIN_REPLIES) {
        const readerSaid = chat.slice(-WINDOW * 2).filter(m => m && m.is_user).map(m => String(m.mes || ""));
        const phrases = reusedPhrases(stories, { exclude: [cardText(), ...readerSaid], names: nameWords() });
        if (phrases.length) found.phrases = phrases;
        const opens = runOf(stories, s => { const o = openingOf(s); return o ? o.key : null; });
        if (opens >= RUN) found.opening = { count: opens, label: openingOf(stories[stories.length - 1]).label };
        const ends = runOf(stories, s => endsOnHandoff(s));
        if (ends >= RUN) found.ending = { count: ends };
        const shapes = shapesIn(stories);
        if (shapes.length >= SHAPES_MIN) found.shapes = { count: shapes.length, example: clip(shapes[shapes.length - 1], 12) };
    }

    if (user && !writesForUser()) {
        const name = typeof c.name1 === "string" ? c.name1 : "";
        const lines = [];
        const last = recent[recent.length - 1];
        if (last) lines.push(...userLines(last.story, name, answered(chat, last.index)));
        // On a swipe, the version just turned down too: writing for you may be why.
        if (swipe) {
            const versions = swipedVersions(all);
            if (versions.length) lines.push(...userLines(versions[versions.length - 1], name, answered(all, all.length - 1)));
        }
        const unique = [...new Set(lines)].slice(0, MAX_USER_LINES);
        if (unique.length) found.user = { lines: unique };
    }
    return found;
}
