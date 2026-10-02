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
let currentDry = false;

/** GENERATION_STARTED handler: (type, params, dryRun). Dry runs never change the next real request. */
export function vcrpSetGenerationType(type, _params, dryRun) {
    currentDry = !!dryRun;
    if (dryRun) return;
    currentGen = ["continue", "impersonate", "quiet"].includes(type) ? type : "reply";
}

/** True while SillyTavern is only measuring the prompt (token counts, previews); nothing is sent. */
export function vcrpIsDryRun() {
    return currentDry;
}

// Tags that only make sense in a normal story reply.
const REPLY_ONLY_TAGS = ["[[THINK]]", "[[COT]]", "[[prefill]]", "[[blocks]]", "[[storytracker]]"];

const EMPTY_VOICE = /^[ \t]*- (?:\*\*)?voice:(?:\*\*)?[ \t]*(?:\r?\n|$)/gm;

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

/**
 * True when the route hands Claude one system prompt built from every system-role message,
 * wherever it sat. OpenRouter does this for Claude (SillyTavern issue #5227): text placed
 * after the chat is read before it, and a per-turn change there invalidates the whole cache.
 */
export function vcrpRouteHoistsSystem() {
    const { source, model } = vcrpActiveModel();
    return source === "openrouter" && /claude|anthropic|fable/.test(model);
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
    // Impersonate writes AS {{user}}: the final reminder's "never write for {{user}}" would
    // contradict the request itself.
    if (gen === "impersonate" && "[[user]]" in dict) dict["[[user]]"] = "";
    return gen;
}

/** Drops messages left empty by blank tags (an empty prefill would be rejected) and adds the mode note. */
export function vcrpFinalizeMessages(messages, gen, substitute = s => s) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (typeof m.content !== "string") continue;
        // The engines carry "- voice: [[aiprompt]]"; with no writing style picked that
        // is a label with nothing after it, so drop the whole line.
        m.content = m.content.replace(EMPTY_VOICE, "");
        if (!m.content.trim()) messages.splice(i, 1);
    }
    if (NOTES[gen]) {
        const note = { role: "system", content: substitute(NOTES[gen]) };
        // A trailing assistant message is the text the model continues from (Continue with
        // "Continue prefill" on, or an impersonation prefill). The note must go before it, or
        // the model would start a fresh turn instead of continuing.
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant") messages.splice(messages.length - 1, 0, note);
        else messages.push(note);
    }
    if (vcrpRouteHoistsSystem()) vcrpKeepAfterChatInPlace(messages);
}

/**
 * Turns every system message after the opening run of system messages into a user message.
 * The opening run is the real system prompt and stays one; anything later (Output Rules,
 * the closing slots, mode notes, injections inside the chat) keeps its place as user text.
 */
export function vcrpKeepAfterChatInPlace(messages) {
    const first = messages.findIndex(m => m.role !== "system");
    if (first < 0) return;
    for (let i = first + 1; i < messages.length; i++) {
        if (messages[i].role === "system") messages[i].role = "user";
    }
}
