// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Gemini JB add-on's reply handlers (Megumin Suite V11, 04/11).
//
// The add-on asks the model for a ^ before every word of the reply. They come out
// of the reply as soon as it lands, before every handler that reads its text (the
// cut, the blocks, the dash cleaner, the captures, Story Memory), and out of an
// edited reply. The pure part is src/engine/caretWords.js; the words the model is
// sent are V11's (data/megumin.js), placed by buildBaseDict.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, saveChat, updateMessageBlock } from "../st.js";
import { localProfile } from "../core/state.js";
import { usesCaretWords, stripMessageCarets } from "../engine/caretWords.js";

/** True while the Gemini JB add-on is on for this character. */
export const geminiJbOn = () => usesCaretWords(localProfile);

// A reply already drawn (streaming) is redrawn with the clean text; one not drawn yet
// (SillyTavern draws it after MESSAGE_RECEIVED) is drawn clean the first time.
function redraw(id, msg) {
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(Number(id), msg);
    } catch (e) { console.warn("[VCRP] Gemini JB: could not redraw message", id, e); }
}

/**
 * MESSAGE_RECEIVED: the ^ come out of the reply that just arrived, and of the swipe it shows.
 * SillyTavern saves the chat after this event. The greeting is the card's text, left alone.
 */
export function vcrpCaretOnReply(messageId, type) {
    if (type === "first_message" || !geminiJbOn()) return;
    const chat = getContext().chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (stripMessageCarets(msg)) redraw(id, msg);
}

/** MESSAGE_EDITED: an edit keeps no ^ either, so the blocks read clean text. */
export async function vcrpCaretOnEdit(messageId) {
    if (!geminiJbOn()) return;
    const chat = getContext().chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!stripMessageCarets(msg)) return;
    redraw(id, msg);
    try { await saveChat(); } catch (e) { console.warn("[VCRP] Gemini JB: could not save the chat", e); }
}
