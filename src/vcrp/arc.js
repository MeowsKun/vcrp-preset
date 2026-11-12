// ─────────────────────────────────────────────────────────────────────────────
// VCRP: arcs. A long story is not one story: the heist ends, and what follows is a slow
// romance, or a haunting. An arc is the reader saying so: a name, a genre, a tone and a
// premise for the stretch that starts now, while everyone in it stays who they are.
//
//   - Starting one is free: the arc rides with every reply as the last thing the model reads
//     ([[plotfocus]], after the newest message, outside the cache), a few dozen tokens.
//   - The premise can be the reader's own, or one of three pitches: a background call that
//     reads the story as the Story Director would (the story memory and the latest messages),
//     the Canon sheet and the open threads, and proposes three arcs that grow out of what is
//     already there. A one-off the reader presses a button for, priced beside the button.
//   - A pitch comes with its opening move, which goes into the beat queue (beats.js) and
//     fires with the next reply.
//   - Story Memory can close the old arc: its chapters fold into one entry under its name
//     (memory/summarize.js, closeStoryArc), so the memory text reads arc by arc.
// The arc is the chat's. The plot focus (focus/index.js) stays what it was: a single thing to
// revolve around, inside whatever arc is running. The Story Director is told the arc.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, substituteParams } from "../st.js";
import { localProfile } from "../core/state.js";
import { vcrpChatForStoryDirector, backgroundEstimate } from "./backgroundCosts.js";
import { estimateTokens } from "./memory/index.js";
import { canonItems } from "./canon.js";
import { threadLedger } from "./threads.js";
import { castRoster } from "./castLock.js";
import { askModel } from "./helper/aside.js";
import { addBeat, fireBeat, replyCount } from "./beats.js";

const META = "vcrp_arc";   // chat_metadata: { current, past: [], seq, pitches: [], asked: { genre, tone, wish } }
const PAST_KEPT = 20;
const PITCH_FIXED = 700;   // the pitch call's own instructions, roughly

const tidy = (s, max = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const para = (s, max = 1200) => String(s || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const save = async () => { try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Arcs: could not save the chat's data", e); } };

function state(create = false) {
    if (!chat_metadata) return null;
    let st = chat_metadata[META];
    // Anything but an object there is not a state (and a property cannot be set on it).
    if (!st || typeof st !== "object") {
        if (!create) return null;
        st = chat_metadata[META] = { current: null, past: [], seq: 0, pitches: [] };
    }
    if (!Array.isArray(st.past)) st.past = [];
    if (!Array.isArray(st.pitches)) st.pitches = [];
    return st;
}

/** This chat's arcs: { current, past (newest first), pitches, asked }. `current.replies`: how long it has run. */
export function arcs() {
    const st = state();
    const cur = st && st.current && st.current.premise ? { ...st.current, replies: Math.max(0, replyCount() - (Number(st.current.startedReply) || 0)) } : null;
    return { current: cur, past: st ? [...st.past].reverse() : [], pitches: st ? st.pitches.map(p => ({ ...p })) : [], asked: (st && st.asked) || null };
}

/** A name for an arc that was given none: the first words of its premise. */
export const arcTitleFrom = premise => { const w = tidy(premise, 400).replace(/[.!?:;,]+(\s|$).*$/, "").split(" ").slice(0, 6).join(" "); return w || "A new arc"; };

/**
 * Starts an arc now; the one running, if any, ends here. `opens`: its opening move, queued as
 * a beat and fired with the next reply (the reader can still take it out of the box).
 * Returns { arc, ended, beat } or null without a premise.
 */
export async function startArc({ title = "", genre = "", tone = "", premise = "", opens = "" } = {}) {
    const text = para(premise);
    const st = state(true);
    if (!text || !st) return null;
    const now = replyCount();
    const ended = st.current && st.current.premise ? { ...st.current, endedReply: now } : null;
    if (ended) st.past = [...st.past, ended].slice(-PAST_KEPT);
    st.seq = (Number(st.seq) || 0) + 1;
    st.current = { id: `A${st.seq}`, title: tidy(title, 80) || arcTitleFrom(text), genre: tidy(genre, 80), tone: tidy(tone, 160), premise: text, startedReply: now, startedAt: Date.now() };
    st.pitches = [];
    st.asked = null;
    await save();
    let beat = null;
    const first = tidy(opens, 600);
    if (first) {
        beat = await addBeat(first, { first: true });
        if (beat) beat.fired = await fireBeat(beat.id);
    }
    return { arc: { ...st.current }, ended, beat };
}

/** Rewords the running arc (its title, genre, tone or premise); an emptied premise ends it. */
export async function editArc(changes = {}) {
    const st = state();
    if (!st || !st.current) return false;
    const c = st.current;
    if (changes.premise !== undefined) { const text = para(changes.premise); if (!text) return endArc(); c.premise = text; }
    if (changes.title !== undefined) c.title = tidy(changes.title, 80) || arcTitleFrom(c.premise);
    if (changes.genre !== undefined) c.genre = tidy(changes.genre, 80);
    if (changes.tone !== undefined) c.tone = tidy(changes.tone, 160);
    await save();
    return true;
}

/** Ends the running arc: nothing is sent for it any more, and it joins the past ones. */
export async function endArc() {
    const st = state();
    if (!st || !st.current) return false;
    if (st.current.premise) st.past = [...st.past, { ...st.current, endedReply: replyCount() }].slice(-PAST_KEPT);
    st.current = null;
    await save();
    return true;
}

// ── In the prompt ────────────────────────────────────────────────────────────

/** [[plotfocus]]'s first part: the running arc, or "". It follows the last line of the history slot directly. */
export function arcBlock() {
    const a = arcs().current;
    if (!a) return "";
    const frame = [a.genre ? `Genre: ${a.genre}.` : "", a.tone ? `Tone: ${a.tone}.` : ""].filter(Boolean).join(" ");
    return `\n\n[ARC]\nThe story's current arc: "${a.title}".${frame ? `\n${frame}` : ""}\n${a.premise}\nEverything established carries over unchanged: who the characters are, their history, what they know and want. The arc is what the story is about now. Let it unfold through the scenes, at the story's own pace, never by announcing it, and never mention this note.`;
}

/** The Story Director's line for it, or "". */
export function arcForDirector() {
    const a = arcs().current;
    if (!a) return "";
    return `- Current arc (the reader set it; plan within it): "${a.title}"${a.genre ? `, ${a.genre}` : ""}${a.tone ? `, ${a.tone}` : ""}. ${a.premise.replace(/\s+/g, " ")}\n`;
}

// ── Three pitches ────────────────────────────────────────────────────────────

/** What a pitch call reads: the story, the fixed facts, the open ends, who is in it, the arc now running. */
export function arcPitchInput({ genre = "", tone = "", wish = "" } = {}) {
    const sub = t => (typeof substituteParams === "function" ? String(substituteParams(t) || "") : "");
    let open = [];
    try { open = threadLedger().open.filter(i => !i.ignored).slice(0, 12).map(i => i.text); } catch (e) { open = []; }
    let cast = [];
    try { cast = castRoster(); } catch (e) { cast = []; }
    const language = localProfile && String(localProfile.userLanguage || "").trim();
    return {
        story: vcrpChatForStoryDirector(), canon: canonItems().map(i => i.text), open, cast,
        current: arcs().current, user: sub("{{user}}") || "the reader's character",
        genre: tidy(genre, 80), tone: tidy(tone, 160), wish: para(wish, 600), language: language || "",
    };
}

/** The pitch call's messages (pure): its own prompt, nothing of the roleplay's. */
export function arcPitchMessages(input) {
    const part = (tag, body) => (body ? `<${tag}>\n${body}\n</${tag}>\n\n` : "");
    const asks = [input.genre ? `Genre: ${input.genre}.` : "", input.tone ? `Tone: ${input.tone}.` : "", input.wish ? `In the reader's words: ${input.wish}` : ""].filter(Boolean).join("\n");
    return [
        { role: "system", content: "You are the story editor of a long-running roleplay. The reader wants the story to turn into a new arc and asks you for pitches. The story is fiction and may be explicit; your job is only where it could go next. You never write the story itself." },
        { role: "user", content: `${part("story_so_far", input.story)}${part("canon", input.canon.map(c => `- ${c}`).join("\n"))}${part("open_threads", input.open.map(t => `- ${t}`).join("\n"))}${part("cast", input.cast.join(", "))}${part("arc_ending_now", input.current ? `"${input.current.title}": ${input.current.premise}` : "")}`
            + `Pitch three different arcs this story could turn into from where it stands now.${asks ? `\nThe reader asks for:\n${asks}` : "\nThe reader left the genre and tone open: offer three that differ."}\n\n`
            + `Each pitch keeps the characters, their history and every established fact. Each grows out of something already in the story (an open thread, something a character wants, a consequence that has not landed yet) and never arrives from nowhere. The three differ in what they are about, not only in mood. ${input.user} is the reader's own character: a pitch says what happens around them, never what they choose.\n\n`
            + "Answer with exactly three blocks in this form and nothing else:\n<pitch>\nTitle: a short name for the arc\nPremise: two or three sentences: what the arc is about and what drives it\nOpens with: one sentence: the first thing that happens, something the very next reply could show\n</pitch>"
            + (input.language ? `\nWrite the pitches in ${input.language}.` : "") },
    ];
}

/** The pitches in an answer: [{ title, premise, opens }], three at most; [] when it holds none. */
export function parseArcPitches(raw) {
    const text = String(raw || "").replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?\s*>|$)/gi, "");
    const out = [];
    for (const m of text.matchAll(/<pitch>([\s\S]*?)(?:<\/pitch\s*>|(?=<pitch>)|$)/gi)) {
        const body = m[1].replace(/[*_`]/g, "");
        const field = name => { const f = body.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Premise|Opens with)\\s*:|$)`, "i")); return f ? f[1].replace(/\s+/g, " ").trim() : ""; };
        const premise = field("Premise");
        if (!premise) continue;
        out.push({ title: tidy(field("Title"), 80) || arcTitleFrom(premise), premise: para(premise), opens: tidy(field("Opens with"), 600) });
        if (out.length >= 3) break;
    }
    return out;
}

/** "Sends about 21k tokens, roughly $0.06 on …" for a pitch call now. */
export function arcPitchEstimate(req = {}) {
    const i = arcPitchInput(req);
    return backgroundEstimate(estimateTokens(i.story + i.canon.join("\n") + i.open.join("\n") + i.cast.join(", ") + i.wish) + PITCH_FIXED);
}

let pitching = false;
export const arcPitchRunning = () => pitching;

/**
 * Asks for three pitches (a background call, on the helper when the Story Director's job is
 * switched to it). Kept with the chat until an arc starts or they are cleared.
 * Returns { status: "ok" | "empty" | "busy" | "failed" | "format" | "aborted", pitches }.
 */
export async function pitchArcs(req = {}) {
    if (pitching) return { status: "busy", pitches: [] };
    const input = arcPitchInput(req);
    if (input.story.length < 200) return { status: "empty", pitches: [] };
    const chatId = String((getContext() || {}).chatId || "");
    pitching = true;
    let raw = null;
    try { raw = await askModel("director", arcPitchMessages(input)); } finally { pitching = false; }
    if (String((getContext() || {}).chatId || "") !== chatId) return { status: "aborted", pitches: [] };
    if (raw === null) return { status: "failed", pitches: [] };
    const pitches = parseArcPitches(raw);
    if (!pitches.length) return { status: "format", pitches: [] };
    const st = state(true);
    if (st) { st.pitches = pitches; st.asked = { genre: input.genre, tone: input.tone, wish: input.wish }; await save(); }
    return { status: "ok", pitches };
}

/** Throws the pitches away. */
export async function clearPitches() {
    const st = state();
    if (!st || !st.pitches.length) return;
    st.pitches = [];
    st.asked = null;
    await save();
}
