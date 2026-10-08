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

export const WHATS_NEW_ID = "10.0.0-vcrp.2";

const ITEMS = [
    "<b>Focus tab.</b> A <b>plot focus</b> steers the story around something you choose; it goes last in every reply's prompt, after your message, where it never touches the cache. <b>Drift audits</b> every few replies catch character drift, repeated motifs and slop, and write a correction you approve first.",
    "<b>Background calls</b> (Story Director, NPC scans, audits) show what they cost before you press the button, and count in the spend estimate. With Story Memory on, the Director reads the story memory instead of 100 raw messages; NPC scans read only what is new since the last one.",
    "<b>Fixes.</b> A $ in your text reaches the prompt as written. An NPC scan no longer fills another chat's bank when you switch chats mid-scan.",
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
    toastr.info("Import the VCRP preset again from the extension's Presets folder to use the new Focus tab. What's new: VCRP → Global Settings.", `VCRP updated to ${WHATS_NEW_ID}`, { timeOut: 20000, extendedTimeOut: 10000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>Import the preset again</b> (VCRP V10 Universal, or VCRP V10 Megumin Original) from the extension's Presets folder and select it. The Focus tab needs the new version's two tags; updating the extension does not update a preset you already imported. Re-importing replaces your own edits to that preset.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
