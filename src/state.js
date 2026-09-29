// Settings storage: a global default profile plus optional per-character / per-group profiles.
// Stored under extension_settings.VCRP9 (V8 used "VCRP"; the two never collide).

export const SETTINGS_KEY = "VCRP9";
export const SETTINGS_VERSION = 1;

const ctx = () => SillyTavern.getContext();

export function defaultProfile() {
    return {
        // Engine & thinking
        engine: "ukiyo", // ukiyo | shura (see ENGINES in content.js)
        cot: "auto", // auto (paired with the engine) | ukiyo | shura
        thinkingCap: false,
        strictDialogue: false,
        boldNpcs: false,
        prefillMode: "auto", // auto | on | off
        consent: false,
        // Global settings
        language: "",
        pronouns: "off", // off | male | female
        lengthType: "max", // max | min
        lengthWords: "",
        dialogueColors: true,
        directLanguage: false,
        // Response blocks
        blocks: { worldState: false, innerChatter: false, cyoa: false, summary: false },
        condenseDepth: 40,
        // Writing style
        style: { text: "" }, // narration voice; empty = the engine's own default
        anime: { enabled: false, text: "" },
    };
}

/** Converts settings saved by earlier V9 alphas. */
function migrate(p) {
    if ("cotLength" in p) {
        if (p.thinkingCap === undefined) p.thinkingCap = p.cotLength === "short";
        delete p.cotLength;
    }
    if (p.style && "enabled" in p.style) delete p.style.enabled; // the voice is now always on
    // VCRP Classic was retired; its users keep Bold NPCs, which was always on for it.
    if (p.engine === "vcrp") { p.engine = "ukiyo"; p.boldNpcs = true; }
    if (p.cot === "vcrp") p.cot = "auto";
    return p;
}

function root() {
    const all = ctx().extensionSettings;
    if (!all[SETTINGS_KEY]) all[SETTINGS_KEY] = {};
    const r = all[SETTINGS_KEY];
    if (!r.version) r.version = SETTINGS_VERSION;
    if (!r.profiles) r.profiles = {};
    if (!r.profiles.default) r.profiles.default = defaultProfile();
    if (!r.ui) r.ui = { previewPrompt: false };
    return r;
}

/** Fills in any keys added in later versions, without touching existing values. */
function patch(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
        if (target[k] === undefined) target[k] = structuredClone(v);
        else if (v && typeof v === "object" && !Array.isArray(v) && typeof target[k] === "object") patch(target[k], v);
    }
    return target;
}

/** Key of the character or group the current chat belongs to, or null when no chat is open. */
export function getChatKey() {
    const c = ctx();
    if (c.groupId !== undefined && c.groupId !== null) return `group_${c.groupId}`;
    if (c.characterId !== undefined && c.characterId !== null && c.characters[c.characterId]) return c.characters[c.characterId].avatar;
    return null;
}

export function getChatName() {
    const c = ctx();
    if (c.groupId !== undefined && c.groupId !== null) {
        const g = (c.groups || []).find(x => String(x.id) === String(c.groupId));
        return g?.name || "Group chat";
    }
    if (c.characterId !== undefined && c.characterId !== null) return c.characters[c.characterId]?.name || null;
    return null;
}

export function hasOwnProfile() {
    const key = getChatKey();
    return !!(key && root().profiles[key]);
}

/** The profile that applies right now: the chat's own one if it exists, else the global default. */
export function getProfile() {
    const r = root();
    const key = getChatKey();
    const p = (key && r.profiles[key]) || r.profiles.default;
    return patch(migrate(p), defaultProfile());
}

export function createOwnProfile() {
    const key = getChatKey();
    if (!key) return;
    root().profiles[key] = structuredClone(root().profiles.default);
    save();
}

export function deleteOwnProfile() {
    const key = getChatKey();
    if (!key) return;
    delete root().profiles[key];
    save();
}

export function resetCurrentProfile() {
    const r = root();
    const key = hasOwnProfile() ? getChatKey() : "default";
    r.profiles[key] = defaultProfile();
    save();
}

export function getUi() {
    return root().ui;
}

// Settings left behind by the V8 extension (stored under "VCRP"; may hold large memory vaults).
const LEGACY_KEY = "VCRP";

/** Size in characters of the old V8 settings, or 0 if there are none. */
export function legacySettingsSize() {
    const old = ctx().extensionSettings[LEGACY_KEY];
    return old ? JSON.stringify(old).length : 0;
}

export function deleteLegacySettings() {
    delete ctx().extensionSettings[LEGACY_KEY];
    save();
}

export function save() {
    ctx().saveSettingsDebounced();
}

/**
 * Drops profiles of characters/groups that no longer exist.
 * Only judges a kind of profile when that list has actually loaded: an empty character or
 * group list at startup must never be read as "everything was deleted".
 */
export function cleanOrphanProfiles() {
    const c = ctx();
    const characters = c.characters || [];
    const groups = c.groups || [];
    const avatars = new Set(characters.map(ch => ch.avatar));
    const groupKeys = new Set(groups.map(g => `group_${g.id}`));
    const profiles = root().profiles;
    let removed = 0;
    for (const key of Object.keys(profiles)) {
        if (key === "default") continue;
        const isGroup = key.startsWith("group_");
        if (isGroup ? (groups.length && !groupKeys.has(key)) : (characters.length && !avatars.has(key))) {
            delete profiles[key];
            removed++;
        }
    }
    if (removed) { save(); console.log(`[VCRP] Removed ${removed} orphaned profile(s).`); }
}
