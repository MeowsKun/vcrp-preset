// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a direction for the next reply only ("she finally tells him about the ring").
//
// Written in VCRP Quick. It goes out with the next reply, after your newest message (the
// slot the presets already have, [[pura_late]]), framed as for that reply alone, with any
// engine, and it is never written into the chat. When that reply arrives the box empties and
// the direction stays with the reply, so a swipe, regenerate or Continue of it gets the same
// direction again; your next message starts clean. Saved with the chat until it is used.
//
// A direction for one reply's swipe only (the continuity check's correction, continuity.js)
// is kept apart from the box: it goes with that reply's next swipe beside the direction the
// reply was written with, and whatever waits in the box (your own direction, a beat) stays
// there for your next message.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, debounce } from "../st.js";
import { vcrpGenerationRaw } from "./generation.js";
import { blankReplyKind } from "./blankReply.js";
import { answerOf } from "./pura/rolls.js";

const META = "vcrp_oneshot";   // { text, used: { text, index, answers }, once: { text, index, answers } }

export const ONESHOT_HEADER = "### Direction for this reply\nThe reader asks this of this reply only, not as a standing rule:";
const ONESHOT_FOOTER = "Bring it about through the story itself, in a way that fits what has already happened, and never mention this note.";

let pending = null;   // { text, index, once } sent with the request being answered

const stored = () => (chat_metadata && chat_metadata[META] && typeof chat_metadata[META] === "object" ? chat_metadata[META] : {});
const chatNow = () => ((getContext() || {}).chat) || [];

export function oneShot() {
    const m = chat_metadata && chat_metadata[META];
    return { text: String((m && m.text) || ""), used: m && m.used && typeof m.used === "object" ? m.used : null };
}

const save = () => { try { saveMetadata(); } catch (e) { console.warn("[VCRP] One-shot direction: could not save", e); } };
const saveSoon = typeof debounce === "function" ? debounce(save, 800) : save;

/** Sets the waiting direction (typing saves shortly after; `soon: false` at once). */
export function setOneShot(text, { soon = false } = {}) {
    if (!chat_metadata) return;
    chat_metadata[META] = { ...stored(), text: String(text || "") };
    (soon ? saveSoon : save)();
}

/**
 * A direction for the next swipe (or regenerate) of the reply at chat index `index`, and for
 * nothing else: not put in the box, and not used by a new message. "" takes it back.
 */
export function setSwipeDirection(index, text) {
    if (!chat_metadata) return;
    const st = { ...stored() };
    const line = String(text || "").trim();
    if (line) st.once = { text: line, index: Number(index), answers: answerOf(chatNow(), Number(index)) };
    else delete st.once;
    chat_metadata[META] = st;
    save();
}

// The swipe-only direction, when the reply being written again is the one it was set for.
function swipeDirection(index, raw, chat) {
    const o = stored().once;
    if (!o || typeof o !== "object" || o.index !== index || (raw !== "swipe" && raw !== "regenerate")) return "";
    if (o.answers !== undefined && o.answers !== answerOf(chat, index)) return "";
    return String(o.text || "").trim();
}

/**
 * The direction for this request, without leading blank lines; "" when none. `record`: a real
 * request (not a token count or a preview), so the reply that answers it will use it up.
 */
export function oneShotText(gen = "reply", { record = false } = {}) {
    if (gen !== "reply" && gen !== "continue") return "";
    // Each real request starts over: one that failed must not leave its direction waiting.
    if (record) pending = null;
    const chat = chatNow();
    const raw = vcrpGenerationRaw();
    // Where the reply lands: a swipe or Continue works on the last message, anything else adds one.
    const index = gen === "continue" || raw === "swipe" ? chat.length - 1 : chat.length;
    const { text, used } = oneShot();
    // The direction this same reply was written with, when it is being written again (a swipe,
    // a regenerate, a Continue).
    const own = used && used.index === index && (used.answers === undefined || used.answers === answerOf(chat, index))
        && (gen === "continue" || raw === "swipe" || raw === "regenerate") ? String(used.text || "").trim() : "";
    const once = gen === "reply" ? swipeDirection(index, raw, chat) : "";
    let send = text.trim();
    // A swipe-only direction goes beside the reply's own (which may hold it already, from an
    // earlier swipe), and the box is left for the next message. Otherwise the box, and with
    // nothing new waiting in it the reply's own.
    if (once) send = own ? (own.includes(once) ? own : `${own}\n\n${once}`) : once;
    else if (!send) send = own;
    if (!send) return "";
    if (record) pending = { text: send, index, once: !!once };
    return `${ONESHOT_HEADER}\n${send}\n${ONESHOT_FOOTER}`;
}

/** Another chat is open: a direction sent in the last one is never this one's to use up. */
export function forgetOneShotPending() { pending = null; }

/** MESSAGE_RECEIVED: the reply that carried the direction uses it up (kept with that reply). */
export function vcrpOneShotOnReply(messageId, type) {
    if (type === "first_message" || !pending || !chat_metadata) return;
    const id = Number(messageId);
    if (pending.index !== id) return;
    // A blank reply (Gemini's filter, a cut) did not answer the direction: it stays for the swipe.
    const got = chatNow()[id];
    if (got && blankReplyKind(got.mes)) return;
    const cur = stored();
    const box = String(cur.text || "");
    // The box empties when it is what went out; a swipe-only direction never touched it. That
    // one is spent either way: it was for this swipe.
    chat_metadata[META] = {
        text: pending.once ? box : (box.trim() === pending.text ? "" : box),
        used: { text: pending.text, index: id, answers: answerOf(chatNow(), id) },
    };
    pending = null;
}
