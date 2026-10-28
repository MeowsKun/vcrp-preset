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

export const WHATS_NEW_ID = "10.0.0-vcrp.6";

const ITEMS = [
    "<b>V11 Тайна · Adapted</b>, with its <b>Writers' Room</b> and <b>DeepSeek</b> versions: V11's engines run as VCRP engines. V11's text, thinking and Author's Notebook, with VCRP's ban list (dash rule included), the dash cleaner, and VCRP's own wording of your writing style, add-ons and Story Config. Any writing style fits. The Megumin Originals stay word for word beside them. In PRESETS &amp; COT, under V11.",
    "<b>Sweep fixes.</b> Dialogue Colors: a color set in a style counts, a line for two characters is left alone, and a role (the Guard) is never merged with someone named like it (the Guard Captain). A reply cut off in the middle of a tag leaves no half tag in the history. Setup Check notes a V10 Megumin Original engine on the V11 preset.",
    "<b>Megumin Suite V11's newest update, word for word.</b> <b>V11 Тайна</b> (one storyteller, the base for every model), <b>V11 Тайна · Writers' Room</b> and <b>V11 Тайна DeepSeek</b> join the first V11 engine, now called <b>V11 Тайна Preview</b>. Each picks its own thinking. In PRESETS &amp; COT, under V11.",
    "<b>V11 Inside</b>, a new writing style from V11: the narration rides inside one character at a time (never yours) and sees the scene the way they would. Switching between the V11 engines keeps it.",
    "<b>VCRP V11 Megumin Original, rebuilt</b> on V11's new preset: its rules up top, where they cache, and only what changes each turn after the chat. Each V11 engine brings its own Content section, story settings and final check. The notebook's hidden truths are now about the world and the other characters, never your own character's past (V11's fix).",
    "<b>One preset for every engine</b> but the V10 Megumin Originals: leave VCRP V11 Megumin Original selected and pick a Pura Director engine, V10 Ukiyo or V10 Shura on it. They get VCRP's own rules there (ban list, dash rule, formatting rules, final reminder), word for word as on VCRP V10 Universal.",
    "<b>Fixes.</b> Dialogue colors stay put on the Megumin Original engines (they now name who is speaking, so VCRP can hold each character to theirs). A reply after a break no longer gets cut off in its blocks: the request always leaves room for a whole reply. A block a reply leaves out, or is cut off in, is carried from where it was last written whole instead of dropping out.",
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
    toastr.info("New: V11 Тайна Adapted (V11's engines with VCRP's rules) and Megumin's V11 update. If you have not since 10.0.0-vcrp.5, re-import the VCRP V11 Megumin Original preset from the extension's Presets folder, replacing the old one. What's new: VCRP → Global Settings.", `VCRP updated to ${WHATS_NEW_ID}`, { timeOut: 20000, extendedTimeOut: 10000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>For V11, re-import its preset</b> VCRP V11 Megumin Original from the extension's Presets folder, replacing the old one, select it while a V11 engine is picked, and allow its regex scripts (Extensions → Regex → Preset scripts). Setup Check tells you if the old one is still loaded. Your VCRP V10 presets need no re-import.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
