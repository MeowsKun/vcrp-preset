// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: writing chapters.
//
// After a reply, if the summaries no longer reach far enough for a cold-start cut to fit
// the budget, the next stretch of chat is summarized. The call is SillyTavern's quiet
// generation, so it carries the same prompt the reply just used and reads it from cache;
// only the instruction at the end is new. A second call checks the summary against the
// same messages. With review on (the default) the result waits for the reader; otherwise
// it is saved straight away.
//
// Catching up (the "Summarize now" button on a long chat), or summarizing while the cache
// is cold, uses a standalone call instead: just the stretch itself, the fact ledger and the
// previous gist. Carrying a long, uncached chat into every call would cost more than one
// request should.
//
// The chat here is SillyTavern's chat without system messages: the same array the
// generate interceptor sees, so anchors line up.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, generateQuietPrompt, isGenerating, saveMetadata } from "../../st.js";
import { meguminActiveDataIdentity } from "../../core/keys.js";
import {
    activeStoryPlanRequest, activeBanListChat, activeNpcScanRequest, activeNpcUpdateRequest, activeGenerationOrder, activeFocusAudit,
} from "../../core/activeRequests.js";
import { meguminCleanChatHistoryText } from "../../engine/chatText.js";
import {
    memoryState, memoryBudgetSettings, currentMemoryBudget, estimateTokens, anchorOf, resolveAnchor,
    vcrpMemoryEnabled, setMemoryTaskActive, memoryNow, vcrpMemoryCountTaskOutput,
} from "./index.js";
import { summaryTarget, isCold } from "./window.js";
import { parseSummary, parseCheck, parseFactChanges, applyFactChanges, formatFactChanges, formatLedgerForTask, gistsToFold } from "./ledger.js";
import { summaryTask, checkTask, foldTask } from "./prompts.js";
import { localProfile } from "../../core/state.js";

/** Global Settings' story language, if one is set. */
const storyLanguage = () => {
    const l = localProfile && typeof localProfile.userLanguage === "string" ? localProfile.userLanguage.trim() : "";
    return l && !/^english$/i.test(l) ? l : "";
};

export const MIN_SPAN = 3000;      // don't call for less than this many tokens of chat
export const MAX_SPAN = 8000;      // one chapter covers at most this much
export const LOOKAHEAD = 8000;     // stay this far ahead of where a cold cut would land
export const MAX_WAITING = 3;      // chapters waiting for review before automatic summaries hold off
export const MAX_FAILURES = 2;     // failures in a row before automatic summaries pause

const clean = m => meguminCleanChatHistoryText(m && m.mes);

export function storyChat() {
    const ctx = getContext();
    return Array.isArray(ctx && ctx.chat) ? ctx.chat.filter(m => !m.is_system) : [];
}

/** Where summaries currently end, counting work waiting for review. -1 if an anchor is lost. */
export function summarizedEnd(chat, st) {
    const pending = (st.pending || []).at(-1);
    return pending ? resolveAnchor(chat, pending.end) : resolveAnchor(chat, st.summarized);
}

/**
 * The next stretch to summarize, or null when the summaries are far enough ahead.
 * `catchUp` ignores the lookahead target and takes the next stretch anywhere before the
 * verbatim floor (the "Summarize now" button on a long chat).
 */
export function nextSpan(chat, st, budget, { catchUp = false } = {}) {
    if (!budget) return null;
    const msgs = chat.map(m => ({ tokens: estimateTokens(clean(m)), isUser: !!m.is_user }));
    const start = summarizedEnd(chat, st);
    if (start < 0) return null;
    let target = summaryTarget({ msgs, fixedTokens: st.fixedTokens || 12000, budget, lookahead: LOOKAHEAD });
    if (catchUp) target = Math.max(target, catchUpLimit(msgs, budget));
    if (target <= start) return null;
    let end = start, tokens = 0;
    for (let i = start; i < target; i++) { tokens += msgs[i].tokens; end = i + 1; if (tokens >= MAX_SPAN) break; }
    // A chapter ends after a reply, so the next one opens on a user message.
    while (end > start + 1 && end < msgs.length && !msgs[end].isUser) end--;
    const spanTokens = msgs.slice(start, end).reduce((n, m) => n + m.tokens, 0);
    if (spanTokens < (catchUp ? 1 : MIN_SPAN)) return null;
    return { start, end, tokens: spanTokens };
}

/** The furthest a catch-up may summarize: everything but the verbatim floor, at a user message. */
function catchUpLimit(msgs, budget) {
    let floor = 0, after = 0;
    for (let i = msgs.length - 1; i >= 0; i--) { after += msgs[i].tokens; if (after >= budget.minVerbatim) { floor = i; break; } }
    while (floor > 0 && !msgs[floor].isUser) floor--;
    return floor;
}

/** Tokens of chat not yet covered by chapters (saved or waiting) that a catch-up would cover. */
export function unsummarizedTokens(chat, st, budget) {
    if (!budget) return 0;
    const start = Math.max(0, summarizedEnd(chat, st));
    const msgs = chat.map(m => ({ tokens: estimateTokens(clean(m)), isUser: !!m.is_user }));
    return msgs.slice(start, Math.max(start, catchUpLimit(msgs, budget))).reduce((n, m) => n + m.tokens, 0);
}

const opening = m => {
    const words = clean(m).replace(/\s+/g, " ").trim().split(" ");
    return words.slice(0, 14).join(" ") + (words.length > 14 ? "…" : "");
};

/** The stretch itself, as a standalone call carries it. */
const stretchText = (chat, span) => chat.slice(span.start, span.end).map(m => `${m.name || (m.is_user ? "User" : "Character")}: ${clean(m)}`).join("\n\n");

// The stretch sits in its own message, then a short reply, then the instruction. Prompt
// caching then marks the end of the stretch as well, so the check call, which opens with
// the same three messages, reads the stretch from cache instead of writing it again.
const standaloneMessages = (chat, span, task) => [
    { role: "system", content: "You keep the story memory for a long roleplay. You summarize stretches of it accurately and plainly, and change nothing about what happened." },
    { role: "user", content: `<chat>\n${stretchText(chat, span)}\n</chat>` },
    { role: "assistant", content: "I have read this stretch of the chat." },
    { role: "user", content: task },
];

let running = false;
export const memorySummaryRunning = () => running;

/** Another VCRP background task swaps in its own prompt while it runs: never overlap one. */
const otherTaskRunning = () => !!(activeStoryPlanRequest || activeBanListChat || activeNpcScanRequest || activeNpcUpdateRequest || activeGenerationOrder || activeFocusAudit);

async function quiet(prompt, standalone) {
    setMemoryTaskActive(true, standalone || null);
    let out;
    try { out = await generateQuietPrompt({ quietPrompt: prompt }); } finally { setMemoryTaskActive(false); }
    vcrpMemoryCountTaskOutput(out);
    return out;
}

function noteFailure(st, reason) {
    st.summaryFailures = (st.summaryFailures || 0) + 1;
    return { status: "failed", reason, paused: st.summaryFailures >= MAX_FAILURES };
}

/**
 * Summarizes the next stretch, if one is due. Returns what happened:
 *   { status: "idle" | "busy" | "saved" | "pending" | "folded" | "failed" | "aborted", reason?, paused? }
 */
export async function summarizeNext({ catchUp = false } = {}) {
    if (!vcrpMemoryEnabled()) return { status: "idle", reason: "memory off" };
    if (running || otherTaskRunning()) return { status: "busy" };
    const st = memoryState();
    const budget = currentMemoryBudget();
    const chat = storyChat();
    const span = st && nextSpan(chat, st, budget, { catchUp });
    if (!span) return st ? foldNext(st) : { status: "idle" };

    running = true;
    const identity = meguminActiveDataIdentity();
    const lost = () => meguminActiveDataIdentity() !== identity || memoryState() !== st;
    // Reuse the warm cache when there is one; otherwise a small standalone call.
    const standalone = catchUp || isCold(st, memoryNow(), budget);
    try {
        const startQuote = opening(chat[span.start]);
        const endQuote = opening(chat[span.end - 1]);
        const chapters = st.chapters || [];
        const fold = gistsToFold(chapters);
        const task = summaryTask({
            startQuote, endQuote,
            ledgerText: formatLedgerForTask(st.ledger),
            previousGist: ((st.pending || []).at(-1) || chapters.at(-1) || {}).gist,
            foldGists: fold.map(c => c.gist),
            language: storyLanguage(),
        });
        const raw = await quiet(task, standalone ? standaloneMessages(chat, span, task) : null);
        if (lost()) return { status: "aborted", reason: "the chat changed" };
        let result = parseSummary(raw);
        if (!result.ok) return noteFailure(st, "the summary came back without its chapter tags");

        const check = checkTask({ startQuote, endQuote, gist: result.gist, chapter: result.chapter, changesText: formatFactChanges(result.ops), language: storyLanguage() });
        const verdict = parseCheck(await quiet(check, standalone ? standaloneMessages(chat, span, check) : null));
        if (lost()) return { status: "aborted", reason: "the chat changed" };
        if (verdict.verdict === "corrected") {
            // A correction that leaves its fact changes out keeps the original ones.
            const fixed = verdict.fixed;
            result = { ...fixed, ops: fixed.changesFound ? fixed.ops : result.ops, arc: fixed.arc || result.arc };
        }

        const entry = {
            start: anchorOf(chat, span.start), end: anchorOf(chat, span.end),
            from: span.start, to: span.end - 1, tokens: span.tokens,
            gist: result.gist, chapter: result.chapter, ops: result.ops, skipped: result.skipped,
            arc: fold.length ? result.arc : "", foldIds: fold.length && result.arc ? fold.map(c => c.id) : [],
            checked: verdict.verdict, created: memoryNow(),
        };
        st.summaryFailures = 0;
        if (memoryBudgetSettings().review) {
            st.pending = [...(st.pending || []), entry];
            await saveMetadata();
            return { status: "pending" };
        }
        commitChapter(st, chat, entry);
        await saveMetadata();
        return { status: "saved" };
    } catch (e) {
        console.error("[VCRP] memory summary failed", e);
        return noteFailure(st, e && e.message ? e.message : String(e));
    } finally {
        running = false;
    }
}

/**
 * Nothing new to summarize, but too many gists waiting (a migrated chat, say): fold the
 * oldest into one arc line. Reads the gists, not the chat. Saved without review.
 */
async function foldNext(st) {
    const fold = gistsToFold(st.chapters || []);
    if (!fold.length) return { status: "idle" };
    running = true;
    const identity = meguminActiveDataIdentity();
    try {
        const task = foldTask(fold.map(c => c.gist));
        // The fold reads only the gists, so it never needs the chat.
        const raw = await quiet(task, [
            { role: "system", content: "You keep the story memory for a long roleplay." },
            { role: "user", content: task },
        ]);
        if (meguminActiveDataIdentity() !== identity || memoryState() !== st) return { status: "aborted", reason: "the chat changed" };
        const m = String(raw || "").replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, "").match(/<arc>([\s\S]*?)<\/arc>/i);
        if (!m || !m[1].trim()) return noteFailure(st, "the fold came back without its arc tag");
        const ids = fold.map(c => c.id);
        st.chapters = st.chapters.map(c => ids.includes(c.id) ? { ...c, folded: true } : c);
        st.arcs = [...(st.arcs || []), { text: m[1].trim(), covers: ids }];
        st.summaryFailures = 0;
        await saveMetadata();
        return { status: "folded" };
    } catch (e) {
        return noteFailure(st, e && e.message ? e.message : String(e));
    } finally {
        running = false;
    }
}

/** Saves a chapter: facts applied, gist added, the oldest gists folded if asked, coverage moved on. */
export function commitChapter(st, chat, entry) {
    const id = `C${(st.chapterSeq || 0) + 1}`;
    st.chapterSeq = (st.chapterSeq || 0) + 1;
    const before = new Map((st.ledger || []).map(f => [f.id, f]));
    const r = applyFactChanges({ ledger: st.ledger || [], retired: st.retired || [], nextId: st.nextFactId || 1 }, entry.ops, id);
    st.ledger = r.ledger; st.retired = r.retired; st.nextFactId = r.nextId;
    // What it takes to take this chapter back out, if a rewind deletes its messages.
    const undo = {
        added: r.applied.filter(o => o.op === "+").map(o => o.id),
        reworded: r.applied.filter(o => o.op === "~").map(o => ({ ...before.get(o.id) })),
        retired: r.applied.filter(o => o.op === "-").map(o => ({ ...before.get(o.id) })),
    };
    st.chapters = [...(st.chapters || []), {
        id, gist: entry.gist, chapter: entry.chapter, start: entry.start, end: entry.end,
        from: entry.from, to: entry.to, checked: entry.checked, created: entry.created, undo,
    }];
    // A fold asked for while this chapter waited for review may have been done since.
    const foldIds = entry.foldIds || [];
    if (entry.arc && foldIds.length && !st.chapters.some(c => foldIds.includes(c.id) && c.folded)) {
        st.chapters = st.chapters.map(c => foldIds.includes(c.id) ? { ...c, folded: true } : c);
        st.arcs = [...(st.arcs || []), { text: entry.arc, covers: foldIds }];
    }
    st.summarized = entry.end;
    return r;
}

/** Review: save the oldest waiting chapter, with the reader's edits if any. */
export function approvePending(st, chat, edits = {}) {
    const entry = (st.pending || [])[0];
    if (!entry) return null;
    const edited = { ...entry };
    if (typeof edits.gist === "string") edited.gist = edits.gist.trim();
    if (typeof edits.chapter === "string") edited.chapter = edits.chapter.trim();
    if (typeof edits.changes === "string") edited.ops = parseFactChanges(edits.changes).ops;
    st.pending = st.pending.slice(1);
    return commitChapter(st, chat, edited);
}

/** Review: throw away a waiting chapter and everything queued after it (they follow on from it). */
export function discardPending(st, index = 0) {
    st.pending = (st.pending || []).slice(0, index);
}

/**
 * Works through the backlog in standalone calls, one chapter at a time, until nothing is
 * left to summarize, something fails, or `max` chapters are written.
 * @returns {Promise<{done:number, last:object|null}>}
 */
export async function catchUp({ max = Infinity, onChapter = () => {} } = {}) {
    let done = 0, last = null;
    while (done < max) {
        last = await summarizeNext({ catchUp: true });
        if (last.status !== "saved" && last.status !== "pending") break;
        done++;
        onChapter(done);
    }
    return { done, last };
}

/** Rough cost and time of catching up `tokens` of chat in standalone calls. */
export function catchUpEstimate(tokens, budget) {
    const chapters = Math.ceil(tokens / MAX_SPAN);
    // The summary call writes the stretch and its instruction to cache; the check call reads
    // the stretch back and writes only its own instruction. Plus the two answers.
    const perChapter = ((MAX_SPAN + 2500) * budget.write + MAX_SPAN * budget.price.read + 2500 * budget.write + 2000 * budget.price.output) / 1e6;
    return { chapters, cost: chapters * perChapter, minutes: Math.max(1, Math.round(chapters * 2 * 20 / 60)) };
}

/** True when automatic summaries are holding off, and why. */
export function autoSummaryHold(st) {
    if (!st) return null;
    if ((st.summaryFailures || 0) >= MAX_FAILURES) return "paused after failed summaries";
    if ((st.pending || []).length >= MAX_WAITING) return "waiting for review";
    return null;
}

/**
 * After a reply: summarize if due. Called from MESSAGE_RECEIVED; never blocks the reply
 * itself. Waits for SillyTavern and VCRP's other background tasks (Story Director, NPC
 * scans) to finish first: they swap in their own prompt while they run.
 */
export function vcrpMemoryAfterReply() {
    if (!vcrpMemoryEnabled()) return;
    const identity = meguminActiveDataIdentity();
    let waited = 0;
    const attempt = async () => {
        if (meguminActiveDataIdentity() !== identity || !vcrpMemoryEnabled()) return;
        const busy = running || otherTaskRunning() || (typeof isGenerating === "function" && isGenerating());
        if (busy) {
            if ((waited += 2000) <= 90000) setTimeout(attempt, 2000);
            return;
        }
        const st = memoryState();
        if (autoSummaryHold(st)) return;
        const r = await summarizeNext();
        if (typeof toastr === "undefined") return;
        if (r.status === "pending") toastr.info("A new chapter is ready for review in the Memory tab.", "VCRP Memory");
        else if (r.status === "failed") {
            toastr.warning(r.paused
                ? `Summary failed again (${r.reason}). Automatic summaries are paused; use Summarize now in the Memory tab to retry.`
                : `Summary failed: ${r.reason}. It will be retried after the next reply.`, "VCRP Memory");
        }
    };
    // Let SillyTavern finish saving and rendering the reply first.
    setTimeout(attempt, 2000);
}
