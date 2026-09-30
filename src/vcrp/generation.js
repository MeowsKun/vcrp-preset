// ─────────────────────────────────────────────────────────────────────────────
// VCRP: generation type and model-aware CoT prefill.
//
// 1. Continue / Impersonate / quiet generations must not get the reply format:
//    no fresh <think>, no <Blocks>, no dice lines, no image rules, no prefill.
//    SillyTavern announces the type in GENERATION_STARTED before it builds the prompt.
// 2. The preset's CoT Prefill slot is kept only for models that accept an assistant
//    prefill. Newer Claude (Opus/Sonnet 4.6+, Claude 5, Fable) and the newest Gemini
//    Flash reject it; the lists mirror SillyTavern's own (prompt-converters.js,
//    chat-completions.js). Setting: Global Settings -> "CoT Prefill".
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext } from "../st.js";
import { extensionName } from "../core/constants.js";

// ── Generation type ──────────────────────────────────────────────────────────

let currentGen = "reply";

/** GENERATION_STARTED handler: (type, params, dryRun). Dry runs never change the next real request. */
export function vcrpSetGenerationType(type, _params, dryRun) {
    if (dryRun) return;
    currentGen = ["continue", "impersonate", "quiet"].includes(type) ? type : "reply";
}

// Tags that only make sense in a normal story reply.
const REPLY_ONLY_TAGS = ["[[THINK]]", "[[COT]]", "[[prefill]]", "[[blocks]]", "[[storytracker]]"];

const NOTES = {
    continue: "[Continue your previous reply exactly where it stopped, mid-sentence if needed. Do not start over, do not repeat anything already written, and do not open a new <think> block. If it stopped inside the <Blocks> section, finish that; otherwise add nothing after the prose.]",
    impersonate: "[For this one message only, the reader asks you to write {{user}}'s next turn: their words and actions, in the voice and style the reader has used for {{user}} so far. The rule against writing for {{user}} is suspended for this message alone. No <think> block, no <Blocks> section, and no narration of how other characters react.]",
};

// ── Model detection ──────────────────────────────────────────────────────────

const MODEL_FIELD = {
    claude: "claude_model", openai: "openai_model", makersuite: "google_model", vertexai: "vertexai_model",
    openrouter: "openrouter_model", custom: "custom_model", zai: "zai_model", deepseek: "deepseek_model",
    nanogpt: "nanogpt_model", electronhub: "electronhub_model", chutes: "chutes_model",
};
const CLAUDE_NO_PREFILL = /claude[-.](?:opus|sonnet)[-.]4[-.][6-9]|claude[-.](?:opus|sonnet|haiku)[-.][5-9]|claude[-.][5-9]|fable/;
const GEMINI_NO_PREFILL = /gemini-3\.[5-9]-flash/;

export function vcrpActiveModel() {
    const s = getContext().chatCompletionSettings || {};
    const source = s.chat_completion_source || "";
    return { source, model: String(s[MODEL_FIELD[source]] || "").toLowerCase() };
}

/** @returns {{prefill: boolean, reason: string}} what "Auto" would do for the connected model */
export function vcrpDetectPrefill() {
    const { source, model } = vcrpActiveModel();
    const id = `${source} ${model}`;
    if (/claude|anthropic|fable/.test(id)) {
        const no = CLAUDE_NO_PREFILL.test(model);
        return { prefill: !no, reason: no ? "this Claude model rejects prefill" : "Claude accepts prefill" };
    }
    if (/gemini|makersuite|vertexai/.test(id)) {
        const no = GEMINI_NO_PREFILL.test(model);
        return { prefill: !no, reason: no ? "this Gemini model rejects prefill" : "Gemini accepts prefill" };
    }
    if (/glm|zai|zhipu/.test(id)) return { prefill: false, reason: "GLM follows the instruction without a prefill" };
    return { prefill: false, reason: "unknown model, instruction only" };
}

export function vcrpPrefillMode() {
    return extension_settings[extensionName]?.globalSettings?.cotPrefillMode || "auto";
}

export function vcrpShouldPrefill() {
    const mode = vcrpPrefillMode();
    if (mode === "on") return true;
    if (mode === "off") return false;
    return vcrpDetectPrefill().prefill;
}

// ── Hooks called from engine/injection.js ────────────────────────────────────

/** Adjusts the tag table for this generation. Dry runs (token counts) always show the normal reply. */
export function vcrpApplyGenerationToDict(dict, dryRun) {
    const gen = dryRun ? "reply" : currentGen;
    if (gen !== "reply") REPLY_ONLY_TAGS.forEach(t => { if (t in dict) dict[t] = ""; });
    else if (!vcrpShouldPrefill()) dict["[[prefill]]"] = "";
    return gen;
}

/** Drops messages left empty by blank tags (an empty prefill would be rejected) and adds the mode note. */
export function vcrpFinalizeMessages(messages, gen, substitute = s => s) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (typeof m.content === "string" && !m.content.trim()) messages.splice(i, 1);
    }
    if (!NOTES[gen]) return;
    const note = { role: "system", content: substitute(NOTES[gen]) };
    // A trailing assistant message is the text the model continues from (Continue with
    // "Continue prefill" on, or an impersonation prefill). The note must go before it, or
    // the model would start a fresh turn instead of continuing.
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") messages.splice(messages.length - 1, 0, note);
    else messages.push(note);
}
