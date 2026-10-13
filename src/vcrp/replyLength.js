// ─────────────────────────────────────────────────────────────────────────────
// VCRP: reply length.
//
// What a reply costs is mostly its length: on Opus, a 5,000-token reply is over half the
// price of a cached request. A token cap alone does not shorten replies, it cuts them off,
// mid-sentence or (with the thinking written first) before the story starts. Length is set
// by telling the model: Story Config's Length (the story, in words) and Thinking Effort
// (VCRP's visible thinking, in words). The Memory tab gathers both, and adds a safety cap
// here, meant to sit well above a normal reply, so only a runaway one is stopped.
//
// Holding each reply to the target (Memory tab, on by default with Story Memory): the
// prompt is priced as it goes out (read from the cache, written to it, sent fresh), and what
// is left of Story Memory's per-request target becomes the reply's room in output tokens.
// The model is told that room, and it goes on the request as its limit, so input and output
// together stay within the target. During play the room is wide; right after a break, when
// the whole prompt is written to the cache again, it is about a reply and a quarter.
//
// The limits go on the request itself (SillyTavern's CHAT_COMPLETION_SETTINGS_READY), only
// for prompts built from the VCRP preset. VCRP's own background calls (a summary, an audit,
// the Story Director, an NPC scan) get a limit of their own, well above what they write, so
// none can run away; other background calls are left alone.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { localProfile } from "../core/state.js";
import {
    memoryBudgetSettings, estimateTokens, currentMemoryBudget, memoryState, memoryNow, promptSpendSplit,
    vcrpMemoryEnabled, memoryTaskActive, measuredOutputTokens,
} from "./memory/index.js";
import { requestCost } from "./memory/budget.js";
import { isCold } from "./memory/window.js";
import { vcrpGenerationKind } from "./generation.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import {
    activeStoryPlanRequest, activeBanListChat, activeNpcScanRequest, activeNpcUpdateRequest, activeGenerationOrder, activeFocusAudit,
} from "../core/activeRequests.js";

const MIN_ROOM = 1500;            // the least room a reply is given, even when its prompt alone nears the target
const BACKGROUND_OUTPUT = 8000;   // VCRP's background calls: far above what they write (a summary is ~1,500)
const NEW_TOKENS = 4500;          // a warm prompt's part written to the cache, before the prompt is known

let vcrpPrompt = false;   // the prompt about to go out was built from the VCRP preset
let nextRoom = null;      // the room worked out for the request about to go out
let lastRoom = null;      // { tokens, input, cold, held } of the latest reply request, for the Memory tab

/** Called with every prompt that goes out: was it one VCRP filled in? */
export function vcrpNotePrompt(isVcrp) {
    vcrpPrompt = !!isVcrp;
}

/** The safety cap in tokens, or 0 when off. */
export function replyCapTokens() {
    const n = Math.round(Number(memoryBudgetSettings().replyCap) || 0);
    return n > 0 ? n : 0;
}

/**
 * The hard limit a reply really has: the safety cap or SillyTavern's own Max Response Length,
 * whichever is lower (0 when neither is known).
 */
export function replyLimitTokens() {
    const cap = replyCapTokens();
    let st = 0;
    try { st = Math.round(Number(((getContext() || {}).chatCompletionSettings || {}).openai_max_tokens) || 0); } catch (e) { st = 0; }
    const limits = [cap, st].filter(n => n > 0);
    return limits.length ? Math.min(...limits) : 0;
}

// ── Holding each reply to the target ─────────────────────────────────────────

/** Replies are held to the target: switched on, Story Memory on, the model's price known. */
export function holdTargetActive() {
    return memoryBudgetSettings().holdTarget !== false && vcrpMemoryEnabled() && !!currentMemoryBudget();
}

/**
 * The output room under the target for a prompt whose input costs `input` dollars: what is
 * left of the target, in output tokens. May be below MIN_ROOM (or below 0) when the prompt
 * alone nears the target; a reply is never given less than MIN_ROOM.
 */
export function roomFor(input, budget = currentMemoryBudget()) {
    if (!budget) return 0;
    const s = memoryBudgetSettings();
    // The input is estimated by length; the same margin Story Memory sizes its cuts with.
    const left = s.targetCost - input / (s.safety || 0.92);
    return Math.floor(left / budget.price.output * 1e6);
}

/**
 * The room a reply will have, while its prompt is still being built: from Story Memory's plan
 * for this request (its size, a warm or a cold cache). Exact once the prompt is done.
 */
function plannedRoom() {
    const budget = currentMemoryBudget();
    const st = memoryState();
    const plan = st && st.lastPlan;
    if (!budget || !plan || !(plan.promptTokens > 0)) return lastRoom ? lastRoom.tokens : 0;
    const p = plan.promptTokens;
    const input = plan.cold ? requestCost(budget, { write: p }) : requestCost(budget, { read: Math.max(0, p - NEW_TOKENS), write: Math.min(p, NEW_TOKENS) });
    return Math.max(MIN_ROOM, roomFor(input, budget));
}

/** The limit the reply being built is planned to have: the safety cap, or its room under the target. */
function plannedLimit() {
    const limits = [replyCapTokens(), holdTargetActive() ? plannedRoom() : 0].filter(n => n > 0);
    return limits.length ? Math.min(...limits) : 0;
}

/** The latest reply request's room: { tokens, input, cold, held } (held: within the target), or null. */
export const lastReplyRoom = () => lastRoom;

// ── The budget line ──────────────────────────────────────────────────────────
// A limit cuts a reply off; it does not shorten one. So with a limit set, the model is told
// how much room the reply has, and the story's share of it in words (what is left after the
// thinking and the blocks), so it plans to finish inside it rather than being stopped.

const TOKENS_PER_WORD = 1.35;   // English prose on Claude's tokenizer, a little generous
const MARGIN = 0.9;             // aim under the limit, not at it
const TIGHT = 1.5;              // a room under this many typical replies is told to the model
const LINE_HEAD = "### Length limit";
const LINE_TAIL = "This overrides any longer length asked for above.";

// What the blocks of a reply take: their measured size in the chat's recent replies, or a
// typical size when none has been written yet. 0 with no blocks in the stack.
function blocksTokens() {
    let active = [];
    try { active = meguminActiveBlocks().filter(b => b && !b.transient && !b.slot); } catch (e) { active = []; }
    if (!active.length) return 0;
    let chat = [];
    try { chat = ((getContext() || {}).chat || []).filter(m => m && !m.is_user && !m.is_system && typeof m.mes === "string").slice(-10); } catch (e) { chat = []; }
    // What the model wrote: the Notes tab is left out (VCRP adds each reply's rolls to it).
    const sizes = chat.map(m => (m.mes.match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/i) || [])[0]).filter(Boolean)
        .map(b => estimateTokens(b.replace(/<Pura_Notes\b[^>]*>[\s\S]*?<\/Pura_Notes\s*>/gi, "")));
    return sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 300;
}

/** The thinking's share: its set length, about 250 words when none is set, nothing with it off. */
function thinkingWords() {
    if (!localProfile || localProfile.cotEnabled === false) return { words: 0, set: true };
    const effort = String(localProfile.thinkEffort || "unspecified");
    if (effort === "unspecified") return { words: 250, set: false };
    const n = Number(effort === "custom" ? localProfile.customThinkEffort : effort);
    return { words: n > 0 ? n : 250, set: n > 0 };
}

/** The room a reply has, split: { cap, thinkingWords, blocks, storyWords }, or null with no limit. */
export function replyBudget(limit = plannedLimit()) {
    const cap = Math.round(Number(limit) || 0);
    if (!(cap > 0)) return null;
    const thinking = thinkingWords();
    const blocks = blocksTokens();
    const storyTokens = cap * MARGIN - thinking.words * TOKENS_PER_WORD - blocks;
    const storyWords = Math.max(100, Math.floor(storyTokens / TOKENS_PER_WORD / 50) * 50);
    return { cap, thinkingWords: thinking.words, thinkingSet: thinking.set, blocks, storyWords };
}

// What a reply usually takes: the chat's measured average, or Story Memory's default guess.
const typicalReply = () => measuredOutputTokens() || Number(memoryBudgetSettings().outputTokens) || 2500;

/**
 * The model is told its room when it matters: always under the safety cap, and under the
 * target when the room is tight (right after a break). A wide room is only the request's
 * limit: told "keep the story to about 6,000 words", the model would write more, not less.
 */
const tellsRoom = limit => limit > 0 && (replyCapTokens() > 0 || limit < typicalReply() * TIGHT);

/** The line for this generation kind (replies only), without leading blank lines; "" when not told. */
export function replyBudgetText(gen = "reply", limit = plannedLimit()) {
    if (gen !== "reply" || !tellsRoom(limit)) return "";
    const b = replyBudget(limit);
    if (!b) return "";
    const thinking = b.thinkingWords && !b.thinkingSet ? `, keep the thinking to about ${b.thinkingWords} words` : "";
    return `${LINE_HEAD}\nThis whole reply, thinking and blocks included, has room for about ${b.cap.toLocaleString("en-US")} tokens and is cut off there. Keep the story to about ${b.storyWords} words${thinking}, and finish the scene and every block well before the limit. ${LINE_TAIL}`;
}

const LINE_RE = new RegExp(`${LINE_HEAD}\\n[^\\n]*?${LINE_TAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const LINE_GAP_RE = new RegExp(`(?:\\n\\n)?${LINE_RE.source}`);

/**
 * After the prompt is built (injection.js), before the cache clock is stamped: the reply's
 * room, priced from the prompt as it will go out, and the length line set to it.
 */
export function vcrpReplyRoom(messages, dryRun) {
    if (!dryRun) nextRoom = null;
    const gen = vcrpGenerationKind();
    if (gen === "quiet" || !Array.isArray(messages) || !holdTargetActive()) return;
    const budget = currentMemoryBudget();
    const st = memoryState();
    const cold = isCold({ lastRequestAt: st && st.lastRequestAt }, memoryNow(), budget);
    const { read, write, plain } = promptSpendSplit(messages, cold);
    const input = requestCost(budget, { read, write, plain });
    const room = roomFor(input, budget);
    const limit = Math.min(Math.max(MIN_ROOM, room), replyCapTokens() || Infinity);
    // The model is told the room it really has (or, when it turned out wide, nothing).
    const line = replyBudgetText(gen, limit);
    for (const m of messages) {
        if (typeof m.content !== "string" || !LINE_RE.test(m.content)) continue;
        m.content = line ? m.content.replace(LINE_RE, () => line) : m.content.replace(LINE_GAP_RE, "");
        break;
    }
    if (dryRun) return;
    nextRoom = limit;
    lastRoom = { tokens: limit, input, cold, held: limit <= room };
}

/** A background call of VCRP's own is being sent: a summary or its check, an audit, the Director, an NPC scan. */
function vcrpBackgroundCall() {
    return !!(memoryTaskActive() || activeStoryPlanRequest || activeBanListChat || activeNpcScanRequest
        || activeNpcUpdateRequest || activeGenerationOrder || activeFocusAudit);
}

/** Lowers the request's own output limit to `limit` (never raises it). */
function lowerLimit(data, limit) {
    // Only the limit the request already carries: an OpenAI reasoning model rejects
    // max_tokens when it takes max_completion_tokens, so adding the other one would break it.
    for (const key of ["max_tokens", "max_completion_tokens"]) {
        if (!(key in data)) continue;
        const now = Number(data[key]);
        if (!(now > 0) || now > limit) data[key] = limit;
    }
}

/**
 * CHAT_COMPLETION_SETTINGS_READY: lower the request's max_tokens to the reply's limit (the
 * safety cap, or its room under the target), or a background call's to its own. Never raises
 * it: SillyTavern's own Max Response Length still wins when it is lower.
 */
export function vcrpApplyReplyCap(data) {
    const ours = vcrpPrompt;
    vcrpPrompt = false;   // one prompt, one request
    const room = nextRoom;
    nextRoom = null;
    if (!data || typeof data !== "object") return;
    if (vcrpGenerationKind() === "quiet") {
        if (vcrpBackgroundCall()) lowerLimit(data, BACKGROUND_OUTPUT);
        return;
    }
    const limits = ours ? [replyCapTokens(), room || 0].filter(n => n > 0) : [];
    if (limits.length) lowerLimit(data, Math.min(...limits));
    // The limit this reply really went out with, whichever preset built it: what a reply that
    // stops mid-sentence is measured against (replyCut.js).
    sentLimit = Number(data.max_tokens ?? data.max_completion_tokens) || 0;
}

let sentLimit = 0;
/** The output limit the latest reply request went out with (0 when SillyTavern did not say). */
export function sentReplyLimit() {
    return sentLimit;
}

export { BACKGROUND_OUTPUT, MIN_ROOM };
