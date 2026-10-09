// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Dialogue Colors that stay put.
//
// The Dialogue Colors add-on asks the model to give every character one color for the
// whole story, and models forget: a character is blue in one reply and pink in the next.
// So VCRP remembers instead. Each colored line names its speaker (the add-on asks for
// <font color="#HEX" title="Name">), and:
//   - the first color a character speaks in is theirs for the chat (chat_metadata);
//   - every turn, the model is told the colors already taken (with the add-on's own rule,
//     after the chat, never cached);
//   - a reply that gives a known character another color is corrected as it arrives.
// A line without a name is left as the model wrote it.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, updateMessageBlock } from "../st.js";
import { localProfile } from "../core/state.js";

const META = "vcrp_colors";
const LIMIT = 40;   // names listed to the model at most

const colorOn = () => Boolean(localProfile && Array.isArray(localProfile.addons) && localProfile.addons.includes("color"));
const key = name => String(name || "").trim().toLowerCase();
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The chat's locked colors, as { key: { name, color } }. */
export function lockedColors() {
    const m = chat_metadata && chat_metadata[META];
    return m && typeof m === "object" && m.names && typeof m.names === "object" ? m.names : {};
}

// <font …> opening tags, with their color and title, wherever they sit in the text.
const FONT_OPEN = /<font\b([^>]*)>/gi;
const attr = (attrs, name) => { const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : ""; };

/**
 * One reply: learns the colors of characters seen for the first time, and puts a known
 * character's own color back where the model gave them another. Returns the corrected text
 * and whether it changed. `names` is updated in place.
 */
export function lockReplyColors(text, names) {
    let changed = false;
    // Thinking is the model's own scratch space: leave it alone.
    const thinkEnd = String(text).search(/<\/think(?:ing)?\s*>/i);
    const from = thinkEnd >= 0 ? thinkEnd : 0;
    const head = String(text).slice(0, from), tail = String(text).slice(from);
    const out = tail.replace(FONT_OPEN, (tag, attrs) => {
        const name = attr(attrs, "title");
        const color = attr(attrs, "color");
        if (!name || !HEX.test(color)) return tag;
        const k = key(name);
        const known = names[k];
        if (!known) { names[k] = { name, color: color.toLowerCase() }; return tag; }
        if (known.color === color.toLowerCase()) return tag;
        changed = true;
        return tag.replace(/(\bcolor\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${known.color}"`);
    });
    return { text: head + out, changed };
}

/** What the add-on's rule gets every turn: the colors already taken. "" when none. */
export function colorLockNote() {
    if (!colorOn()) return "";
    const list = Object.values(lockedColors()).slice(-LIMIT);
    if (!list.length) return "";
    return `\n- Colors already taken in this story (use exactly these for these characters, and give anyone new a color not on this list): ${list.map(n => `${n.name} ${n.color}`).join("; ")}.`;
}

/**
 * MESSAGE_RECEIVED: learn and enforce on the reply that just arrived. Runs early, with the
 * dash cleaner, so everything after it sees the corrected text.
 */
export function vcrpDialogueColorsOnReply(messageId, type) {
    if (type === "first_message" || !colorOn() || !chat_metadata) return;
    const chat = (getContext() || {}).chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || !/<font\b/i.test(msg.mes)) return;
    if (!chat_metadata[META] || typeof chat_metadata[META] !== "object") chat_metadata[META] = { names: {} };
    if (!chat_metadata[META].names) chat_metadata[META].names = {};
    const { text, changed } = lockReplyColors(msg.mes, chat_metadata[META].names);
    if (!changed) return;
    msg.mes = text;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = text;
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) { console.warn("[VCRP] Dialogue colors: could not redraw message", id, e); }
}
