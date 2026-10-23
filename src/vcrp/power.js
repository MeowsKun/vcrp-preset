// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the master switch (after Megumin Suite V11's).
//
// Off, VCRP steps aside: the prompt goes out as SillyTavern built it, with nothing added
// (a VCRP preset's own [[tags]] are blanked, so the model never reads them), no request
// limit, no cache markers, no Story Memory cut; and nothing runs after a reply (no summary,
// no audit, no Story Director, no NPC scan, nothing rewritten in the reply). What is already
// in the chat still draws: block cards, cost badges. Handy for a quick chat with another
// preset, or to see whether something odd is VCRP's doing. On the top bar of the VCRP
// window; install-wide (Global Settings), and missing means on.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced } from "../st.js";
import { extensionName } from "../core/constants.js";
import { meguminAllSlotTriggers } from "../../data/slots.js";

/** VCRP is on (the default). */
export function vcrpOn() {
    const g = extension_settings[extensionName] && extension_settings[extensionName].globalSettings;
    return !(g && g.vcrpOff === true);
}

export function setVcrpOn(on) {
    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    s.globalSettings = s.globalSettings || {};
    s.globalSettings.vcrpOff = !on;
    try { saveSettingsDebounced(); } catch (e) { console.warn("[VCRP] Master switch: could not save", e); }
    drawPowerState();
}

/** `fn`, only while VCRP is on (for the hooks that act on their own). */
export const whenOn = fn => (...args) => (vcrpOn() ? fn(...args) : undefined);

/**
 * Off: the prompt as SillyTavern built it, a VCRP preset's own tags blanked (with their empty
 * lines). Only VCRP's tags: a card or a lorebook writing [[Mira]] keeps it.
 */
export function blankVcrpTags(messages) {
    if (!Array.isArray(messages)) return;
    const tags = meguminAllSlotTriggers();
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m || typeof m.content !== "string") continue;
        let blanked = false;
        for (const tag of tags) {
            if (!m.content.includes(tag)) continue;
            const re = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            m.content = m.content.replace(new RegExp(`^[ \\t]*${re}[ \\t]*\\r?\\n?`, "gm"), "").split(tag).join("");
            blanked = true;
        }
        // A slot that was only tags (the CoT Prefill one) goes: an empty message is rejected by
        // some APIs, and an empty last assistant message reads as a prefill to Claude.
        if (blanked && !m.content.trim()) messages.splice(i, 1);
    }
}

/** The top bar's button and the floating button show the state. */
export function drawPowerState(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    const on = vcrpOn();
    const btn = doc.getElementById("ps_btn_power");
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-power-off"></i> ${on ? "On" : "Off"}`;
        btn.style.color = on ? "#10b981" : "#ef4444";
        btn.style.borderColor = on ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)";
        btn.title = on ? "VCRP is on. Turn it off and VCRP steps aside: the prompt goes out as SillyTavern builds it, and nothing runs after a reply." : "VCRP is off: nothing is added to the prompt and nothing runs after a reply. Turn it back on here.";
    }
    const fab = doc.getElementById("prompt-slot-fixed-btn");
    if (fab) fab.style.opacity = on ? "" : "0.4";
}
