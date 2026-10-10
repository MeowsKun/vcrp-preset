// ─────────────────────────────────────────────────────────────────────────────
// VCRP Quick: the switches you reach for mid-scene, without the full VCRP window.
//
// An entry in SillyTavern's wand menu (the magic-wand button by the chat input) opens a
// small panel with:
//   - a direction for the next reply only (oneShot.js);
//   - this chat's Tone Rules, on or off;
//   - "Existing cast only": no new characters while it is on (castLock.js);
//   - the plot focus, on or off;
//   - with a Pura engine selected, Pura's scene randomisers (Dead Dove Escalation among
//     them), with the same rules as the Pura Director panel: two at most, the Director's
//     Cut alone.
// Everything here is the same setting as in the full window; the texts (the rules, the
// plot) are written there. A SillyTavern without the wand menu gets a small floating
// button under VCRP's own instead. The panel opens as a modal dialog (the browser's top
// layer), so nothing in SillyTavern's page can squash or cover it.
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../core/state.js";
import { saveProfileToMemory } from "../core/profile.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { isPuraEngine } from "../core/engines.js";
import { activeEngine } from "../engine/meguminOriginal.js";
import { toneRules, setToneRules, toneChatOpen } from "./toneRules.js";
import { peekFocusState, setPlotFocus, PLOT_DEFAULTS, plotFocusRemaining } from "./focus/index.js";
import { puraSettings, PURA_RANDOMISER_LABELS, PURA_MAX_RANDOMISERS } from "./pura/index.js";
import { oneShot, setOneShot } from "./oneShot.js";
import { castLockOn, setCastLock } from "./castLock.js";
import { getContext } from "../st.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const OVERLAY = "vcrp_quick_overlay";
const STYLE_ID = "vcrp-quick-style";

// The panel brings its own look rather than leaning on style.css: a phone that kept an older
// cached style.css after an update (or a browser without the `inset` shorthand) drew it as a
// broken, unstyled menu at the top of the screen. The placement that matters (a full-screen
// layer, the card at the bottom) is also set on the elements themselves.
const OVERLAY_STYLE = "position:fixed; top:0; right:0; bottom:0; left:0; width:100%; height:100%; z-index:10001; display:flex; align-items:flex-end; justify-content:center; padding:12px; box-sizing:border-box; background:rgba(0,0,0,0.45); margin:0;";
// The dialog itself is only a frame for the card, held to the bottom of the screen.
const DIALOG_STYLE = "padding:0; border:none; background:transparent; color:#f4f4f5; width:calc(100% - 24px); max-width:420px; max-height:none; margin:auto auto 12px auto; overflow:visible;";
const CARD_STYLE = "position:relative; width:100%; max-width:420px; max-height:80vh; overflow-y:auto; box-sizing:border-box; background:#18181b; color:#f4f4f5; border:1px solid #27272a; border-radius:14px; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,0.6); font-size:0.85rem; text-align:left;";
const CSS = `
dialog#${OVERLAY}::backdrop { background: rgba(0,0,0,0.45); }
#${OVERLAY} .vcrp-quick-card { max-height: 80dvh; }
#${OVERLAY} .vcrp-quick-head { display:flex; align-items:center; justify-content:space-between; font-weight:700; margin-bottom:10px; }
#${OVERLAY} .vcrp-quick-close, #${OVERLAY} .vcrp-quick-more { background:rgba(255,255,255,0.06); color:inherit; border:1px solid #27272a; border-radius:8px; padding:6px 10px; cursor:pointer; font:inherit; width:auto; margin:0; }
#${OVERLAY} .vcrp-quick-more { width:100%; margin-top:12px; }
#${OVERLAY} .vcrp-quick-row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid #27272a; cursor:pointer; margin:0; }
#${OVERLAY} .vcrp-quick-row.off { opacity:0.55; cursor:default; }
#${OVERLAY} .vcrp-quick-text { display:flex; flex-direction:column; gap:2px; }
#${OVERLAY} .vcrp-quick-text span, #${OVERLAY} .vcrp-quick-sub span, #${OVERLAY} .vcrp-quick-sub.muted, #${OVERLAY} .vcrp-quick-shot-row { font-size:0.72rem; color:#a1a1aa; font-weight:400; }
#${OVERLAY} .vcrp-quick-row input { width:20px; height:20px; flex-shrink:0; margin:0; }
#${OVERLAY} .vcrp-quick-sub { margin:12px 0 6px; font-weight:700; }
#${OVERLAY} .vcrp-quick-chips { display:flex; flex-wrap:wrap; gap:6px; }
#${OVERLAY} .vcrp-quick-chip { display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; border:1px solid #27272a; background:rgba(255,255,255,0.04); font-size:0.76rem; cursor:pointer; margin:0; }
#${OVERLAY} .vcrp-quick-chip.on { border-color:#ec4899; background:rgba(236,72,153,0.15); }
#${OVERLAY} .vcrp-quick-chip.off { opacity:0.45; cursor:default; }
#${OVERLAY} .vcrp-quick-shot { width:100%; box-sizing:border-box; background:rgba(0,0,0,0.25); color:inherit; border:1px solid #27272a; border-radius:8px; padding:8px; font:inherit; resize:vertical; min-height:60px; margin:0; }
#${OVERLAY} .vcrp-quick-shot-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:4px 0 6px; }
#vcrp_quick_fab { position:fixed; top:116px; right:26px; z-index:9999; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:#18181b; color:#f4f4f5; border:1px solid #27272a; cursor:pointer; }
`;
function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    (doc.head || doc.body).appendChild(el);
}

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
    const shot = oneShot();
    const chat = ((getContext() || {}).chat) || [];
    const usedHere = shot.used && shot.used.index === chat.length - 1 && chat.length && !chat[chat.length - 1].is_user;
    const shotDesc = !open ? "Open a chat first."
        : shot.text.trim() ? "Goes out with your next reply, then clears."
            : usedHere ? `Used by the last reply ("${esc(String(shot.used.text).slice(0, 60))}${String(shot.used.text).length > 60 ? "…" : ""}"): a swipe or Continue of it gets it again.`
                : "A steer for the next reply only, never saved into the chat.";
    return `
        <div class="vcrp-quick-head"><span><i class="fa-solid fa-sliders"></i> VCRP Quick</span>
            <button type="button" class="vcrp-quick-close" id="vcrp_quick_close" title="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="vcrp-quick-sub" style="margin-top:0;">Next reply only</div>
        <textarea id="vcrp_quick_shot" class="vcrp-quick-shot" rows="3" placeholder="e.g. She finally tells him about the ring." ${open ? "" : "disabled"}>${esc(shot.text)}</textarea>
        <div class="vcrp-quick-shot-row"><span id="vcrp_quick_shot_desc">${shotDesc}</span>${open && shot.text.trim() ? `<button type="button" class="vcrp-quick-close" id="vcrp_quick_shot_clear">Clear</button>` : ""}</div>
        ${SWITCH("vcrp_quick_tone", open && tone.enabled, "Tone Rules", toneDesc, !open)}
        ${SWITCH("vcrp_quick_cast", open && castLockOn(), "Existing cast only", open ? "No new characters: the story stays with the ones already in it (unnamed background aside), and twists that call for someone new use an existing character." : "Open a chat first.", !open)}
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
    on("#vcrp_quick_shot", "input", e => {
        setOneShot(e.target.value, { soon: true });
        const desc = card.querySelector("#vcrp_quick_shot_desc");
        if (desc) desc.textContent = e.target.value.trim() ? "Goes out with your next reply, then clears." : "A steer for the next reply only, never saved into the chat.";
    });
    // Leaving the box saves at once (before a send or a chat switch can miss it).
    on("#vcrp_quick_shot", "change", e => setOneShot(e.target.value));
    on("#vcrp_quick_shot_clear", "click", () => { setOneShot(""); redraw(); });
    on("#vcrp_quick_tone", "change", e => { setToneRules({ enabled: e.target.checked }); redraw(); });
    on("#vcrp_quick_cast", "change", e => { setCastLock(e.target.checked); redraw(); });
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

// A modal dialog opens in the browser's own top layer, outside the page's layout: nothing in
// SillyTavern's (a transformed or clipped parent, a stacking order) can squash or cover it. A
// fixed full-screen layer drawn in the page was squashed into a strip at the top of the
// screen on a phone. Browsers without modal dialogs get that layer still.
const canModal = doc => {
    try { return typeof doc.createElement("dialog").showModal === "function"; } catch (e) { return false; }
};

/** Opens the panel (or redraws it when it is open). */
export function openQuickPanel(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    ensureStyle(doc);
    let overlay = doc.getElementById(OVERLAY);
    if (!overlay) {
        const modal = canModal(doc);
        overlay = doc.createElement(modal ? "dialog" : "div");
        overlay.id = OVERLAY;
        overlay.style.cssText = modal ? DIALOG_STYLE : OVERLAY_STYLE;
        // A tap outside the card (on the backdrop) closes it.
        overlay.addEventListener("click", e => { if (e.target === overlay) closeQuickPanel(doc); });
        doc.body.appendChild(overlay);
        if (modal) {
            overlay.addEventListener("cancel", e => { e.preventDefault(); closeQuickPanel(doc); });   // Escape, the back gesture
            overlay.showModal();
        } else {
            const onKey = e => {
                if (!doc.getElementById(OVERLAY)) { doc.removeEventListener("keydown", onKey); return; }
                if (e.key === "Escape") { closeQuickPanel(doc); doc.removeEventListener("keydown", onKey); }
            };
            doc.addEventListener("keydown", onKey);
        }
    }
    overlay.innerHTML = "";
    const card = doc.createElement("div");
    card.className = "vcrp-quick-card";
    card.style.cssText = CARD_STYLE;
    card.innerHTML = quickHtml();
    overlay.appendChild(card);
    wire(card, doc);
}

export function closeQuickPanel(doc = typeof document !== "undefined" ? document : null) {
    const overlay = doc && doc.getElementById(OVERLAY);
    if (!overlay) return;
    if (typeof overlay.close === "function" && overlay.open) { try { overlay.close(); } catch (e) { /* removed below anyway */ } }
    overlay.remove();
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
        ensureStyle(doc);
        item.id = "vcrp_quick_fab";
        item.title = "VCRP Quick";
        item.innerHTML = `<i class="fa-solid fa-sliders"></i>`;
        doc.body.appendChild(item);
    }
    item.addEventListener("click", () => {
        // The wand menu shuts the way SillyTavern shuts it, so it is not left hanging open.
        const open = doc.getElementById("extensionsMenu");
        if (open && item.parentNode === open) {
            const jq = doc.defaultView && doc.defaultView.jQuery;
            if (jq) jq(open).fadeOut(100); else open.style.display = "none";
        }
        openQuickPanel(doc);
    });
}
