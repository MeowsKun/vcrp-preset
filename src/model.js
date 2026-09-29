// Works out which model is active and whether it accepts an assistant prefill.
// Mirrors SillyTavern's own no-prefill lists (src/prompt-converters.js, chat-completions.js).

const ctx = () => SillyTavern.getContext();

const MODEL_FIELD = {
    claude: "claude_model",
    openai: "openai_model",
    makersuite: "google_model",
    vertexai: "vertexai_model",
    openrouter: "openrouter_model",
    custom: "custom_model",
    zai: "zai_model",
    deepseek: "deepseek_model",
    nanogpt: "nanogpt_model",
    electronhub: "electronhub_model",
    chutes: "chutes_model",
};

// Claude Opus/Sonnet 4.6 and later, Claude 5 and Fable reject prefill. Separators may be "-" or "." (OpenRouter).
const CLAUDE_NO_PREFILL = /claude[-.](?:opus|sonnet)[-.]4[-.][6-9]|claude[-.](?:opus|sonnet|haiku)[-.][5-9]|claude[-.][5-9]|fable/;
// Newest Gemini Flash models reject a trailing model turn.
const GEMINI_NO_PREFILL = /gemini-3\.[5-9]-flash/;

export function getActiveModel() {
    const s = ctx().chatCompletionSettings || {};
    const source = s.chat_completion_source || "";
    const model = String(s[MODEL_FIELD[source]] || "").toLowerCase();
    return { source, model };
}

/** @returns {{family: "claude"|"gemini"|"glm"|"other", prefill: boolean, reason: string}} */
export function detectModel() {
    const { source, model } = getActiveModel();
    const id = `${source} ${model}`;
    if (/claude|anthropic|fable/.test(id)) {
        const no = CLAUDE_NO_PREFILL.test(model);
        return { family: "claude", prefill: !no, reason: no ? "this Claude model rejects prefill" : "Claude accepts prefill" };
    }
    if (/gemini|makersuite|vertexai/.test(id)) {
        const no = GEMINI_NO_PREFILL.test(model);
        return { family: "gemini", prefill: !no, reason: no ? "this Gemini model rejects prefill" : "Gemini accepts prefill" };
    }
    if (/glm|zai|zhipu/.test(id)) {
        return { family: "glm", prefill: false, reason: "GLM follows the instruction without a prefill" };
    }
    return { family: "other", prefill: false, reason: "unknown model, instruction only" };
}

export function shouldPrefill(profile) {
    if (profile.prefillMode === "on") return true;
    if (profile.prefillMode === "off") return false;
    return detectModel().prefill;
}
