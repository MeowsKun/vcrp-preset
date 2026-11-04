/* eslint-disable no-undef */
// ─────────────────────────────────────────────────────────────────────────────
// SillyTavern import shim.
//
// ST's modules are reached by relative path, so the number of "../" depends on
// how deep the importing file sits. Every file under src/ importing ST directly
// would have to count levels correctly, and every file MOVED between folders
// would silently break. This module counts once, from src/, and re-exports.
//
// Rule: nothing under src/ imports from ST directly. Import from here instead
// (or from "../st.js", "../../st.js", ... as depth requires — that path is a
// path inside OUR tree, so it moves with the file and is easy to fix).
// ─────────────────────────────────────────────────────────────────────────────

export { extension_settings, getContext } from "../../../../extensions.js";

// SillyTavern's saveChat() refuses a group chat (it throws). saveChatConditional saves either
// kind (what getContext().saveChat does), so it is what "saveChat" means below (V11's 04/11 fix).
// The quiet prompt is wrapped below: while a helper job runs on its own connection
// (vcrp/helper/index.js), every quiet prompt goes there instead.
import {
    saveSettingsDebounced,
    generateQuietPrompt as stGenerateQuietPrompt,
    event_types,
    eventSource,
    substituteParams,
    saveChatConditional as saveChat,
    reloadCurrentChat,
    addOneMessage,
    getRequestHeaders,
    appendMediaToMessage,
    updateMessageBlock,
    chat_metadata,
    saveMetadata,
    isGenerating,
} from "../../../../../script.js";

export {
    saveSettingsDebounced,
    event_types,
    eventSource,
    substituteParams,
    saveChat,
    reloadCurrentChat,
    addOneMessage,
    getRequestHeaders,
    appendMediaToMessage,
    updateMessageBlock,
    chat_metadata,
    saveMetadata,
    isGenerating,
};

export { saveBase64AsFile, debounce, cancelDebounce } from "../../../../utils.js";
export { humanizedDateTime } from "../../../../RossAscends-mods.js";
export { Popup, POPUP_TYPE } from "../../../../popup.js";
// VCRP: the World Info a background call is given (vcrp/lore.js). Read off the module rather
// than imported by name: a name SillyTavern does not export would stop the whole extension
// from loading, where this way an older SillyTavern only means no lore (null, lore.js).
import * as worldInfo from "../../../../world-info.js";
export const checkWorldInfo = typeof worldInfo.checkWorldInfo === "function" ? worldInfo.checkWorldInfo : null;
export const getSortedEntries = typeof worldInfo.getSortedEntries === "function" ? worldInfo.getSortedEntries : null;

// While a helper job runs on its own connection profile, vcrp/helper/index.js points every
// quiet prompt here at it. Null the rest of the time.
let quietRoute = null;
export function setQuietRoute(fn) { quietRoute = typeof fn === "function" ? fn : null; }

/**
 * SillyTavern's generateQuietPrompt, with { prompt } and { quietPrompt } both accepted (the
 * call sites use either), and the helper's route when one is set.
 * @param {object|string} params
 * @returns {Promise<string>}
 */
export async function generateQuietPrompt(params = {}) {
    if (typeof params === "string") params = { quietPrompt: params, prompt: params };
    else if (params && typeof params === "object") {
        const text = params.quietPrompt ?? params.prompt ?? "";
        params = { ...params, quietPrompt: text, prompt: text };
    }
    if (quietRoute) return await quietRoute(params.quietPrompt);
    return await stGenerateQuietPrompt(params);
}
