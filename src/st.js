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
// The quiet prompt is wrapped below (both ways of naming its text accepted, and a time limit).
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

// A background call that never comes back (a phone that slept mid-request, a provider that
// hung) would otherwise hold whatever its caller keeps while it waits: "a summary is
// running", "an audit is running", a parked job. After this long the call is given up on:
// it rejects like any failed request, the caller's cleanup runs, and a late answer is ignored.
export const QUIET_TIMEOUT_MS = 6 * 60 * 1000;
let quietTimeoutMs = QUIET_TIMEOUT_MS;
/** For tests: a shorter wait (the default when called with nothing). */
export function setQuietTimeout(ms) { quietTimeoutMs = Number(ms) > 0 ? Number(ms) : QUIET_TIMEOUT_MS; }

/**
 * SillyTavern's generateQuietPrompt, with { prompt } and { quietPrompt } both accepted (the
 * call sites use either), and given up on after QUIET_TIMEOUT_MS.
 * @param {object|string} params
 * @returns {Promise<string>}
 */
export async function generateQuietPrompt(params = {}) {
    if (typeof params === "string") params = { quietPrompt: params, prompt: params };
    else if (params && typeof params === "object") {
        const text = params.quietPrompt ?? params.prompt ?? "";
        params = { ...params, quietPrompt: text, prompt: text };
    }
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`a background call got no answer in ${Math.round(quietTimeoutMs / 60000) || 1} minutes (timed out)`);
            err.name = "TimeoutError";
            reject(err);
        }, quietTimeoutMs);
    });
    try {
        return await Promise.race([stGenerateQuietPrompt(params), timeout]);
    } finally {
        clearTimeout(timer);
    }
}
