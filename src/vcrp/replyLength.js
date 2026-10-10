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
// The cap goes on the request itself (SillyTavern's CHAT_COMPLETION_SETTINGS_READY), only
// for prompts built from the VCRP preset, and never for a background call (a summary, an
// NPC scan): those have outputs of their own size.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { localProfile } from "../core/state.js";
import { memoryBudgetSettings, estimateTokens } from "./memory/index.js";
import { vcrpGenerationKind } from "./generation.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";

let vcrpPrompt = false;   // the prompt about to go out was built from the VCRP preset

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

// ── The budget line ──────────────────────────────────────────────────────────
// A cap cuts a reply off; it does not shorten one. So with a cap set, the model is told how
// much room the reply has, and the story's share of it in words (what is left after the
// thinking and the blocks), so it plans to finish inside it rather than being stopped.

const TOKENS_PER_WORD = 1.35;   // English prose on Claude's tokenizer, a little generous
const MARGIN = 0.9;             // aim under the cap, not at it

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

/** The room a reply has, split: { cap, thinkingWords, blocks, storyWords }, or null with no cap. */
export function replyBudget() {
    const cap = replyCapTokens();
    if (!cap) return null;
    const thinking = thinkingWords();
    const blocks = blocksTokens();
    const storyTokens = cap * MARGIN - thinking.words * TOKENS_PER_WORD - blocks;
    const storyWords = Math.max(100, Math.floor(storyTokens / TOKENS_PER_WORD / 50) * 50);
    return { cap, thinkingWords: thinking.words, thinkingSet: thinking.set, blocks, storyWords };
}

/** The line for this generation kind (replies only), without leading blank lines; "" with no cap. */
export function replyBudgetText(gen = "reply") {
    if (gen !== "reply") return "";
    const b = replyBudget();
    if (!b) return "";
    const thinking = b.thinkingWords && !b.thinkingSet ? `, keep the thinking to about ${b.thinkingWords} words` : "";
    return `### Length limit\nThis whole reply, thinking and blocks included, has room for about ${b.cap.toLocaleString("en-US")} tokens and is cut off there. Keep the story to about ${b.storyWords} words${thinking}, and finish the scene and every block well before the limit. This overrides any longer length asked for above.`;
}

/**
 * CHAT_COMPLETION_SETTINGS_READY: lower the request's max_tokens to the safety cap. Never
 * raises it: SillyTavern's own Max Response Length still wins when it is lower.
 */
export function vcrpApplyReplyCap(data) {
    const ours = vcrpPrompt;
    vcrpPrompt = false;   // one prompt, one request
    if (!data || typeof data !== "object" || !ours || vcrpGenerationKind() === "quiet") return;
    const cap = replyCapTokens();
    if (!cap) return;
    // Only the limit the request already carries: an OpenAI reasoning model rejects
    // max_tokens when it takes max_completion_tokens, so adding the other one would break it.
    for (const key of ["max_tokens", "max_completion_tokens"]) {
        if (!(key in data)) continue;
        const now = Number(data[key]);
        if (!(now > 0) || now > cap) data[key] = cap;
    }
}
