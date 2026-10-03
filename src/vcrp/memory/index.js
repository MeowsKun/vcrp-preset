// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: the budgeted window, wired into SillyTavern.
//
// Replaces the Memory Core. The window (window.js) decides which messages the prompt
// carries under a dollar budget (budget.js); summaries (summarize.js, ledger.js) cover
// what it leaves out. A cut only ever hides messages already covered by saved chapters.
// Off unless the profile turns it on (localProfile.vcrpMemory.enabled).
//
// Per-chat state lives in chat_metadata and is saved with the chat:
//   cut / summarized    anchors (see anchorOf) for the first carried message and for how
//                       far saved chapters reach
//   lastRequestAt       when the last roleplay prompt went out: tells a warm cache from a
//                       cold one. Stamped only for the roleplay prompt, never for tasks that
//                       swap in their own prompt (they leave the roleplay cache alone).
//   fixedTokens         everything in the prompt that is not history, measured last time
//   chapters, arcs, ledger, retired, pending     the memory itself (ledger.js)
//   shown               the memory text the prompt carries. Changed only at a cut: it sits
//                       in the cached part of the prompt, so changing it costs a full miss.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext, chat_metadata, saveMetadata } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { localProfile } from "../../core/state.js";
import { meguminCleanChatHistoryText } from "../../engine/chatText.js";
import { vcrpActiveModel, vcrpIsDryRun, vcrpRouteHoistsSystem } from "../generation.js";
import { priceForModel, computeBudget, BUDGET_DEFAULTS } from "./budget.js";
import { planWindow } from "./window.js";
import { composeMemory } from "./ledger.js";
import { keywordsOf, pickRecall, formatRecall } from "./recall.js";
import { TASK_MARKER } from "./prompts.js";
import { markCache } from "./cache.js";
import { registerRefreshHook, REFRESH } from "../../core/refreshHooks.js";

const META_KEY = "vcrp_memory";
const CHARS_PER_TOKEN = 3.5;      // Claude's current tokenizer on English prose, roughly
const FIXED_GUESS = 12000;        // the non-history part of the prompt before it is first measured

let clock = () => Date.now();
/** Tests and the cost simulator run on their own clock. */
export function setMemoryClock(fn) { clock = typeof fn === "function" ? fn : () => Date.now(); }
/** The time as Story Memory sees it. */
export const memoryNow = () => clock();

let lastVisibleChars = -1;        // history text carried by the request being built (-1: not measured)
let taskActive = false;           // a summary or check call is being built
let taskStandalone = null;        // ...and, for a standalone call, the messages that replace the prompt
let stampedOver = null;           // lastRequestAt before the request being built stamped it

export function vcrpMemoryEnabled() {
    return !!(localProfile && localProfile.vcrpMemory && localProfile.vcrpMemory.enabled);
}

export function memoryBudgetSettings() {
    const g = (extension_settings[extensionName] && extension_settings[extensionName].globalSettings) || {};
    return { ...BUDGET_DEFAULTS, ...(g.memoryBudget || {}) };
}

/** The budget for the connected model, or null when its price is unknown (set a custom one). */
export function currentMemoryBudget() {
    const s = memoryBudgetSettings();
    return computeBudget(priceForModel(vcrpActiveModel().model, s.customPrice), s);
}

/** This chat's state, created on first use. */
export function memoryState() {
    if (!chat_metadata) return null;
    let st = chat_metadata[META_KEY];
    if (!st || typeof st !== "object") {
        st = chat_metadata[META_KEY] = {
            version: 1, cut: null, summarized: null, lastRequestAt: 0, fixedTokens: 0, shown: "", lastPlan: null,
            chapters: [], arcs: [], ledger: [], retired: [], pending: [], nextFactId: 1, chapterSeq: 0,
        };
    }
    return st;
}

export const estimateTokens = text => Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
const carriedText = m => meguminCleanChatHistoryText(m && m.mes);

// ── Anchors ──────────────────────────────────────────────────────────────────
// An index alone goes stale when messages are deleted or a chat is rewound, so each
// position also stores a fingerprint of the message it points at.
const fingerprint = m => `${m && m.is_user ? "u" : "a"}|${(m && m.send_date) || ""}|${String((m && m.mes) || "").slice(0, 40)}`;

export function anchorOf(chat, index) {
    if (index <= 0 || index >= chat.length) return index <= 0 ? null : { index: chat.length, fp: "" };
    return { index, fp: fingerprint(chat[index]) };
}

/**
 * The anchor's current index: where its message is now, nearest the stored index. -1 if it
 * is gone. An exact match first; failing that, the same speaker and send time, so editing an
 * old message (which changes its text) does not lose the place.
 */
export function resolveAnchor(chat, anchor) {
    if (!anchor) return 0;
    if (!anchor.fp) return Math.min(anchor.index, chat.length);
    if (chat[anchor.index] && fingerprint(chat[anchor.index]) === anchor.fp) return anchor.index;
    const nearest = match => {
        let best = -1;
        for (let i = 0; i < chat.length; i++) {
            if (match(chat[i]) && (best < 0 || Math.abs(i - anchor.index) < Math.abs(best - anchor.index))) best = i;
        }
        return best;
    };
    const exact = nearest(m => fingerprint(m) === anchor.fp);
    if (exact >= 0) return exact;
    const [who, when] = anchor.fp.split("|");
    if (!when) return -1;
    return nearest(m => fingerprint(m).startsWith(`${who}|${when}|`));
}

/**
 * After messages were deleted (a rewind): take out chapters whose messages are gone, newest
 * first, undoing their fact changes; drop reviews waiting on deleted messages; and pull the
 * coverage and the cut back to what still exists. Returns true when anything changed.
 */
export function repairMemory(chat, st) {
    if (!st) return false;
    let changed = false;
    const gone = a => a && a.fp && resolveAnchor(chat, a) < 0;
    const keepPending = (st.pending || []).filter(e => !gone(e.start) && !gone(e.end));
    if (keepPending.length !== (st.pending || []).length) { st.pending = keepPending; changed = true; }
    const chapters = [...(st.chapters || [])];
    while (chapters.length && (gone(chapters.at(-1).start) || gone(chapters.at(-1).end))) {
        const c = chapters.pop();
        const u = c.undo || {};
        let ledger = (st.ledger || []).filter(f => !(u.added || []).includes(f.id));
        for (const old of u.reworded || []) ledger = ledger.map(f => f.id === old.id ? old : f);
        for (const back of u.retired || []) {
            const fact = { ...back };
            delete fact.retiredIn;
            delete fact.reason;
            if (!ledger.some(f => f.id === fact.id)) ledger.push(fact);
        }
        st.ledger = ledger;
        st.retired = (st.retired || []).filter(f => !(u.retired || []).some(r => r.id === f.id));
        // An arc that folded this chapter no longer stands; its other chapters unfold.
        const broken = (st.arcs || []).filter(a => (a.covers || []).includes(c.id));
        if (broken.length) {
            const freed = new Set(broken.flatMap(a => a.covers));
            st.arcs = st.arcs.filter(a => !broken.includes(a));
            for (const k of chapters) if (freed.has(k.id)) k.folded = false;
        }
        changed = true;
    }
    if (changed) {
        st.chapters = chapters;
        st.summarized = chapters.length ? chapters.at(-1).end : null;
    }
    const covered = Math.max(0, resolveAnchor(chat, st.summarized));
    let cutAt = resolveAnchor(chat, st.cut);
    // A cut whose message was deleted stays near where it was, rather than putting the
    // whole chat back into a prompt the budget was keeping small.
    if (cutAt < 0) cutAt = Math.min(st.cut.index, covered);
    if (cutAt > covered) cutAt = covered;
    while (cutAt > 0 && chat[cutAt] && !chat[cutAt].is_user) cutAt--;
    if (cutAt !== resolveAnchor(chat, st.cut)) { st.cut = anchorOf(chat, cutAt); changed = true; }
    if (changed) refreshShownMemory(st, chat, Math.max(0, resolveAnchor(chat, st.cut)));
    return changed;
}

// ── The interceptor ──────────────────────────────────────────────────────────

/**
 * Whether the memory text can reach the prompt at all: a Chat Completion connection (the
 * prompt hook only runs there) and an active preset with an enabled slot carrying
 * [[long-Memory]]. Without both, hiding old messages would drop them with nothing in their
 * place, so the interceptor leaves the chat alone.
 */
export function memoryCanReachPrompt() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || (context.mainApi && context.mainApi !== "openai")) return false;
    const cc = context.chatCompletionSettings || {};
    const prompts = Array.isArray(cc.prompts) ? cc.prompts : [];
    const carrier = prompts.filter(p => p && typeof p.content === "string" && p.content.includes("[[long-Memory]]"));
    if (!carrier.length) return false;
    const order = Array.isArray(cc.prompt_order) ? (cc.prompt_order.find(o => o && o.character_id === 100001) || cc.prompt_order[0]) : null;
    if (!order || !Array.isArray(order.order)) return true;
    return carrier.some(p => order.order.some(o => o.identifier === p.identifier && o.enabled));
}

/**
 * Called from the generate interceptor with SillyTavern's chat (system messages already
 * filtered out). Hides everything before the cut. Real requests may move the cut; dry runs
 * and quiet requests only read it, so a summary call reuses the prompt the reply just used.
 */
export async function vcrpMemoryIntercept(chat, type) {
    const st = memoryState();
    const budget = currentMemoryBudget();
    if (!st || !budget || !Array.isArray(chat)) return;
    if (!memoryCanReachPrompt()) {
        st.lastPlan = { at: clock(), cold: false, cut: false, behind: false, limit: null, reason: "the active preset can't carry the memory text, so nothing is cut", promptTokens: 0 };
        return;
    }

    // A position whose message is gone means a rewind: repair before planning.
    if (resolveAnchor(chat, st.cut) < 0 || resolveAnchor(chat, st.summarized) < 0) repairMemory(chat, st);
    let cutAt = Math.max(0, resolveAnchor(chat, st.cut));
    const summarizedTo = resolveAnchor(chat, st.summarized);

    if (!vcrpIsDryRun() && type !== "quiet") {
        const now = clock();
        const msgs = chat.map(m => ({ tokens: estimateTokens(carriedText(m)), isUser: !!m.is_user }));
        const plan = planWindow({
            msgs, fixedTokens: st.fixedTokens || FIXED_GUESS,
            state: { cutAt, summarizedTo: Math.max(0, summarizedTo), lastRequestAt: st.lastRequestAt },
            now, budget,
        });
        if (plan.cut) {
            cutAt = plan.cutAt;
            st.cut = anchorOf(chat, cutAt);
            refreshShownMemory(st, chat, cutAt);
            delete st.qaPrevCut;   // a real cut since "Cut now": there is nothing left to undo
        }
        st.lastPlan = { at: now, cold: plan.cold, cut: plan.cut, behind: plan.behind, limit: plan.limit, reason: plan.reason, promptTokens: plan.promptTokens };
    }

    const context = typeof getContext === "function" ? getContext() : null;
    const IGNORE = context && context.symbols && context.symbols.ignore;
    let visible = 0;
    for (let i = 0; i < chat.length; i++) {
        if (i < cutAt) {
            if (!IGNORE) continue;
            chat[i] = { ...chat[i], extra: { ...(chat[i].extra || {}), [IGNORE]: true }, mes: "" };
        } else {
            visible += carriedText(chat[i]).length;
        }
    }
    lastVisibleChars = visible;
}

/**
 * After the roleplay prompt is built. Tasks that swap in their own prompt never get here,
 * which is what makes this the place to stamp the cache clock.
 */
export function vcrpMemoryAfterPrompt(messages, dryRun) {
    stampedOver = null;   // only this prompt's own stamp may ever be taken back
    if (dryRun || !vcrpMemoryEnabled()) return;
    const st = memoryState();
    if (!st || !Array.isArray(messages)) return;
    if (taskStandalone) return;   // a standalone summary call never touches the roleplay cache
    stampedOver = st.lastRequestAt || 0;
    st.lastRequestAt = clock();
    if (taskActive || lastVisibleChars < 0) return;   // not a fair measure of the roleplay prompt
    const total = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
    st.fixedTokens = Math.max(0, Math.round((total - lastVisibleChars) / CHARS_PER_TOKEN));
    lastVisibleChars = -1;
}

/**
 * The prompt was built but never sent (Cancel in the payload preview). It warmed no cache,
 * so the clock goes back: left stamped, the next request after a break would count as warm,
 * skip its cut, and be billed in full at the size the cut exists to prevent.
 */
export function vcrpMemoryRequestCancelled() {
    const st = memoryState();
    if (st && stampedOver !== null) st.lastRequestAt = stampedOver;
    stampedOver = null;
}

/**
 * "Mark the cache from VCRP": cache markers on the roleplay prompt for the OpenRouter route,
 * for players who can't edit SillyTavern's config.yaml. Runs last, once the text is final.
 */
export function vcrpMemoryMarkCache(messages, dryRun) {
    if (dryRun || !vcrpMemoryEnabled() || !Array.isArray(messages) || taskStandalone) return false;
    const s = memoryBudgetSettings();
    if (!s.markCache || !vcrpRouteHoistsSystem()) return false;
    markCache(messages, s.ttl);
    return true;
}

// ── Summary calls ────────────────────────────────────────────────────────────

/**
 * summarize.js turns this on while it builds a summary or check call. `standalone` (an
 * array of messages) replaces the prompt outright: a call that carries only the stretch.
 */
export function setMemoryTaskActive(on, standalone = null) {
    taskActive = !!on;
    taskStandalone = on && Array.isArray(standalone) ? standalone : null;
}
export const memoryTaskActive = () => taskActive;

/**
 * A summary call is the roleplay prompt with the instruction placed after the chat.
 * The story-turn slots (Output Rules, the closing slot) are for story replies: drop them,
 * so the instruction is the last thing read and the summary is not told how to write a
 * scene. Output Rules is an in-chat slot (depth 1), so it sits INSIDE the chat, before
 * the latest message, not next to the instruction: it is found by what it opens with,
 * wherever it is. All of it sits after the cached part.
 */
export function vcrpMemoryShapeTask(messages) {
    if (!taskActive || !Array.isArray(messages)) return;
    if (taskStandalone) {
        messages.length = 0;
        taskStandalone.forEach(m => messages.push({ ...m }));
        return;
    }
    let i = messages.findIndex(m => typeof m.content === "string" && m.content.includes(TASK_MARKER));
    if (i < 0) return;
    messages.splice(i + 1);
    // SillyTavern adds the instruction at the very end, after the preset's after-chat slots,
    // and with "squash system messages" on it can be merged into the slot message before
    // it. Keep only the instruction from that message...
    const own = messages[i];
    const at = own.content.indexOf(TASK_MARKER);
    if (at > 0) own.content = own.content.slice(at);
    // ...and drop the story-turn slots (Output Rules, </history>) wherever they sit.
    for (let j = i - 1; j >= 0; j--) if (isStoryTurnSlot(messages[j])) messages.splice(j, 1);
}

// The preset's after-chat slots, by how they open: rules for a story reply, not a summary.
const isStoryTurnSlot = m => typeof (m && m.content) === "string" && /^\s*(?:## your thinking steps|<\/history>)/.test(m.content);

// ── The memory text ──────────────────────────────────────────────────────────

const chapterBefore = (chat, cutAt) => c => { const end = resolveAnchor(chat, c.end); return end >= 0 && end <= cutAt; };

/**
 * Sets the memory text the prompt carries for a cut at `cutAt`: the chapters wholly before
 * it, and the facts within the memory cap. Facts the cap leaves out are noted for recall.
 */
export function refreshShownMemory(st, chat, cutAt) {
    const { text, hidden } = composeMemory(
        { arcs: st.arcs || [], chapters: st.chapters || [], ledger: st.ledger || [] },
        chapterBefore(chat, cutAt), memoryBudgetSettings().memoryCap,
    );
    st.shown = text;
    st.hiddenFacts = hidden;
    return text;
}

const RECENT_MESSAGES = 4;     // what "the current scene" means for recall

/**
 * What [[story_recall]] carries this request: chapters that have left the prompt and facts
 * the cap keeps out, when the last few messages touch them. Empty before the first cut.
 */
export function vcrpMemoryRecall() {
    if (taskActive) return "";   // a summary call drops the after-chat part anyway
    const st = memoryState();
    if (!st) return "";
    const chat = memoryChat();
    const recent = chat.slice(-RECENT_MESSAGES).map(m => carriedText(m)).join(" ");
    const r = recallFor(st, chat, recent);
    // Only a request that goes out may claim "recalled for the last request": SillyTavern
    // also builds dry prompts just to count tokens.
    if (!vcrpIsDryRun()) st.lastRecall = r.ids;
    return r.text;
}

/** What the recall would bring back for `recent`: {text, ids, cut}. Changes nothing. */
function recallFor(st, chat, recent) {
    const s = memoryBudgetSettings();
    const cutAt = Math.max(0, resolveAnchor(chat, st.cut));
    if (!(s.recallTokens > 0) || cutAt === 0) return { text: "", ids: [], cut: cutAt };
    const before = chapterBefore(chat, cutAt);
    const chapters = (st.chapters || []).map((c, i) => ({ c, i })).filter(x => before(x.c)).map(x => ({
        id: x.c.id, order: x.i, label: `${x.c.id}, messages ${x.c.from + 1}-${x.c.to + 1}`,
        text: x.c.chapter, tokens: estimateTokens(x.c.chapter) + 12,
    }));
    const hidden = new Set(st.hiddenFacts || []);
    const facts = (st.ledger || []).filter(f => hidden.has(f.id)).map((f, i) => ({
        id: f.id, order: 1e6 + i, text: `[${f.cat}] ${f.text}`, tokens: estimateTokens(f.text) + 4, fact: true,
    }));
    const picked = pickRecall([...chapters, ...facts], keywordsOf(recent), s.recallTokens);
    return { text: formatRecall(picked.filter(p => !p.fact), picked.filter(p => p.fact)), ids: picked.map(p => p.id), cut: cutAt };
}

// ── Testing (the Memory tab's QA tools) ──────────────────────────────────────

/**
 * What the next request would recall if `draft` were sent now: the last messages plus the
 * draft, the way the real request will see them. Changes nothing.
 */
export function previewRecall(draft = "") {
    const st = memoryState();
    if (!st) return { text: "", ids: [], cut: 0 };
    const chat = memoryChat();
    const text = String(draft || "").trim();
    const recent = [...chat.slice(-(text ? RECENT_MESSAGES - 1 : RECENT_MESSAGES)).map(m => carriedText(m)), text].join(" ");
    return recallFor(st, chat, recent);
}

/**
 * QA: cut now instead of waiting for a break. Everything the approved chapters cover leaves
 * the prompt, except the last few messages; the cut lands on a user message like every
 * cut. The previous cut is kept so it can be undone. Returns {result: "cut"|"no chapters"|
 * "already", cutAt}.
 */
export function forceCut(st, chat) {
    const from = Math.max(0, resolveAnchor(chat, st.cut));
    const covered = Math.max(0, resolveAnchor(chat, st.summarized));
    if (!covered) return { result: "no chapters", cutAt: from };
    let target = Math.min(covered, chat.length - RECENT_MESSAGES);
    while (target > 0 && !(chat[target] && chat[target].is_user)) target--;
    if (target <= from) return { result: "already", cutAt: from };
    st.qaPrevCut = st.cut || null;
    st.cut = anchorOf(chat, target);
    refreshShownMemory(st, chat, target);
    return { result: "cut", cutAt: target };
}

/** QA: put back the cut "Cut now" replaced. */
export function undoForceCut(st, chat) {
    if (!Object.prototype.hasOwnProperty.call(st, "qaPrevCut")) return false;
    st.cut = st.qaPrevCut || null;
    delete st.qaPrevCut;
    const at = Math.max(0, resolveAnchor(chat, st.cut));
    if (at > 0) refreshShownMemory(st, chat, at);
    else { st.shown = ""; st.hiddenFacts = []; }
    return true;
}

/** What [[long-Memory]] carries while this system is on. */
export function vcrpMemoryBlock() {
    const st = memoryState();
    return (st && st.shown) || "";
}

// ── SillyTavern hookup ───────────────────────────────────────────────────────

// The generate interceptor the manifest names. Off unless Story Memory is on.
globalThis.vcrp_memory_intercept = function (chat, _contextSize, _abort, type) {
    if (vcrpMemoryEnabled()) return vcrpMemoryIntercept(chat, type);
};

/** SillyTavern's chat without system messages: the list every position here counts in. */
export function memoryChat() {
    const context = typeof getContext === "function" ? getContext() : null;
    return context && Array.isArray(context.chat) ? context.chat.filter(m => !m.is_system) : [];
}

/** After a rewind or on loading a chat: repair positions and chapters against what exists. */
export function vcrpMemoryCheckChat() {
    if (!chat_metadata || !chat_metadata[META_KEY]) return false;
    return repairMemory(memoryChat(), memoryState());
}

/** MESSAGE_DELETED: repair, save if anything moved, redraw the dimming. */
export function vcrpMemoryOnMessageDeleted() {
    if (vcrpMemoryCheckChat()) saveMetadata();
    vcrpMemoryUpdateVisuals();
}

// Profile loads and rewinds ask for a redraw through the refresh hook.
registerRefreshHook(REFRESH.MEMORY_VISUALS, () => vcrpMemoryUpdateVisuals());

let dimTimer = null;
/**
 * Dims the messages before the cut in the chat window, so it shows what the prompt no
 * longer carries word for word. One <style> block, by message id.
 */
export function vcrpMemoryUpdateVisuals() {
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
        if (typeof $ !== "function") return;
        $("#vcrp-memory-cut-style").remove();
        if (!vcrpMemoryEnabled() || !chat_metadata || !chat_metadata[META_KEY]) return;
        const context = typeof getContext === "function" ? getContext() : null;
        const full = context && Array.isArray(context.chat) ? context.chat : [];
        const cutAt = Math.max(0, resolveAnchor(full.filter(m => !m.is_system), chat_metadata[META_KEY].cut));
        if (!cutAt) return;
        const ids = [];
        for (let i = 0, n = 0; i < full.length && n < cutAt; i++) {
            if (full[i].is_system) continue;
            ids.push(i); n++;
        }
        const selectors = ids.map(i => `.mes[mesid="${i}"] .mes_text`).join(",");
        $("head").append(`<style id="vcrp-memory-cut-style">${selectors}{opacity:.4;filter:saturate(.35);}</style>`);
    }, 150);
}

// ── Moving the old Memory Core's summaries over ──────────────────────────────

const firstSentence = text => {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    const end = s.search(/[.!?](\s|$)/);
    const sentence = end > 0 ? s.slice(0, end + 1) : s;
    const words = sentence.split(" ");
    return words.length > 25 ? words.slice(0, 25).join(" ") + "…" : sentence;
};

/**
 * The old Memory Core kept short-term summaries and a long-term vault per chat, each
 * covering a range of messages ("170-179", counted in SillyTavern's full chat). They become
 * chapters here, once per chat: gist from the first sentence, text as written. Coverage runs
 * as far as the summaries cover the chat without a gap. The old data stays in the chat file.
 */
export function vcrpMemoryMigrateLegacy() {
    if (!chat_metadata) return 0;
    const legacy = chat_metadata.megumin_memory_core;
    if (!legacy || (chat_metadata[META_KEY] && chat_metadata[META_KEY].legacyImported)) return 0;
    const raw = [...(legacy.shortTermChunks || []), ...(legacy.longTermVault || [])];
    if (!raw.length) return 0;
    const context = typeof getContext === "function" ? getContext() : null;
    const full = context && Array.isArray(context.chat) ? context.chat : [];
    if (!full.length) return 0;   // the chat is not loaded yet: try again on the next load
    const st = memoryState();
    st.legacyImported = true;
    if ((st.chapters || []).length) return 0;

    const story = full.filter(m => !m.is_system);
    // Full-chat index -> position among non-system messages.
    const pos = [];
    for (let i = 0, n = 0; i < full.length; i++) { pos.push(n); if (!full[i].is_system) n++; }
    const toPos = i => (i < pos.length ? pos[i] : story.length);

    const ranges = raw.map(c => {
        const [a, b] = String((c && c.id) || "").split("-").map(x => parseInt(x, 10));
        const text = String((c && (c.summary || c.text)) || "").trim();
        return Number.isFinite(a) && Number.isFinite(b) && text ? { from: toPos(a), to: Math.max(toPos(a), toPos(b + 1) - 1), text, at: c.timestamp || Date.now() } : null;
    }).filter(Boolean).filter(r => r.from < story.length).sort((x, y) => x.from - y.from);
    // The same range can sit in both tiers; keep the first.
    const unique = ranges.filter((r, i) => i === 0 || r.from > ranges[i - 1].to);
    if (!unique.length) return 0;

    let reach = -1;
    st.chapters = unique.map((r, i) => {
        if (reach < 0 ? r.from <= 2 : r.from <= reach + 1) reach = Math.max(reach, r.to);
        return {
            id: `C${i + 1}`, gist: firstSentence(r.text), chapter: r.text, from: r.from, to: r.to,
            start: anchorOf(story, r.from), end: anchorOf(story, Math.min(r.to + 1, story.length)),
            checked: "imported", created: r.at, undo: { added: [], reworded: [], retired: [] },
        };
    });
    st.chapterSeq = st.chapters.length;
    if (reach >= 0) st.summarized = anchorOf(story, Math.min(reach + 1, story.length));
    return st.chapters.length;
}
