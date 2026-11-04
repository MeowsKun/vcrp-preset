// ────────────────────────────────────────────────────────────────────────────
// The Gemini JB add-on asks for a ^ before every word of the reply (Megumin Suite
// V11, 04/11). The preset's "clean up" regex hides them in the chat, but the
// blocks, the captures and Story Memory read the saved text, so the reply is
// cleaned as soon as it lands (src/vcrp/geminiJb.js hooks it up).
// Pure: no SillyTavern imports.
// ────────────────────────────────────────────────────────────────────────────

/** True while the Gemini JB add-on is on: the story is asked for ^ before every
 *  word, and gets the [[GeminiJB]] line. */
export const usesCaretWords = p => Boolean(p) && Array.isArray(p.addons) && p.addons.includes("gemini_jb");

export const stripCarets = text => String(text ?? "").replace(/\^/g, "");

/** Removes the ^ from a chat message: its text and the swipe it shows.
 *  Returns true when anything changed. */
export function stripMessageCarets(msg) {
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return false;
    let changed = false;
    if (msg.mes.includes("^")) {
        msg.mes = stripCarets(msg.mes);
        changed = true;
    }
    const i = msg.swipe_id;
    if (Array.isArray(msg.swipes) && typeof msg.swipes[i] === "string" && msg.swipes[i].includes("^")) {
        msg.swipes[i] = stripCarets(msg.swipes[i]);
        changed = true;
    }
    return changed;
}
