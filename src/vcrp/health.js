// ─────────────────────────────────────────────────────────────────────────────
// VCRP: setup health check.
//
// The two most common reasons VCRP "does nothing" are a non-VCRP preset being
// active and the preset's regex scripts not being allowed/enabled. This checks
// both (plus the API type and the prefill slot), shows the result as a card in
// Global Settings, and puts a red dot on the VCRP button while a problem stands.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext, event_types } from "../st.js";
import { vcrpDetectPrefill, vcrpActiveModel, vcrpShouldPrefill, vcrpPrefillMode, vcrpRouteHoistsSystem } from "./generation.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { vcrpMemoryEnabled, currentMemoryBudget, memoryBudgetSettings, memoryState, estimateTokens, memoryCanReachPrompt } from "./memory/index.js";
import { autoSummaryHold } from "./memory/summarize.js";
import { meguminOriginalActive } from "../engine/meguminOriginal.js";
import { kbAlwaysOnStats, presetCarriesAlwaysSlot } from "./knowledgebase.js";
import { vcrpCacheCheckReport, vcrpCacheCheckSummary } from "./cacheCheck.js";
import { replyCapTokens } from "./replyLength.js";
import { focusSettings, peekFocusState } from "./focus/index.js";
import { isPuraEngine } from "../core/engines.js";
import { activeEngine } from "../engine/meguminOriginal.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import { toneRulesText } from "./toneRules.js";
import { oneShot } from "./oneShot.js";
import { castLockOn } from "./castLock.js";

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
            "Select \"VCRP V10 Universal\" (or \"VCRP V10 Megumin Original\") in AI Response Configuration. Import it from the extension's Presets folder if it is not listed.");
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
    if (vcrpRouteHoistsSystem()) {
        add("info", "OpenRouter + Claude: after-chat instructions go as user messages",
            "OpenRouter moves every system message to the front of the prompt. VCRP sends Output Rules and the closing slots as user messages instead, so Claude reads them after the chat and per-turn changes leave the cache intact.");
    }

    // 5. Engine and preset from the same family. Told apart by the ban list: VCRP's
    // adds entries Megumin's never had.
    const prompts = Array.isArray(cc.prompts) ? cc.prompts : [];
    const hasText = s => prompts.some(p => p && typeof p.content === "string" && p.content.includes(s));
    const vcrpBanList = hasText("**stripped articles:**");
    const originalBanList = !vcrpBanList && hasText("<banlist>");
    const originalEngine = meguminOriginalActive();
    if (originalEngine && vcrpBanList) {
        add("info", "Megumin Original engine on the VCRP preset",
            "The preset's ban list and final reminder are VCRP's, dash rules included. For Megumin's writing all the way through, select \"VCRP V10 Megumin Original\" in AI Response Configuration.");
    } else if (!originalEngine && originalBanList) {
        add("info", "VCRP engine on the Megumin Original preset",
            "The preset text is Megumin's original, without VCRP's ban list additions and dash rules. Pick a Megumin Original engine to match it, or select \"VCRP V10 Universal\".");
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
    const plot = peekFocusState() && peekFocusState().plot;
    if (plot && plot.active && !carries("[[plotfocus]]")) focusOff.push("the plot focus");
    // The Pura engines and Pura's trackers have tags of their own.
    if (isPuraEngine(activeEngine()) && !(carries("[[pura_late]]") && carries("[[pura_system]]"))) focusOff.push("the Pura engine's settings");
    if (meguminActiveBlocks().some(b => b && b.puraRules) && !carries("[[block_rules]]")) focusOff.push("Pura's tracker rules");
    if (toneRulesText("reply") && !carries("[[pura_late]]")) focusOff.push("your Tone Rules");
    if (oneShot().text.trim() && !carries("[[pura_late]]")) focusOff.push("your one-shot direction");
    if (castLockOn() && !carries("[[pura_late]]")) focusOff.push("Existing cast only");
    if (focusOff.length) {
        add("warn", `Re-import the preset: ${focusOff.join(" and ")} cannot reach the model`,
            `The active preset was imported before this version and has no place for it. Import "VCRP V10 Universal" (or "VCRP V10 Megumin Original") again from the extension's Presets folder and select it. Re-importing replaces your own edits to that preset.`);
    }

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

    if (!isClaude) return;

    if (source === "openrouter") {
        const providers = Array.isArray(cc.openrouter_providers) ? cc.openrouter_providers : [];
        const pinned = providers.length > 0 && /anthropic/i.test(String(providers[0]));
        if (!pinned || cc.openrouter_allow_fallbacks !== false) {
            add("info", "OpenRouter: pin the provider to Anthropic",
                "OpenRouter keeps a chat on one provider while its cache is warm, but if it ever switches (Anthropic to Bedrock or Vertex), the new provider has no cache and that request is billed in full. In AI Response Configuration, put Anthropic first in OpenRouter's provider list and turn off fallbacks.");
        } else {
            add("ok", "OpenRouter provider pinned to Anthropic");
        }
    }

    if (memoryBudgetSettings().markCache && vcrpRouteHoistsSystem()) {
        add("ok", "VCRP marks the prompt cache itself (your last two replies)",
            "This needs claude.cachingAtDepth: -1 in SillyTavern's config.yaml, so SillyTavern adds none of its own markers. With both on, a request can carry more cache markers than Claude accepts and fail with a 400 \"bad request\" error. If you can't change config.yaml, untick \"Mark the cache from VCRP\" in the Memory tab instead (and pin OpenRouter to Anthropic, where SillyTavern's markers still read the cache).");
    } else {
        add("info", "Prompt caching is set in SillyTavern's config.yaml",
            `VCRP can't read that file. Long chats on Claude need claude.cachingAtDepth: 0 and claude.extendedTTL: true there${budget ? " (or Story Memory's cache lifetime set to 5 minutes)" : ""}.${source === "openrouter" ? " On OpenRouter + Claude, VCRP can mark the cache itself instead (Memory tab: Mark the cache from VCRP), which also works on Bedrock." : ""}`);
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
    const card = $(`
        <div class="mtab-panel" style="margin: 0; padding: 12px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:700; color:${statusColor};">${status}</span>
                <button class="ps-modern-btn secondary vcrp-health-recheck" style="padding:4px 10px; font-size:0.72rem;"><i class="fa-solid fa-rotate"></i> Re-check</button>
            </div>
            ${rows}
        </div>`);
    card.find(".vcrp-health-recheck").on("click", () => { vcrpRefreshHealthBadge(); rerender(); });
    return card;
}
