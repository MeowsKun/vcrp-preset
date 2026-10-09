// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what's new after an update, said once.
//
// Updating the extension (git pull, or SillyTavern's updater) does not update a preset the
// reader already imported, and a feature that needs a new preset tag does nothing until the
// preset is imported again. So a release says so once: a toast when SillyTavern starts, a
// dot on the settings gear, and a card at the top of Global Settings until "Got it".
// A fresh install starts with it seen. For the next release: bump WHATS_NEW_ID, rewrite
// the list.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced } from "../st.js";
import { extensionName } from "../core/constants.js";

export const WHATS_NEW_ID = "10.0.0-vcrp.3";

const ITEMS = [
    "<b>Pura Director engines.</b> Pura's Director Preset 16.0 (by Pura) as two engines in PRESETS &amp; COT: <b>Original</b>, word for word with Pura's own controls, and <b>Adapted</b>, which hands formatting, length and genre to Story Config. All of Pura's settings are in the new <b>Pura Director</b> panel there: voices, modes, scene randomisers, extras.",
    "<b>Pura's trackers as blocks.</b> Seventeen of them (relationship cards, scene, time, events, NPC sheets, inventory, RPG stats...) in the BLOCKS tab, drawn with Pura's own cards, for any engine. VCRP keeps the latest of each in mind for the model, and Pura's NPC sheets fill the NPC Bank.",
    "<b>Focus tab</b> (if you skipped 10.0.0-vcrp.2): a plot focus that steers the story around something you choose, and drift audits that catch character drift, repeated motifs and slop.",
];

const settings = () => extension_settings[extensionName] && extension_settings[extensionName].globalSettings;

export function hasUnseenWhatsNew() {
    const gs = settings();
    return Boolean(gs) && gs.whatsNewSeen !== WHATS_NEW_ID;
}

export function markWhatsNewSeen() {
    const gs = settings();
    if (!gs) return;
    gs.whatsNewSeen = WHATS_NEW_ID;
    saveSettingsDebounced();
}

/** Once, when SillyTavern is ready: the one thing that needs doing. */
export function whatsNewToast() {
    if (!hasUnseenWhatsNew() || typeof toastr === "undefined") return;
    toastr.info("Import the VCRP preset again from the extension's Presets folder to use the Pura Director engines, Pura's trackers and the Focus tab. What's new: VCRP → Global Settings.", `VCRP updated to ${WHATS_NEW_ID}`, { timeOut: 20000, extendedTimeOut: 10000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>Import the preset again</b> (VCRP V10 Universal, or VCRP V10 Megumin Original) from the extension's Presets folder and select it. The new engines, trackers and Focus need the new version's tags; updating the extension does not update a preset you already imported. Re-importing replaces your own edits to that preset.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
