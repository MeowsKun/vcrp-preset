// ─────────────────────────────────────────────────────────────────────────────
// VCRP: setup health check.
//
// The two most common reasons VCRP "does nothing" are a non-VCRP preset being
// active and the preset's regex scripts not being allowed/enabled. This checks
// both (plus the API type and the prefill slot), shows the result as a card in
// Global Settings, and puts a red dot on the VCRP button while a problem stands.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext } from "../st.js";
import { vcrpDetectPrefill, vcrpActiveModel, vcrpShouldPrefill, vcrpPrefillMode } from "./generation.js";
import { escapeHtmlAttr } from "../utils/html.js";

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
            "Select \"VCRP V10 Universal\" (or the Cache Friendly one) in AI Response Configuration. Import it from the extension's Presets folder if it is not listed.");
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

    return summarize(items);
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
