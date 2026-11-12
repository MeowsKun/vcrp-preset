// ─────────────────────────────────────────────────────────────────────────────
// VCRP: setup health check.
//
// The two most common reasons VCRP "does nothing" are a non-VCRP preset being
// active and the preset's regex scripts not being allowed/enabled. This checks
// both (plus the API type and the prefill slot), shows the result as a card in
// Global Settings, and puts a red dot on the VCRP button while a problem stands.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext, event_types } from "../st.js";
import { extensionName } from "../core/constants.js";
import { vcrpDetectPrefill, vcrpActiveModel, vcrpShouldPrefill, vcrpPrefillMode, vcrpRouteHoistsSystem, vcrpRouteMarksCache, vcrpModelReasonsHidden } from "./generation.js";
import { vcrpGenerationRecords } from "./generationTrace.js";
import { helperSettings, helperJobWanted, HELPER_JOBS, CURRENT_CONNECTION } from "./helper/settings.js";
import { blankKindOf, spell, apiWords, QUIET_MS } from "./blankReply.js";
import { connectionProfiles, isChatProfile, canSendToProfile } from "./helper/index.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { vcrpMemoryEnabled, currentMemoryBudget, memoryBudgetSettings, memoryState, estimateTokens, memoryCanReachPrompt } from "./memory/index.js";
import { autoSummaryHold } from "./memory/summarize.js";
import { meguminOriginalActive } from "../engine/meguminOriginal.js";
import { kbAlwaysOnStats, presetCarriesAlwaysSlot } from "./knowledgebase.js";
import { vcrpCacheCheckReport, vcrpCacheCheckSummary } from "./cacheCheck.js";
import { replyCapTokens, ceilingActive, ceilingCost, reasoningAllowance } from "./replyLength.js";
import { focusSettings, peekFocusState } from "./focus/index.js";
import { isPuraEngine, isV11Engine } from "../core/engines.js";
import { notebookOn } from "./notebook/index.js";
import { vcrpOn } from "./power.js";
import { activeEngine } from "../engine/meguminOriginal.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import { toneRulesText } from "./toneRules.js";
import { oneShot } from "./oneShot.js";
import { castLockOn } from "./castLock.js";
import { localProfile } from "../core/state.js";
import { usesCaretWords } from "../engine/caretWords.js";

// A preset is VCRP's if it carries the tags only VCRP/Megumin presets use (the name can be anything).
const VCRP_TAG_RE = /\[\[(?:blocks|THINK|prompt1)\]\]/;
// Prompt-side cleanup: without these, old thinking and old blocks pile up in the context.
const ESSENTIAL_REGEX = ["Blocks cleanup", "Blocks display marker", "Thinking cleanup A", "Thinking cleanup B"];
// Display-side: at least one of these should be on, or the thinking shows as raw text.
const THINK_DISPLAY_REGEX = ["Thinking Box", "Thinking Hide A", "Thinking Hide B"];

/**
 * @returns {{items: {level: "ok"|"info"|"warn"|"error", title: string, detail: string}[], errors: number, warnings: number}}
 */
export function vcrpHealthCheck() {
    const items = [];
    const add = (level, title, detail = "") => items.push({ level, title, detail });
    let ctx;
    try { ctx = getContext(); } catch { ctx = {}; }
    const cc = ctx.chatCompletionSettings || {};

    // VCRP's master switch (power.js): off, it adds nothing and runs nothing after a reply.
    if (!vcrpOn()) {
        add("warn", "VCRP is switched off", "Nothing is added to the prompt, and nothing runs after a reply. Turn it back on with the On/Off button at the top of the VCRP window.");
    }

    // 1. API type.
    if (ctx.mainApi && ctx.mainApi !== "openai") {
        add("error", "Not using a Chat Completion API",
            "VCRP only works with Chat Completion (API Connections → API: Chat Completion). Text Completion ignores the preset.");
        return summarize(items);
    }
    add("ok", "Chat Completion API selected");

    // 2. Active preset.
    const presetName = cc.preset_settings_openai || "(unknown)";
    const isVcrp = (cc.prompts || []).some(p => VCRP_TAG_RE.test((p && p.content) || ""));
    if (!isVcrp) {
        add("error", `The active preset "${presetName}" is not a VCRP preset`,
            "Select \"VCRP V10 Universal\" (or \"VCRP V10 Megumin Original\", or \"VCRP V11 Megumin Original\") in AI Response Configuration. Import it from the extension's Presets folder if it is not listed.");
        return summarize(items);
    }
    add("ok", `VCRP preset active: "${presetName}"`);

    // 3. The preset's regex scripts.
    const scripts = (cc.extensions && Array.isArray(cc.extensions.regex_scripts)) ? cc.extensions.regex_scripts : [];
    if (!scripts.length) {
        add("error", "The preset has no regex scripts",
            "They ship inside the preset file. Re-import the VCRP preset from the extension's Presets folder.");
    } else {
        const allowed = !!extension_settings?.preset_allowed_regex?.openai?.includes(presetName);
        if (!allowed) {
            add("error", "The preset's regex scripts are not allowed",
                "SillyTavern only runs a preset's bundled regex after you allow them: Extensions → Regex → Preset scripts → allow for this preset. Without them, old thinking and blocks pile up in the context and the Blocks card does not draw.");
        } else {
            add("ok", "Preset regex scripts allowed");
        }
        const byName = new Map(scripts.map(s => [String(s.scriptName || "").trim(), s]));
        const off = ESSENTIAL_REGEX.filter(n => byName.has(n) && byName.get(n).disabled);
        const missing = ESSENTIAL_REGEX.filter(n => !byName.has(n));
        if (off.length) add("error", `Essential regex switched off: ${off.join(", ")}`, "Turn them back on in Extensions → Regex.");
        if (missing.length) add("warn", `Regex not found: ${missing.join(", ")}`, "They may have been renamed or deleted. Re-importing the preset restores them.");
        if (!off.length && !missing.length && allowed) add("ok", "Essential regex scripts are on");
        const displayOn = THINK_DISPLAY_REGEX.some(n => byName.has(n) && !byName.get(n).disabled);
        if (!displayOn) add("warn", "No thinking-display regex is on", "Turn on \"Thinking Box\" (or one of the Thinking Hide scripts), or the thinking shows as raw text in chat.");
    }

    // 4. Prefill slot + model.
    const order = Array.isArray(cc.prompt_order) ? (cc.prompt_order.find(o => o && o.character_id === 100001) || cc.prompt_order[0]) : null;
    const slot = order && Array.isArray(order.order) ? order.order.find(o => o.identifier === "enhanceDefinitions") : null;
    const { source, model } = vcrpActiveModel();
    const det = vcrpDetectPrefill();
    const mode = vcrpPrefillMode();
    const modelLabel = `${source || "unknown source"}${model ? ` · ${model}` : ""}`;
    if (slot && !slot.enabled && vcrpShouldPrefill()) {
        add("warn", "The CoT prefill slot is off in the preset",
            `VCRP would prefill for ${modelLabel}, but the preset's "CoT Prefill" slot is disabled. Turn it on in the preset's prompt list, or set CoT Prefill to "Always off" below.`);
    }
    add("info", `Model: ${modelLabel}`,
        mode === "auto" ? `CoT prefill: Auto → ${det.prefill ? "prefilling" : "not prefilling"} (${det.reason}).` : `CoT prefill: ${mode === "on" ? "Always on" : "Always off"}.`);
    // "Always on" for a model that refuses a prefill: the request ends on the model's own turn,
    // which such a model answers with an error or with nothing.
    if (mode === "on" && /rejects/.test(det.reason) && (!slot || slot.enabled)) {
        add("warn", "CoT Prefill is set to Always on, and this model refuses a prefill",
            `${modelLabel}: ${det.reason}. With the prefill forced on, every story request ends on the model's own turn, and a model that refuses that fails the request or sends back nothing. Set CoT Prefill to Auto (below): Auto leaves it out for the models that refuse it.`);
    }
    // The same for the background jobs' own prefill (Global Settings → Utility Prefills).
    const gsNow = (extension_settings[extensionName] && extension_settings[extensionName].globalSettings) || {};
    if (gsNow.enableUtilityPrefill === true && /rejects/.test(det.reason)) {
        add("warn", "Utility Prefills are on, and this model refuses a prefill",
            `${modelLabel}: ${det.reason}. With Utility Prefills on, the Story Director, NPC scans and updates, the ban list scan and Focus audits end on the model's own turn, and a model that refuses that fails them or sends back nothing. Turn Utility Prefills off (below).`);
    }
    // SillyTavern's own Max Response Length on a model that reasons out of sight: that
    // reasoning is paid for in it, so a low one is used up before the reply.
    const stLimit = Math.round(Number(cc.openai_max_tokens) || 0);
    if (stLimit > 0 && stLimit < 8000 && vcrpModelReasonsHidden()) {
        add("warn", `Max Response Length (${stLimit.toLocaleString()} tokens) is low for a model that reasons before it writes`,
            "The model's reasoning is paid for in the request's output limit without being part of the reply. With a limit this low, a hard turn's reasoning can use it up, and the reply comes back cut off or with nothing in it. Set Max Response Length in AI Response Configuration to 8,000 or more (the VCRP presets set 20,000).");
    }
    // A Safety cap on a model that reasons before it writes: the cap is on the reply the reader
    // sees, so the request's limit is the cap plus room for the reasoning (replyLength.js).
    const cap = replyCapTokens();
    const reasons = vcrpModelReasonsHidden();
    if (cap && reasons) {
        const room = reasoningAllowance();
        add("info", `Safety cap (${cap.toLocaleString()} tokens): the request allows ${(cap + room).toLocaleString()}, with room for the model's reasoning`,
            `Gemini, DeepSeek, GLM, Kimi and Qwen think before the reply (Claude too, with a reasoning effort set). That thinking is paid for in the request's output limit without being part of the reply, so a request limited to the cap itself was used up by it on a hard turn, and the reply came back with nothing in it. The cap now stands for the reply you see: the request's limit is the cap plus ${room.toLocaleString()} tokens for the reasoning (half again the most this chat's recent replies used, by the API's own count, and never less than 6,000). A reply can run a little over the cap when the model reasons less than that.`);
    }
    // The target is a goal and the ceiling the one hard stop (replyLength.js).
    if (ceilingActive()) {
        const b = currentMemoryBudget();
        const goal = Number(memoryBudgetSettings().targetCost) || 0;
        add("ok", `A reply is never cut for going over your $${goal.toFixed(2)} target; it cannot pass the $${ceilingCost().toFixed(2)} ceiling`,
            `The target sizes the prompt a break leaves and nothing else: a reply that comes to more passes. The ceiling is the one hard stop on a regular reply: the request's output limit is what the ceiling leaves after the prompt (priced on ${b && b.price ? b.price.label : "the selected model"}), and a prompt that leaves no room for a usual reply is not sent, with a note on what to do. Summaries, audits, the Story Director, NPC scans and every other background call are not limited. Change either number in the Memory tab.`);
    } else if (ceilingCost() && !currentMemoryBudget()) {
        add("info", "The ceiling per reply cannot be worked out: this model's price is not known",
            "Enter the model's price under Custom price in the Memory tab (once per model). Until then no reply is limited by cost.");
    }
    // Gemini 4 reasons on its own; Megumin Suite's Gemini Pro loadout keeps custom thinking off there.
    if (/gemini-4/.test(String(model || "")) && localProfile && localProfile.cotEnabled !== false) {
        add("info", "Gemini 4 with Chain of Thought on",
            "Gemini 4 reasons before it writes on its own, and Megumin Suite V11's Gemini Pro loadout keeps custom thinking off on it (on, for Gemini 3.1 Pro and 2.5 Pro). If replies come back as reasoning with no story, or the thinking doubles up, turn Chain of Thought off in Presets & CoT.");
    }
    if (vcrpRouteHoistsSystem()) {
        const gemini = /gemini/.test(String(model || ""));
        add("info", `OpenRouter + ${gemini ? "Gemini" : "Claude"}: after-chat instructions go as user messages`,
            `OpenRouter moves every system message to the front of the prompt${gemini ? " (Gemini has one system instruction, which its cache treats as fixed)" : ""}. VCRP sends Output Rules and the closing slots as user messages instead, so ${gemini ? "Gemini" : "Claude"} reads them after the chat and per-turn changes leave the cache intact.`);
    }

    // 5. Engine and preset from the same family. Told apart by the ban list: VCRP's
    // adds entries Megumin's never had.
    const prompts = Array.isArray(cc.prompts) ? cc.prompts : [];
    const hasText = s => prompts.some(p => p && typeof p.content === "string" && p.content.includes(s));
    const vcrpBanList = hasText("**stripped articles:**");
    // Megumin's: its ban list as text (V10's preset). V11's builds its sections per engine,
    // VCRP's own rules for VCRP's engines and Pura's (engine/meguminV11.js), so it fits them all.
    const originalBanList = !vcrpBanList && hasText("<banlist>");
    const originalEngine = meguminOriginalActive();
    if (originalEngine && vcrpBanList && !isV11Engine(activeEngine())) {   // V11 has a note of its own below
        add("info", "Megumin Original engine on the VCRP preset",
            "The preset's ban list and final reminder are VCRP's, dash rules included. For Megumin's writing all the way through, select \"VCRP V10 Megumin Original\" in AI Response Configuration.");
    } else if (!originalEngine && originalBanList) {
        add("info", "VCRP engine on the Megumin Original preset",
            "The preset text is Megumin's original, without VCRP's ban list additions and dash rules. Pick a Megumin Original engine to match it, or select \"VCRP V10 Universal\".");
    } else if (originalEngine && !isV11Engine(activeEngine()) && hasText("[[banned]]")) {
        // The V11 preset fits every engine but V10's Megumin Originals: they get V11's rules there.
        add("info", "V10 Megumin Original engine on the V11 preset",
            "It works, but the ban list, formatting rules and final check are Megumin V11's, not V10's. For Megumin V10 word for word, select \"VCRP V10 Megumin Original\" in AI Response Configuration.");
    }

    // Always-on knowledgebase entries on a preset from before their cached slot.
    const kbAlways = kbAlwaysOnStats();
    if (kbAlways.count && !presetCarriesAlwaysSlot()) {
        add("info", "Re-import the preset to cache always-on knowledgebase entries",
            `${kbAlways.count} always-on ${kbAlways.count === 1 ? "entry" : "entries"} (about ${kbAlways.tokens.toLocaleString()} tokens) go after the chat and are written to the cache again every turn. The current VCRP presets carry them before the chat, where they are read at a tenth of the price.`);
    }

    // Focus on a preset imported before its tags: the correction or the plot focus would never
    // reach the model. Updating the extension does not update a preset already imported.
    const focusOff = [];
    const carries = tag => (cc.prompts || []).some(p => p && typeof p.content === "string" && p.content.includes(tag));
    if (focusSettings().enabled && !carries("[[focus]]")) focusOff.push("the drift audits' correction");
    if (Object.values(focusSettings().live).some(Boolean) && !carries("[[focus]]")) focusOff.push("Focus's every-reply checks");
    // The Author's Notebook: its fixed rules in [[notebook]] (V11's preset) or [[block_rules]].
    if (notebookOn() && !carries("[[notebook]]") && !carries("[[block_rules]]")) focusOff.push("the Author's Notebook's rules");
    // V11 Тайна reads best on its own preset: its final check, Content section and USER note,
    // built from the engine (the V11 preset's [[content]] and [[reminder]]). The V11 preset from
    // before those carried the first engine's as text, so the newer engines lose theirs on it.
    if (isV11Engine(activeEngine()) && !carries("[[reminder]]")) {
        if (carries("# Content (NORA)")) {
            add("warn", "Re-import the VCRP V11 Megumin Original preset", "The one you have is from before V11 Тайна, its Writers' Room and its DeepSeek version: it sends the first engine's Content section and final check to every V11 engine. Import \"VCRP V11 Megumin Original\" again from the extension's Presets folder, replacing the old one, and select it.");
        } else {
            add("warn", "A V11 engine is picked on a preset made for V10", "Its Content section (what the story may show, which the engine's own text points to), its story settings, its final check and its USER note have no place in this preset and are not sent. Import \"VCRP V11 Megumin Original\" from the extension's Presets folder and select it: it fits every engine but the V10 Megumin Originals.");
        }
    }
    // The V11 preset from 25/10 carried the Content rule and the story settings in the per-turn
    // rules, inside the chat. Since Megumin's 01/11 update they sit before the chat (cached), and
    // the per-turn rules follow the newest message, ending "Start your turn."
    if (carries("[[reminder]]") && prompts.some(p => p && typeof p.content === "string" && p.content.includes("[[reminder]]") && p.content.includes("[[content]]"))) {
        add("info", "Re-import the VCRP V11 Megumin Original preset for V11's newest layout",
            "The one you have is from before Megumin's 01/11 update: its per-turn rules sit before your newest message. Since 01/11 they follow it, ending on \"Start your turn.\", so the block instructions are the last thing the model reads, and V11's Content rule and story settings are cached. Import \"VCRP V11 Megumin Original\" again from the extension's Presets folder, replacing the old one.");
    }
    const plot = peekFocusState() && peekFocusState().plot;
    if (plot && plot.active && !carries("[[plotfocus]]")) focusOff.push("the plot focus");
    // The Pura engines and Pura's trackers have tags of their own.
    if (isPuraEngine(activeEngine()) && !(carries("[[pura_late]]") && carries("[[pura_system]]"))) focusOff.push("the Pura engine's settings");
    if (meguminActiveBlocks().some(b => b && b.puraRules) && !carries("[[block_rules]]")) focusOff.push("Pura's tracker rules");
    if (toneRulesText("reply") && !carries("[[pura_late]]")) focusOff.push("your Tone Rules");
    if (oneShot().text.trim() && !carries("[[pura_late]]")) focusOff.push("your one-shot direction");
    if (castLockOn() && !carries("[[pura_late]]")) focusOff.push("Existing cast only");
    if ((replyCapTokens() || ceilingActive()) && !carries("[[pura_late]]")) focusOff.push("the length limit's line to the model");
    if (focusOff.length) {
        add("warn", `Re-import the preset: ${focusOff.join(" and ")} cannot reach the model`,
            `The active preset was imported before this version and has no place for it. Import "VCRP V10 Universal" (or "VCRP V10 Megumin Original") again from the extension's Presets folder and select it. Re-importing replaces your own edits to that preset.`);
    }

    // The Gemini JB add-on (Megumin Suite V11): its line needs the [[GeminiJB]] spot, and the ^
    // it asks for are hidden while a reply streams by the preset's "clean up" regex.
    const geminiModel = /gemini/.test(String(model || ""));
    if (usesCaretWords(localProfile)) {
        const cleanUp = scripts.some(s => s && String(s.scriptName || "").trim() === "clean up" && !s.disabled);
        if (!carries("[[GeminiJB]]") || !cleanUp) {
            add("warn", "Re-import the preset for the Gemini JB add-on",
                `The active preset is from before the add-on: ${!carries("[[GeminiJB]]") ? "it has no place for the add-on's line" : "it lacks the \"clean up\" regex that hides the ^ while a reply streams"}. Import the preset again from the extension's Presets folder, replacing the old one, and select it.`);
        }
        if (!geminiModel) {
            add("info", "Gemini JB is on for a model that is not Gemini",
                `The add-on is for Gemini's content filter: ${modelLabel} does not need its line, or the ^ before every word it asks for (each one costs an output token). Turn it off in Global Toggles & Add-ons unless you want it.`);
        }
    } else if (geminiModel) {
        add("info", "Gemini without the Gemini JB add-on",
            "Megumin Suite V11's Gemini loadouts turn it on: it helps Gemini get through gritty and heavy NSFW scenes without cutting the reply off (not for NSFL). Global Toggles & Add-ons → Gemini JB.");
    }

    // SillyTavern's Reasoning Auto-Parse beside VCRP's Chain of Thought.
    reasoningParseCheck(add, ctx);

    // The helper model: its connection, and whether this SillyTavern can send to it.
    helperChecks(add);

    // How the last replies ended, from the API's own answers (generationTrace.js).
    lastRepliesCheck(add);
    // The replies in this chat that came back empty, from the stamps saved with them.
    emptyRepliesCheck(add, ctx);

    // 6. Long chats: what decides whether a request is cheap or full price.
    longChatChecks(add, ctx, cc, source, model);

    // Reply length: the safety cap rides on a SillyTavern event older versions lack.
    if (replyCapTokens() && !(event_types && event_types.CHAT_COMPLETION_SETTINGS_READY)) {
        add("warn", "This SillyTavern version can't take VCRP's reply safety cap",
            "It lacks the event extensions use to adjust a request. Set Max Response Length in AI Response Configuration instead, or update SillyTavern.");
    }

    // 7. Cache check: did the last prompt keep the one before it, or change early on?
    const cache = vcrpCacheCheckSummary(vcrpCacheCheckReport(), memoryBudgetSettings().ttl === "5m" ? 5 : 60);
    if (cache) add(cache.level, cache.title, cache.detail);

    return summarize(items);
}

function longChatChecks(add, ctx, cc, source, model) {
    const memOn = vcrpMemoryEnabled();
    const budget = memOn ? currentMemoryBudget() : null;
    const isClaude = /claude|anthropic|fable/.test(`${source} ${model}`);

    // SillyTavern trims the oldest message itself once a prompt passes Context Size: the start
    // of the prompt then changes every turn and nothing is ever read from cache.
    const maxCtx = Number(cc.openai_max_context) || 0;
    const chatTokens = (Array.isArray(ctx.chat) ? ctx.chat : []).filter(m => !m.is_system).reduce((n, m) => n + estimateTokens(m.mes || ""), 0);
    const needed = budget ? budget.warmTokens + 20000 : chatTokens + 20000;
    if (maxCtx && maxCtx < needed && (budget || chatTokens > maxCtx * 0.6)) {
        add(budget ? "error" : "warn", `Context Size (${maxCtx.toLocaleString()} tokens) is smaller than ${budget ? "Story Memory may send" : "this chat is getting"}`,
            `Past Context Size, SillyTavern drops the oldest message on its own, every turn. The start of the prompt then changes each time and every request is billed at full price. Set Context Size to at least ${needed.toLocaleString()} in AI Response Configuration (tick "Unlocked" if the slider stops short), or to the model's maximum.`);
    } else if (maxCtx && budget) {
        add("ok", `Context Size leaves Story Memory room (${maxCtx.toLocaleString()} tokens)`);
    }

    // The cache: Claude's is set up (markers, its lifetime); Gemini's keeps itself.
    const isGemini = /gemini/.test(String(model));
    const providers = Array.isArray(cc.openrouter_providers) ? cc.openrouter_providers : [];
    if (isClaude && source === "openrouter") {
        const pinned = providers.length > 0 && /anthropic/i.test(String(providers[0]));
        if (!pinned || cc.openrouter_allow_fallbacks !== false) {
            add("info", "OpenRouter: pin the provider to Anthropic",
                "OpenRouter keeps a chat on one provider while its cache is warm, but if it ever switches (Anthropic to Bedrock or Vertex), the new provider has no cache and that request is billed in full. In AI Response Configuration, put Anthropic first in OpenRouter's provider list and turn off fallbacks.");
        } else {
            add("ok", "OpenRouter provider pinned to Anthropic");
        }
    }
    if (isClaude && memoryBudgetSettings().markCache && vcrpRouteMarksCache()) {
        add("ok", "VCRP marks the prompt cache itself (your last two replies)",
            "This needs claude.cachingAtDepth: -1 in SillyTavern's config.yaml, so SillyTavern adds none of its own markers. With both on, a request can carry more cache markers than Claude accepts and fail with a 400 \"bad request\" error. If you can't change config.yaml, untick \"Mark the cache from VCRP\" in the Memory tab instead (and pin OpenRouter to Anthropic, where SillyTavern's markers still read the cache).");
    } else if (isClaude) {
        add("info", "Prompt caching is set in SillyTavern's config.yaml",
            `VCRP can't read that file. Long chats on Claude need claude.cachingAtDepth: 0 and claude.extendedTTL: true there${budget ? " (or Story Memory's cache lifetime set to 5 minutes)" : ""}.${source === "openrouter" ? " On OpenRouter + Claude, VCRP can mark the cache itself instead (Memory tab: Mark the cache from VCRP), which also works on Bedrock." : ""}`);
    }
    if (isGemini) {
        add("ok", "Gemini caches the prompt by itself",
            "Gemini keeps a repeated prompt start for a few minutes (about 3 to 5) and bills it at its cached price, with nothing to set up. VCRP keeps the start of the prompt the same from turn to turn so it can. Story Memory sizes every request as if the cache had lapsed, so even a reply after a short pause stays within your target.");
        if (source === "openrouter") {
            const pinned = providers.length > 0 && /google/i.test(String(providers[0]));
            if (!pinned) {
                add("info", "OpenRouter: pin the provider to Google AI Studio",
                    "OpenRouter serves Gemini from several providers at different prices (Vertex US and the priority tier cost more) and each keeps its own cache. In AI Response Configuration, put Google AI Studio first in OpenRouter's provider list, so every request is billed at the price you entered and finds its cache.");
            } else {
                add("ok", "OpenRouter provider pinned to Google");
            }
        }
    }

    if (!memOn) return;
    if (!budget) {
        add("warn", `Story Memory: no price known for ${model || "this model"}`,
            "Set a custom price in the Memory tab. Without one the budget can't be worked out, so nothing is ever cut.");
        return;
    }
    if (!memoryCanReachPrompt()) {
        add("error", "Story Memory is on, but the active preset can't carry its memory text",
            "The preset needs an enabled slot containing [[long-Memory]] (both VCRP presets have it in <history>). Until then Story Memory cuts nothing, so long chats are not kept to the budget.");
    }
    const st = memoryState();
    const pending = ((st && st.pending) || []).length;
    if (pending) {
        add("info", `Story Memory: ${pending} chapter${pending > 1 ? "s" : ""} waiting for review`,
            "The next cut after a break can't reach past them until they're approved. Memory tab, Review.");
    }
    if (autoSummaryHold(st) === "paused after failed summaries") {
        add("warn", "Story Memory: automatic summaries are paused",
            "Two summaries in a row failed. Use Summarize now in the Memory tab to retry; a success starts them again.");
    }
    const plan = st && st.lastPlan;
    if (plan && plan.behind) {
        add("warn", "Story Memory: the last cut fell short of the budget",
            plan.limit === "summaries" ? "Approve the waiting chapters, or use Summarize now in the Memory tab." : "The recent text kept word for word is more than this budget allows: raise the target or lower the floor in the Memory tab.");
    } else {
        add("ok", `Story Memory on: after a break the prompt is cut to about ${Math.round(budget.coldTokens / 1000)}k tokens`);
    }
}

/** The helper model (vcrp/helper): on with no connection, a connection that is gone or of the wrong kind, a SillyTavern that cannot send to it, untested. */
function helperChecks(add) {
    let h;
    try { h = helperSettings(); } catch (e) { return; }
    if (!h.enabled) return;
    const jobs = HELPER_JOBS.filter(j => helperJobWanted(j.key)).map(j => j.title).join(", ") || "nothing yet";
    if (!h.profileId) {
        add("warn", "The helper is on, but has no connection",
            "Pick one in the Helper tab (a connection profile, or Use my current connection). Until then its jobs run on your story model.");
        return;
    }
    if (h.profileId === CURRENT_CONNECTION) {
        add("ok", "The helper runs on your current connection", `Its jobs (${jobs}) run on the story's model, one at a time, never while a reply is being written.`);
        return;
    }
    const p = connectionProfiles().find(x => x.id === h.profileId);
    if (!p) {
        add("warn", "The helper's connection profile is gone", "The profile picked in the Helper tab no longer exists. Pick another there; until then its jobs run on your story model.");
        return;
    }
    if (!isChatProfile(p)) {
        add("error", `The helper's profile (${p.name}) is a Text Completion profile`, "The helper works with Chat Completion only. Pick another profile in the Helper tab.");
        return;
    }
    if (!canSendToProfile()) {
        add("error", "This SillyTavern can't send a request to the helper's profile",
            "It lacks the connection manager's request service (newer SillyTavern versions have it). Pick Use my current connection in the Helper tab, or update SillyTavern; until then the helper's jobs run on your story model.");
        return;
    }
    const tested = h.testedProfileId === h.profileId;
    add(tested ? "ok" : "info", `The helper is ready on ${p.name}`,
        `${tested ? "Tested." : "Press Test in the Helper tab once, to check it answers."} It does: ${jobs}. Its calls go straight to that profile and are not counted in Story Memory's spend.`);
}

const LIMIT_BY = { cap: "VCRP's Safety cap", ceiling: "VCRP's ceiling per reply", hold: "VCRP's Hold each reply to the target", "": "SillyTavern's Max Response Length" };
const kTok = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

// ── SillyTavern's Reasoning Auto-Parse beside VCRP's Chain of Thought ────────
// With Auto-Parse on, SillyTavern takes a streamed reply that opens with its template's prefix
// and keeps everything in the Thinking box until it meets the suffix, to the letter. A thinking
// closed any other way, or never, used to leave the whole reply there and the message empty
// (replyRescue.js puts it back now).
const reasoningSettings = ctx => (ctx && ctx.powerUserSettings && ctx.powerUserSettings.reasoning) || null;
const autoParseOn = ctx => { const rs = reasoningSettings(ctx); return Boolean(rs && rs.auto_parse && rs.prefix && rs.suffix); };
const putBackCount = chat => (Array.isArray(chat) ? chat : []).filter(m => m && m.extra && m.extra.vcrp_rescued).length;

function reasoningParseCheck(add, ctx) {
    if (!autoParseOn(ctx)) return;
    const rs = reasoningSettings(ctx);
    const cotOn = Boolean(localProfile) && localProfile.cotEnabled !== false;
    const back = putBackCount(ctx && ctx.chat);
    if (!cotOn && !back) return;
    const show = s => JSON.stringify(String(s)).slice(1, -1);
    add("info", `SillyTavern's Reasoning Auto-Parse is on${back ? `: ${back} repl${back === 1 ? "y" : "ies"} it had left empty in this chat ${back === 1 ? "was" : "were"} put back` : ""}`,
        `With it on, a streamed reply that opens with "${show(rs.prefix)}" goes into the Thinking box until SillyTavern meets "${show(rs.suffix)}", to the letter (a line break in the template has to be there too). A reply that closes its thinking any other way ("...done.</think>" on one line, </thinking>), or never closes it, stayed there whole, story and all, and the message came back empty with nothing wrong on the provider's side. VCRP now puts such a reply back as it arrives. To keep it from happening at all, turn Auto-Parse off (Advanced Formatting → Reasoning): the preset's own regex draws the thinking box, and takes any of those closings.`);
}

// ── The empty replies of a chat ──────────────────────────────────────────────
// Each reply carries how its generation ended (generationTrace.js stamps msg.extra.vcrp_finish,
// saved with the chat), so a chat can be read back for what stopped its empty replies, long
// after the toasts are gone: the thing to send along when asking about them.

const wentQuiet = f => Boolean(f) && f.ended === "abort" && f.quietMs >= QUIET_MS;
// The connection's doing, not the model's or the provider's: it broke, closed early, or went quiet.
const connectionEnded = f => Boolean(f) && f.done && (f.ended === "error" || f.ended === "closed" || wentQuiet(f));

const whatStopped = f => {
    if (!f || !f.done) return "no stop reason recorded";
    if (f.ended === "abort") return wentQuiet(f) ? "stopped after the stream had gone quiet" : "stopped by the reader";
    if (f.reason === "length") return "stopped by the output limit";
    if (f.reason === "filter") return `a content-policy stop by the API's answer (${f.native || "content filter"})`;
    if (f.reason === "tool") return `ended in a tool call (${f.native || "tool call"})`;
    if (f.reason === "other") return `ended by the provider with no reason given (${f.native || "none"})`;
    if (f.ended === "error") return "the connection broke";
    if (f.error) return `failed (${f.error})`;
    if (f.ended === "closed") return "the stream closed with no stop reason";
    if (f.reason === "stop") return "ended on its own with no text";
    return f.reason ? `${f.reason}${f.native ? ` (${f.native})` : ""}` : "no stop reason given";
};

/**
 * The replies of `chat` that are blank (pure): [{ index, kind, own, what, line, stamp }],
 * oldest first. The greeting is the card's and is left out.
 */
export function emptyRepliesReport(chat) {
    const out = [];
    (Array.isArray(chat) ? chat : []).forEach((m, index) => {
        if (!index || !m || m.is_user || m.is_system || typeof m.mes !== "string") return;
        const { kind, own } = blankKindOf(m);
        if (!kind) return;
        const f = (m.extra && m.extra.vcrp_finish) || null;
        const what = whatStopped(f);
        const bits = [what];
        const words = apiWords(f);
        if (words) bits.push(`the API's words: ${words}`);
        if (f && f.provider) bits.push(`via ${f.provider}`);
        if (f && f.model) bits.push(f.model);
        if (f && f.usage && f.usage.out) bits.push(`wrote ${kTok(f.usage.out)} tokens${f.usage.reasoning ? ` (${kTok(f.usage.reasoning)} reasoning)` : ""}`);
        if (f && f.usage && f.usage.input) bits.push(`read ${kTok(f.usage.input)}${f.usage.cached ? ` (${kTok(f.usage.cached)} cached)` : ""}`);
        if (f && f.limit) bits.push(`limit ${kTok(f.limit)} (${LIMIT_BY[f.limitBy] || LIMIT_BY[""]})`);
        if (f && typeof f.ms === "number") bits.push(`took ${spell(f.ms)}${typeof f.firstMs === "number" ? `, first text or reasoning after ${spell(f.firstMs)}` : ""}${f.quietMs >= QUIET_MS ? `, silent for the last ${spell(f.quietMs)}` : ""}`);
        if (f && typeof f.ms === "number") bits.push(`${kTok(f.text || 0)} characters of reply and ${kTok(f.think || 0)} of reasoning arrived`);
        if (f && f.genId) bits.push(f.genId);
        const label = kind === "thinking" && !own ? "reasoning only" : kind;
        out.push({ index, kind, own, what, line: `${label}: ${bits.join(", ")}`, stamp: f });
    });
    return out;
}

/** The report as text to paste: the setup, then one line per empty reply. "" when the chat has none. */
export function vcrpEmptyRepliesText(ctx = null) {
    let c = ctx;
    try { c = c || getContext(); } catch (e) { c = {}; }
    const chat = (c && c.chat) || [];
    const rows = emptyRepliesReport(chat);
    if (!rows.length) return "";
    const cc = (c && c.chatCompletionSettings) || {};
    const { source, model } = vcrpActiveModel();
    const p = localProfile || {};
    const head = [
        `VCRP empty replies: ${rows.length} of ${chat.filter((m, i) => i > 0 && m && !m.is_user && !m.is_system).length} replies in this chat`,
        `model: ${source} ${model}; engine: ${p.mode || "?"}; preset max tokens: ${cc.openai_max_tokens || "?"}; reasoning effort: ${cc.reasoning_effort || "?"}; stream: ${cc.stream_openai !== false}`,
        `Gemini JB: ${usesCaretWords(p) ? "on" : "off"}; CoT: ${p.cotEnabled !== false ? "on" : "off"}; Safety cap: ${replyCapTokens() || 0}; helper blocks: ${(() => { try { return helperJobWanted("blocks") && helperSettings().enabled ? "on" : "off"; } catch (e) { return "?"; } })()}`,
        `SillyTavern Reasoning Auto-Parse: ${autoParseOn(c) ? `on (prefix ${JSON.stringify(reasoningSettings(c).prefix)}, suffix ${JSON.stringify(reasoningSettings(c).suffix)})` : "off"}; replies VCRP put back from the Thinking box in this chat: ${putBackCount(chat)}`,
    ];
    return `${head.join("\n")}\n${rows.map(r => `#${r.index} ${r.line}${r.stamp && r.stamp.at ? ` @ ${new Date(r.stamp.at).toISOString()}` : ""}`).join("\n")}`;
}

function emptyRepliesCheck(add, ctx) {
    const chat = (ctx && ctx.chat) || [];
    const rows = emptyRepliesReport(chat);
    if (!rows.length) return;
    const by = {};
    for (const r of rows) by[r.what] = (by[r.what] || 0) + 1;
    const summary = Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ");
    const stamped = r => r.stamp && r.stamp.done;
    const filtered = rows.filter(r => stamped(r) && r.stamp.ended !== "abort" && r.stamp.reason === "filter").length;
    const unstamped = rows.filter(r => !stamped(r)).length;
    const limited = rows.filter(r => stamped(r) && r.stamp.ended !== "abort" && r.stamp.reason === "length");
    const dropped = rows.filter(r => connectionEnded(r.stamp)).length;
    const noReason = rows.filter(r => stamped(r) && r.stamp.ended !== "abort" && r.stamp.reason === "other").length;
    // All thinking of the reply's own, the model having ended on its own: on a model that
    // reasons by itself, VCRP's own Chain of Thought asked for a second round of thinking, and
    // the reply went into it.
    const allThinking = rows.filter(r => (r.kind === "thinking" || r.kind === "thinking-open") && r.own && stamped(r) && r.stamp.ended !== "abort" && r.stamp.reason === "stop").length;
    const cotOn = Boolean(localProfile) && localProfile.cotEnabled !== false;
    const limitNames = [...new Set(limited.map(r => LIMIT_BY[r.stamp.limitBy] || LIMIT_BY[""]))];
    const advice = [
        limited.length ? `${limited.length} stopped at the output limit before the story (${limitNames.join(", ")}): raise it.` : "",
        dropped ? `${dropped} ended with the connection, not the model: it broke, closed before the model had finished, or went quiet until the reply was stopped. SillyTavern's server does not notice a provider connection that drops mid-reply; VCRP now says so when a stream goes quiet. On a phone, keep Termux awake (termux-wake-lock) and stay on one network while a reply is being written.` : "",
        allThinking && cotOn && vcrpModelReasonsHidden() ? `${allThinking} ${allThinking === 1 ? "is" : "are"} all thinking, the model having ended its turn there: this model reasons on its own, and asked to think aloud as well it can put the whole reply into the thinking. Turn Chain of Thought off in Presets & CoT (Model Setup's loadout for it does).` : "",
        noReason ? `${noReason} ${noReason === 1 ? "was" : "were"} ended by the provider with no reason given (its word: OTHER): VCRP does not send those again by itself.` : "",
        filtered ? "A content-policy stop named in the API's answer is the provider's decision: VCRP sent the request as it was, and does not send it again or change it." : "",
        unstamped ? "A reply with no stop reason recorded came before VCRP read the answers (10.0.0-vcrp.13), or the answer could not be read." : "",
    ].filter(Boolean).join(" ");
    add("warn", `${rows.length} repl${rows.length === 1 ? "y" : "ies"} in this chat came back empty: ${summary}`,
        `${rows.slice(-5).map(r => `#${r.index} ${r.line}`).join(" · ")}. Copy the details (the button on this card) and send them along when asking about it. ${advice}`.trim());
}

/**
 * The last few replies as the API's own answers ended them: the stop reason, what each wrote
 * (reasoning counted) and the limit it went out with. A warning when one was stopped by the
 * limit or the provider's filter, or failed: those come back with nothing in them.
 */
function lastRepliesCheck(add) {
    let recent = [];
    try { recent = vcrpGenerationRecords().filter(r => r.done && (r.kind === "reply" || r.kind === "continue")).slice(-5); } catch (e) { recent = []; }
    if (!recent.length) return;
    const line = r => {
        const how = r.ended === "abort" ? (wentQuiet(r) ? "stopped after the stream had gone quiet" : "stopped by the reader")
            : r.ended === "error" ? "the connection broke"
                : r.error ? `failed (${r.error})`
                    : r.reason === "stop" ? "ended on its own"
                        : r.reason === "length" ? "stopped by the output limit"
                            : r.reason === "filter" ? "a content-policy stop by the API's answer"
                                : r.reason === "tool" ? "ended in a tool call"
                                    : r.reason === "other" ? "ended by the provider with no reason given"
                                        : r.ended === "closed" ? "the stream closed with no stop reason"
                                            : r.reason ? r.reason : "no stop reason given";
        const native = r.native && r.native.toLowerCase() !== (r.reason || "") && !r.error ? ` (${r.native})` : "";
        const via = r.provider ? ` via ${r.provider}` : "";
        const wrote = r.usage && r.usage.out ? `, wrote ${kTok(r.usage.out)} tokens${r.usage.reasoning ? ` (${kTok(r.usage.reasoning)} of them reasoning)` : ""}` : "";
        const limit = r.limit ? `, limit ${kTok(r.limit)} from ${LIMIT_BY[r.limitBy] || LIMIT_BY[""]}` : "";
        const took = typeof r.ms === "number" ? `, took ${spell(r.ms)}` : "";
        return `${new Date(r.at).toLocaleTimeString()}: ${how}${native}${via}${wrote}${limit}${took}`;
    };
    const cut = recent.filter(r => r.ended !== "abort" && r.reason === "length").length;
    const filtered = recent.filter(r => r.ended !== "abort" && r.reason === "filter").length;
    const dropped = recent.filter(connectionEnded).length;
    const failed = recent.filter(r => r.error && r.ended !== "error").length;
    const trouble = [cut ? `${cut} stopped by the output limit` : "", filtered ? `${filtered} named a content-policy stop` : "", dropped ? `${dropped} ended with the connection` : "", failed ? `${failed} failed` : ""].filter(Boolean);
    const advice = [
        cut ? "A reply stopped by the limit while still reasoning comes back with nothing in it: raise the limit named." : "",
        dropped ? "A connection that broke, closed early or went quiet is between SillyTavern and the provider, not the model's doing: swipe for another." : "",
        filtered ? "A content-policy stop named in the API's answer is the provider's decision: VCRP sent the request as it was." : "",
    ].filter(Boolean);
    add(trouble.length ? "warn" : "ok",
        trouble.length ? `Of the last ${recent.length} replies, ${trouble.join(", ")}` : `The last ${recent.length} replies ended on their own`,
        `${recent.map(line).join(" · ")}${advice.length ? ` — ${advice.join(" ")}` : ""}`);
}

function summarize(items) {
    return {
        items,
        errors: items.filter(i => i.level === "error").length,
        warnings: items.filter(i => i.level === "warn").length,
    };
}

// ── The red dot on the VCRP button ──────────────────────────────────────────

let badgeTimer = null;

/** Re-checks (debounced) and shows/hides the problem dot on the floating VCRP button. */
export function vcrpRefreshHealthBadge() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
        const btn = $("#prompt-slot-fixed-btn");
        if (!btn.length) return;
        let result;
        try { result = vcrpHealthCheck(); } catch (e) { console.warn("[VCRP] Health check failed:", e); return; }
        btn.find(".vcrp-health-dot").remove();
        if (result.errors > 0) {
            const first = result.items.find(i => i.level === "error");
            btn.append($(`<span class="vcrp-health-dot"></span>`).attr("title", `VCRP setup problem: ${first.title}. Open VCRP → Global Settings → Setup Check.`));
        }
    }, 300);
}

// ── The Setup Check card in Global Settings ──────────────────────────────────

const ICON = {
    ok: ["fa-circle-check", "#10b981"],
    info: ["fa-circle-info", "#3b82f6"],
    warn: ["fa-triangle-exclamation", "#f59e0b"],
    error: ["fa-circle-xmark", "#ef4444"],
};

/** @param {() => void} rerender redraws the tab (for the Re-check button) */
export function buildHealthCard(rerender) {
    const result = vcrpHealthCheck();
    const status = result.errors ? `${result.errors} problem${result.errors > 1 ? "s" : ""}` : result.warnings ? `${result.warnings} warning${result.warnings > 1 ? "s" : ""}` : "All good";
    const statusColor = result.errors ? "#ef4444" : result.warnings ? "#f59e0b" : "#10b981";
    const rows = result.items.map(i => {
        const [icon, color] = ICON[i.level];
        return `<div style="display:flex; gap:10px; align-items:flex-start; padding:6px 0;">
            <i class="fa-solid ${icon}" style="color:${color}; margin-top:3px;"></i>
            <div><div style="font-size:0.82rem; font-weight:600; color:var(--text-main);">${escapeHtmlAttr(i.title)}</div>
            ${i.detail ? `<div style="font-size:0.72rem; color:var(--text-muted); line-height:1.4;">${escapeHtmlAttr(i.detail)}</div>` : ""}</div>
        </div>`;
    }).join("");
    const report = vcrpEmptyRepliesText();
    const card = $(`
        <div class="mtab-panel" style="margin: 0; padding: 12px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px; flex-wrap:wrap;">
                <span style="font-weight:700; color:${statusColor};">${status}</span>
                <span style="display:flex; gap:6px;">
                    ${report ? `<button class="ps-modern-btn secondary vcrp-health-copy-empty" style="padding:4px 10px; font-size:0.72rem;" title="The empty replies of this chat and how each ended, as text to paste"><i class="fa-solid fa-copy"></i> Copy empty-reply details</button>` : ""}
                    <button class="ps-modern-btn secondary vcrp-health-recheck" style="padding:4px 10px; font-size:0.72rem;"><i class="fa-solid fa-rotate"></i> Re-check</button>
                </span>
            </div>
            ${rows}
        </div>`);
    card.find(".vcrp-health-recheck").on("click", () => { vcrpRefreshHealthBadge(); rerender(); });
    card.find(".vcrp-health-copy-empty").on("click", () => copyText(vcrpEmptyRepliesText(), "The empty replies' details"));
    return card;
}

// Copies text to the clipboard; where that is not allowed (an http page on a phone), shows it in
// a dialog to copy by hand.
export function copyText(text, title, copied = "Copied. Paste it where you ask about the empty replies.") {
    const done = () => { if (typeof toastr !== "undefined") toastr.success(copied, "VCRP"); };
    const show = () => {
        if (typeof document === "undefined") return;
        const dlg = document.createElement("dialog");
        dlg.className = "vcrp-text-dialog";
        dlg.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px; max-width:min(92vw, 640px);">
            <b>${escapeHtmlAttr(title)}</b>
            <textarea readonly style="width:100%; min-height:40vh; font-size:0.72rem; font-family:monospace;"></textarea>
            <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="ps-modern-btn vcrp-dlg-select">Select all</button><button type="button" class="ps-modern-btn secondary vcrp-dlg-close">Close</button></div>
        </div>`;
        dlg.querySelector("textarea").value = text;
        dlg.querySelector(".vcrp-dlg-select").addEventListener("click", () => { const ta = dlg.querySelector("textarea"); ta.focus(); ta.select(); });
        dlg.querySelector(".vcrp-dlg-close").addEventListener("click", () => { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); });
        document.body.appendChild(dlg);
        if (typeof dlg.showModal === "function") { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } } else dlg.setAttribute("open", "");
    };
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(text).then(done, show);
        } else show();
    } catch (e) { show(); }
}
