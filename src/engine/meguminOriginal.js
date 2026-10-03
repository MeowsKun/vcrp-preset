// ──────────────────────────────────────────────────────────────────────────────
// Megumin Original: the original wording of the shared texts.
//
// The two Megumin Original engines carry Megumin Suite V10's own engine text and
// thinking steps as entries of their own. The texts every engine shares (writing
// styles, add-ons, Story Config, the Story Director) exist once, in VCRP's wording,
// so while an original engine is active these helpers hand back Megumin's wording
// instead. The tables come from data/megumin.js, generated from the upstream commit.
//
// A text the reader edited is never replaced: only VCRP's shipped wording is swapped,
// and a Dev Mode override still wins because it is applied after these.
// ──────────────────────────────────────────────────────────────────────────────

import { extension_settings } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { hardcodedLogic } from "../../data/database.js";
import { isMeguminEngine } from "../core/engines.js";
import { MEGUMIN_STYLE_RULES, MEGUMIN_ADDONS, MEGUMIN_STORYPLAN } from "../../data/megumin.js";

/** The engine the profile has selected, built-in or custom. */
export function activeEngine() {
    const custom = (extension_settings[extensionName] && extension_settings[extensionName].customModes) || [];
    const mode = localProfile && localProfile.mode;
    return [...hardcodedLogic.modes, ...custom].find(m => m.id === mode) || null;
}

/** True while a Megumin Original engine (or a clone of one) is selected. */
export function meguminOriginalActive() {
    return isMeguminEngine(activeEngine());
}

// Punctuation is all VCRP changed in most of these, and a style picked before an
// update holds the wording of its day. Comparing letters alone recognises every
// shipped version as unedited.
const letters = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The style rule to send: Megumin's when the profile holds a shipped version of it. */
export function meguminStyleRule(styleId, aiRule) {
    const original = MEGUMIN_STYLE_RULES[styleId];
    if (!original || !aiRule) return aiRule;
    const shipped = hardcodedLogic.directStyles.find(s => s.id === styleId);
    const k = letters(aiRule);
    return (k === letters(original) || (shipped && k === letters(shipped.rule))) ? original : aiRule;
}

/** An add-on's text, in Megumin's wording where VCRP reworded it. */
export function meguminAddonText(id, text) {
    return Object.prototype.hasOwnProperty.call(MEGUMIN_ADDONS, id) ? MEGUMIN_ADDONS[id] : text;
}

/** A Story Director template, in Megumin's wording where VCRP reworded it. */
export function meguminPlanTemplate(key, text) {
    return Object.prototype.hasOwnProperty.call(MEGUMIN_STORYPLAN, key) ? MEGUMIN_STORYPLAN[key] : text;
}
