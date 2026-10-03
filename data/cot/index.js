// The chain-of-thought library, in display order.
//
// Exported as `models` because that is the key it occupies in hardcodedLogic and
// the name every reader downstream already uses. The folder is named cot/ because
// that is what these actually are — none of them describe an LLM model.

// VCRP: only the V10 CoTs ship (plus cot-off); the V1-V9 generations were removed.
// The Megumin Original set is Megumin Suite's own, generated into data/megumin.js.
import { cot_v10 } from "./v10.js";
import { cot_megumin } from "../megumin.js";

export const models = [
    ...cot_v10,
    ...cot_megumin,
];

/**
 * Which chain-of-thought an engine is written for.
 *
 * This mapping used to be an inline if/else chain inside the PRESETS tab's
 * click handler, which made it invisible to anything else that needed the same
 * answer -- and Dev Mode needs it, to fill in a clone's reasoning script. Two
 * copies of a mapping like this drift the moment a generation is added.
 *
 * The language argument only matters for the generations that were translated;
 * v7, v8 and v10 exist in English alone, so they ignore it. That asymmetry is
 * carried over from the original chain rather than tidied, because the CoT
 * files really are shaped that way.
 */
export function meguminCotForMode(modeId, lang = "english") {
    if (!modeId) return null;

    let prefix = null;
    // Megumin Original first: "v10-shura-megumin" is also a "v10-shura".
    if (modeId.includes("megumin")) prefix = modeId.includes("shura") ? "cot-meg-shura" : "cot-meg-ukiyo";
    // Shura next: "v10-shura" contains "v10", and the specific pairing wins.
    // The uncapped variant is the default either way -- the Thinking Cap is a
    // remedy for a model that over-thinks, not something to hand everyone.
    else if (modeId.includes("v10-shura")) prefix = "cot-v10-shura";
    else if (modeId.includes("v10")) prefix = "cot-v10-ukiyo";
    if (!prefix) return null;

    // The V10 CoTs exist in English only, so `lang` no longer changes the answer.
    const id = `${prefix}-english`;
    return models.find(m => m.id === id) ? id : null;
}

/** The CoT entry an engine is written for, or null. */
export function meguminCotEntryForMode(modeId, lang = "english") {
    const id = meguminCotForMode(modeId, lang);
    return id ? models.find(m => m.id === id) || null : null;
}
