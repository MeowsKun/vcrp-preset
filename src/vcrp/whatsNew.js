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

export const WHATS_NEW_ID = "10.0.0-vcrp.9";

const ITEMS = [
    "<b>A sweep of every feature on every engine.</b> Each module (Story Memory, Focus, the Notebook, the NPC Bank, the knowledgebase, Anime mode, the blocks and Pura's trackers, Tone Rules, Existing cast only, the one-shot direction, the length line, Dev Mode overrides and custom modules, every add-on and every Pura setting) was checked on all the engines on their presets, on Gemini 4 Argon and on Claude: all of it reaches the model, in the right place for the cache.",
    "<b>Trimmed, after the sweep.</b> Gone: <b>V11 Тайна Preview</b> (the first V11 engine, with its thinking) and the <b>V11 Тайна DeepSeek</b> pair (a profile on one moves to V11 Тайна); the writing styles written for the V7–V9 engines and the five generic ones (the four of VCRP's engines remain; a profile on a removed one takes its engine's own); the <b>Gemini Thinking Override</b> (three &lt;think&gt; lines, from the Gemini 2 era); Dev Mode's dead Word Count, Short-term Memory and model acknowledgement slots; and the \"New\" badge every engine wore.",
    "<b>Fixes.</b> Enhanced Dialogue is V10's alone (the flag could have swapped out a V11 engine's dialogue section). Setup Check now warns, not notes, when a V11 engine runs on a V10 preset: its Content section, which the engine's own text points to, is not sent there.",
    "<b>The presets</b> no longer carry V10's empty Short-term Memory slot (Story Memory's text has its own). Re-importing is optional: a preset imported before still works, the old slot stripped as it always was.",
]

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
    toastr.info("New: a sweep of every feature on every engine, and a trim after it (V11 Тайна Preview, the DeepSeek pair, the old writing styles and the Gemini Thinking Override are gone; profiles on them move over). Details in Global Settings → What's new.", "VCRP " + WHATS_NEW_ID, { timeOut: 15000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>Nothing to re-import this time.</b> The presets changed only by losing an empty slot; the one you have keeps working. If you are still on a V11 preset from before Megumin's 01/11 update, Setup Check says so: re-import VCRP V11 Megumin Original from the extension's Presets folder, replacing the old one. Your VCRP V10 presets need no re-import.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
