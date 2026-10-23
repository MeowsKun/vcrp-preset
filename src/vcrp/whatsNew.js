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

export const WHATS_NEW_ID = "10.0.0-vcrp.4";

const ITEMS = [
    "<b>V11 Тайна.</b> Megumin Suite V11's new engine, word for word: a writers' room of five that talks the turn over in the thinking, and one narrator with a voice and opinions in the reply. With CoT V11 and its Thinking Cap (for GLM, Kimi, DeepSeek, Qwen), and its own preset, <b>VCRP V11 Megumin Original</b>. In PRESETS &amp; COT, under V11.",
    "<b>Author's Notebook.</b> The story keeps two or three hidden truths, plants small clues and pays each one off when the story earns it. Always on with V11; a switch in the Focus tab for any other engine. Kept with the chat, so swipes, edits and deletes undo exactly what a reply did; each reply's notebook changes are a blurred tab on its card.",
    "<b>Characters on file.</b> Someone named again who left the scene comes back as they left: their last World State entry and Bonds line. BLOCKS tab, under World State (or Bonds).",
    "<b>An On/Off switch</b> on the top bar of this window: off, VCRP steps aside and nothing runs after a reply. <b>Lorebook entries</b> now reach the Story Director, NPC scans and Focus audits. <b>Safer NPC Bank:</b> an NPC record (an imported pack, a dossier a model wrote) can no longer run code on the page.",
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
    toastr.info("New: V11 Тайна and the Author's Notebook. To use V11, import the VCRP V11 Megumin Original preset from the extension's Presets folder (your other VCRP presets need no re-import). What's new: VCRP → Global Settings.", `VCRP updated to ${WHATS_NEW_ID}`, { timeOut: 20000, extendedTimeOut: 10000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>For V11, import the new preset</b> VCRP V11 Megumin Original from the extension's Presets folder, select it while V11 Тайна is picked, and allow its regex scripts (Extensions → Regex → Preset scripts; Setup Check reminds you). Your VCRP V10 presets need no re-import: the Notebook, characters on file and everything else work with them as they are.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
