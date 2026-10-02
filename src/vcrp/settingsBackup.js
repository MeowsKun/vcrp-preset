// ─────────────────────────────────────────────────────────────────────────────
// VCRP: export / import of all VCRP settings.
//
// One file with everything stored under extension_settings.VCRP: every character's
// profile, the global settings, Dev Mode engines, the shared knowledgebase and the
// tab-sync switches. NPC banks and Story Memory (chapters, facts) live in each chat's
// metadata, saved with the chat file itself, and are not included.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced, cancelDebounce } from "../st.js";
import { extensionName } from "../core/constants.js";
import { initProfile, _saveProfileDebouncedInner } from "../core/profile.js";
import { cleanLegacySettings, migrateRenamedTabs, migrateUtilityPrefillFlag } from "../core/migrations.js";
import { downloadJsonFile } from "../utils/download.js";

const FORMAT = "vcrp-settings";

function stamp() {
    return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

export function exportAllSettings(filenamePrefix = "vcrp_settings") {
    const data = JSON.parse(JSON.stringify(extension_settings[extensionName] || {}));
    downloadJsonFile(`${filenamePrefix}_${stamp()}.json`, {
        format: FORMAT, version: 1, exportedAt: new Date().toISOString(), settings: data,
    });
}

/** Returns the settings object inside an export file, or throws with a readable message. */
export function readSettingsExport(data) {
    if (!data || typeof data !== "object") throw new Error("This file is not a VCRP settings export.");
    if (data.format === FORMAT && data.settings && typeof data.settings === "object") return data.settings;
    throw new Error(data.format === "vcrp-knowledgebase"
        ? "This is a knowledgebase export. Import it from the Knowledgebase tab instead."
        : "This file is not a VCRP settings export.");
}

/**
 * Replaces all VCRP settings with the ones in `data` (an export file's parsed JSON).
 * The caller confirms with the user and makes a backup first.
 */
export function applySettingsImport(data) {
    const settings = readSettingsExport(data);
    if (!settings.profiles || typeof settings.profiles !== "object") {
        throw new Error("The file has no profiles in it, so it was not imported.");
    }
    // A save queued from the current profile must not land on top of the imported settings.
    cancelDebounce(_saveProfileDebouncedInner);
    extension_settings[extensionName] = JSON.parse(JSON.stringify(settings));
    // Same one-time repairs that run at startup, so an older export is brought up to date.
    cleanLegacySettings();
    migrateRenamedTabs();
    migrateUtilityPrefillFlag();
    saveSettingsDebounced();
    initProfile();
}

/** Opens a file picker and imports the chosen file after confirmation and an automatic backup. */
export function pickAndImportSettings(onDone) {
    const input = $(`<input type="file" accept=".json" style="display:none;">`);
    $("body").append(input);
    input.on("change", function () {
        const file = this.files && this.files[0];
        input.remove();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try {
                parsed = JSON.parse(String(reader.result));
                readSettingsExport(parsed);
            } catch (e) {
                toastr.error(e.message || "Could not read that file.", "VCRP");
                return;
            }
            if (!confirm("Replace ALL your VCRP settings (every character's profile, global settings, custom engines, shared knowledgebase) with this file?\n\nA backup of your current settings will download first.")) return;
            exportAllSettings("vcrp_settings_backup");
            try {
                applySettingsImport(parsed);
                toastr.success("Settings imported. A backup of the previous settings was downloaded.", "VCRP");
                if (typeof onDone === "function") onDone();
            } catch (e) {
                toastr.error(e.message || "Import failed.", "VCRP");
            }
        };
        reader.readAsText(file);
    });
    input.trigger("click");
}
