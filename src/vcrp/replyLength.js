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

import { memoryBudgetSettings } from "./memory/index.js";
import { vcrpGenerationKind } from "./generation.js";

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
