// ─────────────────────────────────────────────────────────────────────────────
// VCRP Quick: the switches you reach for mid-scene, without the full VCRP window.
//
// An entry in SillyTavern's wand menu (the magic-wand button by the chat input) opens a
// small panel with:
//   - this chat's Tone Rules, on or off;
//   - the plot focus, on or off;
//   - with a Pura engine selected, Pura's scene randomisers (Dead Dove Escalation among
//     them), with the same rules as the Pura Director panel: two at most, the Director's
//     Cut alone.
// Everything here is the same setting as in the full window; the texts (the rules, the
// plot) are written there. A SillyTavern without the wand menu gets a small floating
// button under VCRP's own instead.
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../core/state.js";
import { saveProfileToMemory } from "../core/profile.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { isPuraEngine } from "../core/engines.js";
import { activeEngine } from "../engine/meguminOriginal.js";
import { toneRules, setToneRules, toneChatOpen } from "./toneRules.js";
import { peekFocusState, setPlotFocus, PLOT_DEFAULTS, plotFocusRemaining } from "./focus/index.js";
import { puraSettings, PURA_RANDOMISER_LABELS, PURA_MAX_RANDOMISERS } from "./pura/index.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const OVERLAY = "vcrp_quick_overlay";

const SWITCH = (id, on, label, desc, disabled = false) => `
    <label class="vcrp-quick-row${disabled ? " off" : ""}" for="${id}">
        <span class="vcrp-quick-text"><b>${label}</b><span>${desc}</span></span>
        <input type="checkbox" id="${id}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""} />
    </label>`;

function puraRandomisersHtml() {
    const s = puraSettings();
    const cut = s.randomisers.includes("directorsCut");
    return Object.entries(PURA_RANDOMISER_LABELS).map(([k, label]) => {
        const on = s.randomisers.includes(k);
        const blocked = !on && (cut || (k === "directorsCut" && s.randomisers.length > 0) || s.randomisers.length >= PURA_MAX_RANDOMISERS);
        return `<label class="vcrp-quick-chip${on ? " on" : ""}${blocked ? " off" : ""}"><input type="checkbox" class="vcrp_quick_rand" data-key="${esc(k)}" ${on ? "checked" : ""} ${blocked ? "disabled" : ""} /> ${esc(label)}</label>`;
    }).join("");
}

/** The panel's contents, drawn from the current settings. */
function quickHtml() {
    const open = toneChatOpen();
    const tone = toneRules();
    const toneDesc = !open ? "Open a chat first." : tone.text.trim() ? "This chat's rules for the story's tone." : "No rules written for this chat yet: write them in Global Toggles &amp; Add Ons.";
    const st = peekFocusState();
    const plot = { ...PLOT_DEFAULTS, ...((st && st.plot) || {}) };
    const left = plotFocusRemaining(st);
    const plotDesc = !open ? "Open a chat first."
        : !plot.text.trim() ? "Nothing written yet: write it in the Focus tab."
            : plot.active && left <= 0 ? "It has run its replies; switch it off and on to restart."
                : esc(plot.text.trim().slice(0, 90)) + (plot.text.trim().length > 90 ? "…" : "");
    const pura = isPuraEngine(activeEngine());
    return `
        <div class="vcrp-quick-head"><span><i class="fa-solid fa-sliders"></i> VCRP Quick</span>
            <button type="button" class="vcrp-quick-close" id="vcrp_quick_close" title="Close"><i class="fa-solid fa-xmark"></i></button></div>
        ${SWITCH("vcrp_quick_tone", open && tone.enabled, "Tone Rules", toneDesc, !open)}
        ${SWITCH("vcrp_quick_plot", open && plot.active, "Plot focus", plotDesc, !open)}
        ${pura ? `<div class="vcrp-quick-sub">Pura's scene randomisers <span>(two at most; the Director's Cut alone)</span></div>
        <div class="vcrp-quick-chips" id="vcrp_quick_rands">${puraRandomisersHtml()}</div>` : `<div class="vcrp-quick-sub muted">Pura's scene randomisers appear here while a Pura Director engine is selected.</div>`}
        <button type="button" class="vcrp-quick-more" id="vcrp_quick_more"><i class="fa-solid fa-wand-magic-sparkles"></i> Open VCRP</button>`;
}

function wire(card, doc) {
    const redraw = () => { card.innerHTML = quickHtml(); wire(card, doc); };
    const on = (sel, ev, fn) => { const el = card.querySelector(sel); if (el) el.addEventListener(ev, fn); };
    on("#vcrp_quick_close", "click", () => closeQuickPanel(doc));
    on("#vcrp_quick_more", "click", () => {
        closeQuickPanel(doc);
        const btn = doc.getElementById("prompt-slot-fixed-btn");
        if (btn) btn.click();
    });
    on("#vcrp_quick_tone", "change", e => { setToneRules({ enabled: e.target.checked }); redraw(); });
    on("#vcrp_quick_plot", "change", async e => { await setPlotFocus({ active: e.target.checked }); redraw(); });
    card.querySelectorAll(".vcrp_quick_rand").forEach(box => box.addEventListener("change", () => {
        const k = box.getAttribute("data-key");
        let next = puraSettings().randomisers.filter(x => x !== k);
        if (box.checked) next = k === "directorsCut" ? ["directorsCut"] : [...next.filter(x => x !== "directorsCut"), k].slice(-PURA_MAX_RANDOMISERS);
        if (!localProfile.pura || typeof localProfile.pura !== "object") localProfile.pura = {};
        localProfile.pura.randomisers = next;
        saveProfileToMemory();
        redraw();
    }));
}

/** Opens the panel (or redraws it when it is open). */
export function openQuickPanel(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    let overlay = doc.getElementById(OVERLAY);
    if (!overlay) {
        overlay = doc.createElement("div");
        overlay.id = OVERLAY;
        overlay.addEventListener("click", e => { if (e.target === overlay) closeQuickPanel(doc); });
        doc.body.appendChild(overlay);
        const onKey = e => {
            if (!doc.getElementById(OVERLAY)) { doc.removeEventListener("keydown", onKey); return; }
            if (e.key === "Escape") { closeQuickPanel(doc); doc.removeEventListener("keydown", onKey); }
        };
        doc.addEventListener("keydown", onKey);
    }
    overlay.innerHTML = "";
    const card = doc.createElement("div");
    card.className = "vcrp-quick-card";
    card.innerHTML = quickHtml();
    overlay.appendChild(card);
    wire(card, doc);
}

export function closeQuickPanel(doc = typeof document !== "undefined" ? document : null) {
    const overlay = doc && doc.getElementById(OVERLAY);
    if (overlay) overlay.remove();
}

/** On a chat change: an open panel shows the new chat's switches. */
export function refreshQuickPanel(doc = typeof document !== "undefined" ? document : null) {
    if (doc && doc.getElementById(OVERLAY)) openQuickPanel(doc);
}

/**
 * Adds "VCRP Quick" to SillyTavern's wand menu (once). With no wand menu, and `fallback` (once
 * SillyTavern is ready, so a menu built late is not missed), a small button under VCRP's own;
 * a menu that turns up later takes over from it.
 */
export function vcrpInstallQuickPanel(doc = typeof document !== "undefined" ? document : null, { fallback = true } = {}) {
    if (!doc || doc.getElementById("vcrp_quick_wand")) return;
    const menu = doc.getElementById("extensionsMenu");
    const fab = doc.getElementById("vcrp_quick_fab");
    if (!menu && (fab || !fallback)) return;
    const item = doc.createElement("div");
    if (menu) {
        if (fab) fab.remove();
        item.id = "vcrp_quick_wand";
        item.className = "list-group-item flex-container flexGap5 interactable";
        item.setAttribute("tabindex", "0");
        item.innerHTML = `<div class="fa-solid fa-sliders extensionsMenuExtensionButton"></div><span>VCRP Quick</span>`;
        menu.appendChild(item);
    } else {
        item.id = "vcrp_quick_fab";
        item.title = "VCRP Quick";
        item.innerHTML = `<i class="fa-solid fa-sliders"></i>`;
        doc.body.appendChild(item);
    }
    item.addEventListener("click", () => openQuickPanel(doc));
}
