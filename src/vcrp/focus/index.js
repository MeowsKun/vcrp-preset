// ─────────────────────────────────────────────────────────────────────────────
// VCRP Focus: keeps a long roleplay from drifting.
//
// Every N replies an audit reads those replies against the character card and what
// earlier audits flagged, and looks for three kinds of drift: characters slipping from
// who they are, motifs coming back again and again, and slop piling up. It writes a
// short correction for the writer. The correction waits in the Focus tab until it is
// approved, then rides in the per-turn rules ([[focus]], after the chat history, so the
// cache never sees it) until the next approved audit replaces it.
//
// What approved audits flagged is kept as a numbered list. Each audit is shown it and
// says which items came back, so a motif that survives one correction is counted and
// named more firmly in the next.
//
// The settings (on, how often, which checks) are the profile's. The audit's state (the
// note, the waiting audit, the flagged list, where the last audit ended) is the chat's.
//
// The plot focus is the reader's own steer: something the story should revolve around.
// It goes last in the prompt, after the newest message ([[plotfocus]] at the end of the
// </history> slot), the most weight a line can have and still outside the cache. Story
// Memory's recall looks for it, audits check the story stays on it, and the Story Director
// plans around it. It is the chat's, and stays until it is switched off (or its optional
// reply count runs out).
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, generateQuietPrompt, substituteParams, isGenerating } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { meguminActiveDataIdentity } from "../../core/keys.js";
import {
    activeFocusAudit, setActiveFocusAudit,
    activeStoryPlanRequest, activeBanListChat, activeNpcScanRequest, activeNpcUpdateRequest, activeGenerationOrder,
} from "../../core/activeRequests.js";
import { meguminCleanChatHistoryText } from "../../engine/chatText.js";
import { resolveAnchor, anchorOf, estimateTokens, vcrpCountBackgroundOutput } from "../memory/index.js";
import { memorySummaryRunning } from "../memory/summarize.js";
import { backgroundEstimate } from "../backgroundCosts.js";
import { vcrpWithoutSwipedReply } from "../generation.js";
import { registerRecallQuery } from "../memory/index.js";
import { DEFAULT_PROMPTS } from "../../prompts/index.js";
import { toneRules } from "../toneRules.js";

const META = "vcrp_focus";
const MIN_REPLIES = 3;        // fewer than this is not enough to call anything a pattern
const MAX_ITEMS = 30;         // flagged items kept; the least repeated, oldest go first
const MAX_FAILURES = 2;       // failed audits in a row before automatic audits pause
const AUDIT_FIXED = 1500;     // the audit's own instructions, roughly
const STANDING = 3;           // repeat offenders kept in the prompt across corrections

export const FOCUS_CHECKS = {
    drift: { label: "Character drift", desc: "Voice, personality and speech slipping from the card and from how they have been written." },
    motifs: { label: "Repeated motifs", desc: "Images, gestures, metaphors and scene beats that keep coming back." },
    slop: { label: "Slop & clichés", desc: "Stock phrasing, purple prose and AI-isms piling up." },
};

export function focusSettings() {
    const f = (localProfile && localProfile.focus) || {};
    const every = Math.round(Number(f.every));
    return {
        enabled: !!f.enabled,
        every: Number.isFinite(every) && every >= 5 ? Math.min(every, 100) : 20,
        checks: { drift: true, motifs: true, slop: true, ...(f.checks || {}) },
        standing: f.standing !== false,
    };
}

// ── The chat's state ─────────────────────────────────────────────────────────

/** The chat's Focus state, created on first use. */
export function focusState() {
    if (!chat_metadata) return null;
    let st = chat_metadata[META];
    if (!st || typeof st !== "object") {
        st = chat_metadata[META] = { anchor: null, note: "", noteAt: 0, pending: null, items: [], nextId: 1, audits: 0, lastAuditAt: 0, lastClean: false, failures: 0 };
    }
    if (!Array.isArray(st.items)) st.items = [];
    return st;
}
/** The state if this chat has one, without creating it (prompt building and drawing). */
export const peekFocusState = () => (chat_metadata && chat_metadata[META] && typeof chat_metadata[META] === "object") ? chat_metadata[META] : null;

const storyMessages = () => (((getContext() || {}).chat) || []).filter(m => !m.is_system);
const now = () => Date.now();
const save = async () => { try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Focus: could not save the chat's state:", e); } };

/** Replies written since the last audit (all of them if there has been none). */
export function repliesSinceAudit() {
    const msgs = storyMessages();
    const st = peekFocusState();
    const at = st && st.anchor ? resolveAnchor(msgs, st.anchor) : -1;
    return msgs.slice(at + 1).filter(m => !m.is_user).length;
}

// ── What an audit reads ──────────────────────────────────────────────────────

/**
 * The last `every` replies and the player's messages between them, the card, and the
 * flagged list. Null when there are too few replies to judge.
 */
export function focusAuditInput() {
    const s = focusSettings();
    const msgs = storyMessages();
    let start = msgs.length, replies = 0;
    while (start > 0 && replies < s.every) { start--; if (!msgs[start].is_user) replies++; }
    if (replies < MIN_REPLIES) return null;
    if (start > 0 && msgs[start - 1].is_user) start--;   // the message the first of them answers
    const lines = msgs.slice(start).map(m => {
        const t = meguminCleanChatHistoryText(m.mes);
        return t ? `${m.name || (m.is_user ? "User" : "Character")}${m.is_user ? " (player)" : ""}: ${t}` : null;
    }).filter(Boolean);
    const text = lines.join("\n\n");
    if (text.length < 200) return null;
    const sub = t => (typeof substituteParams === "function" ? String(substituteParams(t) || "") : "");
    const card = [sub("{{description}}"), sub("{{personality}}")].filter(t => t.trim()).join("\n\n");
    const st = peekFocusState();
    return {
        text, replies, card,
        charName: sub("{{char}}") || "the character",
        userName: sub("{{user}}") || "the player",
        checks: s.checks,
        items: ((st && st.items) || []).map(i => ({ id: i.id, kind: i.kind, text: i.text, times: i.times })),
        plot: plotFocusActive(st) ? { text: st.plot.text.trim(), strength: plotStrength(st.plot).label } : null,
        // The chat's Tone Rules (vcrp/toneRules.js), while they are on: checked like the plot focus.
        tone: (() => { const t = toneRules(); return t.enabled && t.text.trim() ? t.text.trim() : null; })(),
    };
}

/** "Sends about 38k tokens, roughly $0.24 on …" for the next audit, or null with too few replies. */
export function focusEstimate() {
    const input = focusAuditInput();
    if (!input) return null;
    const items = input.items.map(i => i.text).join("\n");
    return backgroundEstimate(estimateTokens(input.text + input.card + items + (input.plot ? input.plot.text : "") + (input.tone || "")) + AUDIT_FIXED);
}

// ── The audit prompt ─────────────────────────────────────────────────────────

const KIND_OF = { drift: "drift", motifs: "motif", slop: "slop" };

const CHECK_KEY = { drift: "checkDrift", motifs: "checkMotifs", slop: "checkSlop" };

/**
 * A Focus prompt: the reader's edit when their edits are on and the key is not blank,
 * otherwise the built-in one (src/prompts/focus.js).
 */
export function focusPrompt(key) {
    const f = localProfile && localProfile.focus;
    const own = f && f.customPromptsEnabled && f.customPrompts ? f.customPrompts[key] : null;
    return typeof own === "string" && own.trim() ? own : DEFAULT_PROMPTS.focus[key];
}
// Fills {{token}}s in one pass: what goes in is never read for tokens again, a $ in the story
// stays as written, and tokens it does not know ({{user}}) are left for SillyTavern.
const fill = (text, values) => String(text || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? String(values[k]) : m));

/** The messages an audit sends: its own prompt, not the roleplay's. */
export function buildFocusAuditMessages(input) {
    const checks = Object.keys(CHECK_KEY).filter(k => input.checks[k]);
    const kinds = [...checks.map(k => `[${KIND_OF[k]}]`), ...(input.plot ? ["[plot]"] : []), ...(input.tone ? ["[tone]"] : [])].join(", ");
    const flagged = input.items.length
        ? input.items.map(i => `${i.id} [${i.kind}] ${i.text} (flagged ${i.times} time${i.times === 1 ? "" : "s"})`).join("\n")
        : "None yet. This is the first audit.";
    const lines = [
        ...checks.map(k => fill(focusPrompt(CHECK_KEY[k]), { char: input.charName })),
        ...(input.plot ? [fill(focusPrompt("checkPlot"), { strength: input.plot.strength.toLowerCase(), char: input.charName })] : []),
        ...(input.tone ? [fill(focusPrompt("checkTone"), { char: input.charName })] : []),
    ];
    // The tone's note rides in the {{plotNote}} token, so an audit task edited before the
    // Tone Rules existed still asks for it.
    const task = fill(focusPrompt("auditTask"), {
        char: input.charName, checks: lines.join("\n"), kinds,
        plotNote: (input.plot ? focusPrompt("plotNote") : "") + (input.tone ? focusPrompt("toneNote") : ""),
    });
    return [
        { role: "system", content: focusPrompt("auditSystem") },
        { role: "user", content: `<character_card>\n${input.card || "No character card."}\n</character_card>\n\n${input.plot ? `<plot_focus>\n${input.plot.text}\n</plot_focus>\n\n` : ""}${input.tone ? `<tone_rules>\n${input.tone}\n</tone_rules>\n\n` : ""}<earlier_findings>\n${flagged}\n</earlier_findings>\n\n<replies>\n${input.text}\n</replies>` },
        { role: "user", content: task },
    ];
}

/** The audit's answer as { recurring, findings, note }; null when it is not one. `plot`, `tone`: plot or tone drift was asked for. */
export function parseFocusAudit(raw, checks = focusSettings().checks, { plot = false, tone = false } = {}) {
    // Anything up to a closing thinking tag is the model thinking, prefilled or not.
    const text = String(raw || "").replace(/^[\s\S]*<\/think(?:ing)?\s*>/i, "");
    const tag = t => { const m = text.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}\\s*>`, "i")); return m ? m[1].trim() : null; };
    // The note comes last: one cut off by the length limit is still a note.
    const note = tag("note") ?? ((text.match(/<note>([\s\S]*)$/i) || [])[1] || null)?.trim() ?? null;
    if (note === null) return null;
    const allowed = new Set([...Object.keys(KIND_OF).filter(k => checks[k]).map(k => KIND_OF[k]), ...(plot ? ["plot"] : []), ...(tone ? ["tone"] : [])]);
    const findings = (tag("findings") || "").split("\n").map(findingOf).filter(f => f && allowed.has(f.kind));
    const recurring = [...new Set([...(tag("recurring") || "").matchAll(/\bF\d+\b/gi)].map(m => m[0].toUpperCase()))];
    // A label the model put in front of the note is not part of it.
    const clean = note.replace(/^\s*[*_]*\s*(?:correction|note)\s*[*_]*\s*:\s*[*_]*\s*/i, "").trim();
    return { recurring, findings, note: /^none\.?$/i.test(clean) ? "" : clean };
}

// A finding line, however the model dressed it: "- [motif] x", "- **[MOTIF]** x", "1) Motif: x",
// "- **Repeated motif** - x". The kind needs its brackets or a separator after it, so a finding
// that merely starts with the word ("Plot points dropped") is not misread.
const KIND_WORD = "character drift|plot drift|tone drift|repeated motifs?|drift|motifs?|slop|plot|tone";
const FINDING_RE = new RegExp(`^\\s*(?:[-*•]|\\d+[.)])?\\s*[*_]*\\s*(?:\\[\\s*(${KIND_WORD})\\s*\\]\\s*[*_]*\\s*[:\\-–—]?|(${KIND_WORD})\\s*[*_]*\\s*[:\\-–—])\\s*(.+?)\\s*$`, "i");
const KIND_NAME = w => { w = w.toLowerCase(); return /tone/.test(w) ? "tone" : /plot/.test(w) ? "plot" : /drift/.test(w) ? "drift" : /motif/.test(w) ? "motif" : "slop"; };
function findingOf(line) {
    const m = String(line).match(FINDING_RE);
    if (!m) return null;
    const text = m[3].replace(/^[*_\s]+|[*_\s]+$/g, "");
    return text ? { kind: KIND_NAME(m[1] || m[2]), text } : null;
}

// ── Running an audit ─────────────────────────────────────────────────────────

let auditing = false;
export const focusAuditRunning = () => auditing;

/** Another background call swaps in its own prompt while it runs: never overlap one. */
const busy = () => auditing || memorySummaryRunning() || (typeof isGenerating === "function" && isGenerating())
    || !!(activeStoryPlanRequest || activeBanListChat || activeNpcScanRequest || activeNpcUpdateRequest || activeGenerationOrder || activeFocusAudit);

const changeListeners = new Set();
/** The Focus tab redraws itself when an audit lands. */
export function onFocusChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }
const changed = () => changeListeners.forEach(fn => { try { fn(); } catch (e) { console.warn("[VCRP] Focus redraw failed:", e); } });

/**
 * Runs one audit. Returns { status: "pending" | "clean" | "idle" | "busy" | "failed" | "aborted", reason? }.
 * The result waits in `pending` for review; nothing reaches the prompt until it is approved.
 */
export async function runFocusAudit() {
    if (busy()) return { status: "busy" };
    const input = focusAuditInput();
    if (!input) return { status: "idle", reason: `fewer than ${MIN_REPLIES} replies to read` };
    const identity = meguminActiveDataIdentity();
    const msgs = storyMessages();
    const mark = anchorOf(msgs, msgs.length - 1);
    auditing = true;
    setActiveFocusAudit(input);
    let raw = "";
    try {
        raw = await generateQuietPrompt({ prompt: "___PS_FOCUS___" });
    } catch (e) {
        console.error("[VCRP] Focus audit failed:", e);
        raw = null;
    } finally {
        setActiveFocusAudit(null);
        auditing = false;
    }
    if (raw) vcrpCountBackgroundOutput(raw);
    if (meguminActiveDataIdentity() !== identity) {
        console.debug(`[VCRP] Focus audit discarded: it started on "${identity}" but "${meguminActiveDataIdentity()}" is active now.`);
        return { status: "aborted", reason: "the chat changed" };
    }
    const st = focusState();
    if (raw === "") return { status: "aborted", reason: "stopped" };
    const parsed = raw === null ? null : parseFocusAudit(raw, input.checks, { plot: !!input.plot, tone: !!input.tone });
    if (!parsed) {
        st.failures = (st.failures || 0) + 1;
        await save(); changed();
        return { status: "failed", reason: raw === null ? "the request failed" : "the answer was not in the audit format", paused: st.failures >= MAX_FAILURES };
    }
    st.failures = 0;
    st.anchor = mark;
    st.audits = (st.audits || 0) + 1;
    st.lastAuditAt = now();
    const found = !!(parsed.note || parsed.findings.length || parsed.recurring.length);
    st.lastClean = !found;
    st.pending = found ? { ...parsed, at: now(), replies: input.replies } : null;
    await save(); changed();
    return { status: found ? "pending" : "clean" };
}

// ── Review ───────────────────────────────────────────────────────────────────

const sameText = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === String(b).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Approves the waiting audit: its note goes live (edited, if `note` is given; an empty one keeps the current note) and its findings are kept. */
export async function approveFocusAudit(note) {
    const st = focusState();
    const p = st && st.pending;
    if (!p) return false;
    const at = now();
    for (const id of p.recurring || []) {
        const item = st.items.find(i => i.id === id);
        if (item) { item.times++; item.last = at; }
    }
    for (const f of p.findings || []) {
        const same = st.items.find(i => i.kind === f.kind && sameText(i.text, f.text));
        if (same) { same.times++; same.last = at; continue; }
        st.items.push({ id: `F${st.nextId++}`, kind: f.kind, text: f.text, times: 1, last: at });
    }
    if (st.items.length > MAX_ITEMS) {
        const keep = [...st.items].sort((a, b) => (b.times - a.times) || (b.last - a.last)).slice(0, MAX_ITEMS);
        st.items = st.items.filter(i => keep.includes(i));
    }
    // An audit with no correction of its own leaves the current one in place: it is
    // probably why nothing drifted. "Take it out of the prompt" removes it on purpose.
    const next = String(note !== undefined ? note : p.note || "").trim();
    if (next) { st.note = next; st.noteAt = at; }
    st.pending = null;
    await save(); changed();
    return true;
}

/** Drops the waiting audit. Its replies count as audited; nothing it found is kept. */
export async function discardFocusAudit() {
    const st = focusState();
    if (!st || !st.pending) return;
    st.pending = null;
    await save(); changed();
}

export async function setFocusNote(text) {
    const st = focusState();
    if (!st) return;
    st.note = String(text || "").trim();
    st.noteAt = now();
    await save();
}

export async function removeFocusItem(id) {
    const st = focusState();
    if (!st) return;
    st.items = st.items.filter(i => i.id !== id);
    await save(); changed();
}

/** Clears the chat's Focus state: note, waiting audit, flagged list, and where the last audit ended. */
export async function resetFocus() {
    if (!chat_metadata) return;
    delete chat_metadata[META];
    await save(); changed();
}

// ── The prompt ───────────────────────────────────────────────────────────────

export const FOCUS_STANDING_INTRO = DEFAULT_PROMPTS.focus.standingIntro;

/**
 * The repeat offenders: up to three findings that came back after a correction (flagged in
 * two audits or more), most often first. A new correction replaces the old one; these stay,
 * so what an earlier note fixed does not creep back the moment the next note leaves it out.
 */
export function focusStanding(st = peekFocusState()) {
    return ((st && st.items) || []).filter(i => i.times >= 2)
        .sort((a, b) => (b.times - a.times) || ((b.last || 0) - (a.last || 0))).slice(0, STANDING);
}

/** [[focus]]: the approved note and the repeat offenders, or nothing. Removing the note removes both. */
export function vcrpFocusBlock() {
    const s = focusSettings();
    if (!s.enabled) return "";
    const st = peekFocusState();
    const note = st && typeof st.note === "string" ? st.note.trim() : "";
    if (!note) return "";
    const standing = s.standing ? focusStanding(st) : [];
    const keep = standing.length ? `\n${focusPrompt("standingIntro")}\n${standing.map(i => `- ${i.text}`).join("\n")}` : "";
    return fill(focusPrompt("correctionTemplate"), { note, standing: keep });
}

// ── After a reply ────────────────────────────────────────────────────────────

/**
 * Runs an audit if one is due: Focus on, enough replies since the last audit, none waiting
 * for review, not paused after failures. null when none is due; { status: "busy" } when one
 * is due but another generation is running.
 */
export async function focusAuditIfDue({ onStart } = {}) {
    const s = focusSettings();
    if (!s.enabled) return null;
    const st = peekFocusState();
    if (st && (st.pending || (st.failures || 0) >= MAX_FAILURES)) return null;
    if (repliesSinceAudit() < s.every) return null;
    if (busy()) return { status: "busy" };
    if (onStart) onStart();
    return runFocusAudit();
}

/**
 * MESSAGE_RECEIVED: run an audit once enough replies have come in. Never blocks the reply,
 * waits for SillyTavern and the other background calls (Story Memory goes first), and
 * holds while an audit waits for review or after failures.
 */
export function vcrpFocusAfterReply(_messageId, type) {
    if (type === "first_message") return;
    notePlotFocusEnd();
    if (!focusSettings().enabled) return;
    const identity = meguminActiveDataIdentity();
    let waited = 0;
    const attempt = async () => {
        if (meguminActiveDataIdentity() !== identity) return;
        const r = await focusAuditIfDue({
            onStart: () => { if (typeof toastr !== "undefined") toastr.info("Auditing the recent replies for drift…", "VCRP Focus", { timeOut: 3000 }); },
        });
        if (!r) return;
        if (r.status === "busy") {
            if ((waited += 3000) <= 120000) setTimeout(attempt, 3000);
            return;
        }
        if (typeof toastr === "undefined") return;
        if (r.status === "pending") toastr.info("A Focus audit is ready for review in the Focus tab.", "VCRP Focus");
        else if (r.status === "clean") toastr.success("Focus audit: no drift found.", "VCRP Focus");
        else if (r.status === "failed") toastr.warning(r.paused
            ? `Focus audit failed again (${r.reason}). Automatic audits are paused; use Audit now in the Focus tab to retry.`
            : `Focus audit failed: ${r.reason}. It will be retried after the next reply.`, "VCRP Focus");
    };
    // After Story Memory's summary, which starts 2 seconds after the reply.
    setTimeout(attempt, 4000);
}

export { MIN_REPLIES as FOCUS_MIN_REPLIES, MAX_FAILURES as FOCUS_MAX_FAILURES };

// ── Plot focus ───────────────────────────────────────────────────────────────

export const PLOT_STRENGTHS = {
    thread: { label: "Background thread", key: "plotThread" },
    central: { label: "Central", key: "plotCentral" },
    driving: { label: "Driving", key: "plotDriving" },
};
export const PLOT_DEFAULTS = { active: false, text: "", strength: "central", endAfter: 0, anchor: null, endNoticed: false };
const plotStrength = p => PLOT_STRENGTHS[p && p.strength] || PLOT_STRENGTHS.central;

/**
 * Replies the plot focus still has, or Infinity without a count. While a reply is being
 * swiped it is not counted: its replacement still gets the plot focus.
 */
export function plotFocusRemaining(st = peekFocusState()) {
    const p = st && st.plot;
    const n = Math.round(Number(p && p.endAfter)) || 0;
    if (!p || n <= 0) return Infinity;
    const msgs = vcrpWithoutSwipedReply(storyMessages());
    const at = p.anchor ? resolveAnchor(msgs, p.anchor) : -1;
    return Math.max(0, n - msgs.slice(at + 1).filter(m => !m.is_user).length);
}

/** On, with something written, and replies left. */
export function plotFocusActive(st = peekFocusState()) {
    const p = st && st.plot;
    return !!(p && p.active && String(p.text || "").trim() && plotFocusRemaining(st) > 0);
}

/** Changes the plot focus. Switching it on or changing its count starts the count again. */
export async function setPlotFocus(changes) {
    const st = focusState();
    if (!st) return;
    const was = { ...PLOT_DEFAULTS, ...(st.plot || {}) };
    const next = { ...was, ...changes };
    if (typeof next.text === "string") next.text = next.text.trim();
    if ((next.active && !was.active) || next.endAfter !== was.endAfter) {
        const msgs = storyMessages();
        next.anchor = msgs.length ? anchorOf(msgs, msgs.length - 1) : null;
        next.endNoticed = false;
    }
    // Findings about a plot focus that has changed no longer apply.
    if (next.text !== was.text) st.items = (st.items || []).filter(i => i.kind !== "plot");
    st.plot = next;
    await save(); changed();
}

/** [[plotfocus]]: the plot focus, or nothing. It follows "</history>"'s last line directly. */
export function vcrpPlotFocusBlock() {
    const st = peekFocusState();
    if (!plotFocusActive(st)) return "";
    return "\n\n" + fill(focusPrompt("plotTemplate"), { plot: st.plot.text.trim(), strength: focusPrompt(plotStrength(st.plot).key) });
}

/** The Story Director's line for it, or "". */
export function plotFocusForDirector() {
    const st = peekFocusState();
    if (!plotFocusActive(st)) return "";
    return `- Plot Focus (${plotStrength(st.plot).label}; build the blueprint around it): ${st.plot.text.trim()}\n`;
}

/** After a reply: say so once when the plot focus's replies have run out. */
function notePlotFocusEnd() {
    const st = peekFocusState();
    const p = st && st.plot;
    if (!p || !p.active || p.endNoticed || plotFocusRemaining(st) > 0) return;
    p.endNoticed = true;
    save(); changed();
    if (typeof toastr !== "undefined") toastr.info(`The plot focus has run its ${p.endAfter} replies and is no longer sent. Switch it on again in the Focus tab to restart the count.`, "VCRP Focus");
}

// Story Memory's recall reads the plot focus with the recent messages, so old chapters and
// facts about it come back while it is on.
registerRecallQuery(() => {
    const st = peekFocusState();
    return plotFocusActive(st) ? st.plot.text : "";
});
