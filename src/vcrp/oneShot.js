// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a direction for the next reply only ("she finally tells him about the ring").
//
// Written in VCRP Quick. It goes out with the next reply, after your newest message (the
// slot the presets already have, [[pura_late]]), framed as for that reply alone, with any
// engine, and it is never written into the chat. When that reply arrives the box empties and
// the direction stays with the reply, so a swipe, regenerate or Continue of it gets the same
// direction again; your next message starts clean. Saved with the chat until it is used.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, debounce } from "../st.js";
import { vcrpGenerationRaw } from "./generation.js";

const META = "vcrp_oneshot";   // { text, used: { text, index } }

export const ONESHOT_HEADER = "### Direction for this reply\nThe reader asks this of this reply only, not as a standing rule:";
const ONESHOT_FOOTER = "Bring it about through the story itself, in a way that fits what has already happened, and never mention this note.";

let pending = null;   // { text, index } sent with the request being answered

export function oneShot() {
    const m = chat_metadata && chat_metadata[META];
    return { text: String((m && m.text) || ""), used: m && m.used && typeof m.used === "object" ? m.used : null };
}

const save = () => { try { saveMetadata(); } catch (e) { console.warn("[VCRP] One-shot direction: could not save", e); } };
const saveSoon = typeof debounce === "function" ? debounce(save, 800) : save;

/** Sets the waiting direction (typing saves shortly after; `soon: false` at once). */
export function setOneShot(text, { soon = false } = {}) {
    if (!chat_metadata) return;
    const cur = chat_metadata[META] && typeof chat_metadata[META] === "object" ? chat_metadata[META] : {};
    chat_metadata[META] = { ...cur, text: String(text || "") };
    (soon ? saveSoon : save)();
}

/**
 * The direction for this request, without leading blank lines; "" when none. `record`: a real
 * request (not a token count or a preview), so the reply that answers it will use it up.
 */
export function oneShotText(gen = "reply", { record = false } = {}) {
    if (gen !== "reply" && gen !== "continue") return "";
    // Each real request starts over: one that failed must not leave its direction waiting.
    if (record) pending = null;
    const chat = ((getContext() || {}).chat) || [];
    const raw = vcrpGenerationRaw();
    // Where the reply lands: a swipe or Continue works on the last message, anything else adds one.
    const index = gen === "continue" || raw === "swipe" ? chat.length - 1 : chat.length;
    const { text, used } = oneShot();
    let send = text.trim();
    // Nothing new waiting: the same reply written again (a swipe, a regenerate, a Continue)
    // gets the direction it was written with.
    if (!send && used && used.index === index && (gen === "continue" || raw === "swipe" || raw === "regenerate")) send = String(used.text || "").trim();
    if (!send) return "";
    if (record) pending = { text: send, index };
    return `${ONESHOT_HEADER}\n${send}\n${ONESHOT_FOOTER}`;
}

/** MESSAGE_RECEIVED: the reply that carried the direction uses it up (kept with that reply). */
export function vcrpOneShotOnReply(messageId, type) {
    if (type === "first_message" || !pending || !chat_metadata) return;
    const id = Number(messageId);
    if (pending.index !== id) return;
    const cur = chat_metadata[META] && typeof chat_metadata[META] === "object" ? chat_metadata[META] : {};
    chat_metadata[META] = { text: String(cur.text || "").trim() === pending.text ? "" : String(cur.text || ""), used: { text: pending.text, index: id } };
    pending = null;
}
