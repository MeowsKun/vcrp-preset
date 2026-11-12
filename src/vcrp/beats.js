// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the beat queue. Plot points the reader lines up ahead of time ("the landlord finds
// the letter", "Jonah's boat is found empty"), each sent when its moment comes.
//
// A beat goes out the way a one-shot direction does (oneShot.js): with one reply, after the
// newest message, never written into the chat, kept with that reply so a swipe of it gets the
// same beat. In fact it goes out AS the one-shot direction: firing a beat puts its text in
// VCRP Quick's "Next reply only" box, where the reader can read it, change it or take it out
// before sending. A beat fires on a tap, or by itself once a number of replies have passed
// since it was queued. While the box already holds something (the reader's own direction, or
// another beat), a beat waits its turn. Kept with the chat.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata } from "../st.js";
import { oneShot, setOneShot } from "./oneShot.js";

const META = "vcrp_beats";   // chat_metadata: { items: [{ id, text, dueAt, state, firedAt }], seq }
const MAX_TEXT = 600;
const FIRED_KEPT = 12;

const tidy = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
const save = async () => { try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Beats: could not save the chat's data", e); } };

function state(create = false) {
    if (!chat_metadata) return null;
    let st = chat_metadata[META];
    if ((!st || typeof st !== "object" || !Array.isArray(st.items)) && create) st = chat_metadata[META] = { items: [], seq: 0 };
    return st && Array.isArray(st.items) ? st : null;
}

/** The story's replies so far (the count a beat's "after N replies" runs on). */
export function replyCount() {
    let chat = [];
    try { chat = ((getContext() || {}).chat) || []; } catch (e) { chat = []; }
    return chat.filter(m => m && !m.is_user && !m.is_system).length;
}

/**
 * The queue: { waiting: [{ id, text, dueAt, in }], next, fired: [{ id, text, firedAt }] }.
 * `waiting` in the reader's order; `in`: replies until it fires by itself (null: on a tap
 * only; 0: due). `next`: the beat now in the "Next reply only" box, or null.
 */
export function beatQueue() {
    const st = state();
    const items = st ? st.items : [];
    const now = replyCount();
    return {
        waiting: items.filter(b => b.state === "waiting").map(b => ({ id: b.id, text: b.text, dueAt: b.dueAt || 0, in: b.dueAt > 0 ? Math.max(0, b.dueAt - now) : null })),
        next: (items.find(b => b.state === "next") || null) && { ...items.find(b => b.state === "next") },
        fired: items.filter(b => b.state === "fired").slice(-FIRED_KEPT).reverse().map(b => ({ id: b.id, text: b.text, firedAt: b.firedAt })),
    };
}

/**
 * Queues a beat. `after`: replies from now until it fires by itself (0: on a tap only).
 * `first`: at the head of the queue. Returns the beat, or null for an empty one.
 */
export async function addBeat(text, { after = 0, first = false } = {}) {
    const line = tidy(text);
    const st = state(true);
    if (!line || !st) return null;
    st.seq = (Number(st.seq) || 0) + 1;
    const n = Math.max(0, Math.min(500, Math.round(Number(after)) || 0));
    const beat = { id: `B${st.seq}`, text: line, dueAt: n > 0 ? replyCount() + n : 0, state: "waiting", firedAt: null };
    if (first) st.items.unshift(beat); else st.items.push(beat);
    await save();
    return { ...beat };
}

/** Rewords a waiting beat, or sets when it fires (`after`: replies from now; 0: on a tap). */
export async function editBeat(id, { text, after } = {}) {
    const st = state();
    const b = st && st.items.find(x => x.id === id && x.state === "waiting");
    if (!b) return false;
    if (text !== undefined) { const line = tidy(text); if (!line) return removeBeat(id); b.text = line; }
    if (after !== undefined) { const n = Math.max(0, Math.min(500, Math.round(Number(after)) || 0)); b.dueAt = n > 0 ? replyCount() + n : 0; }
    await save();
    return true;
}

/** Takes a beat out of the queue (one in the box leaves the box too, if it is still as fired). */
export async function removeBeat(id) {
    const st = state();
    const b = st && st.items.find(x => x.id === id);
    if (!b) return false;
    if (b.state === "next" && oneShot().text.trim() === b.text) setOneShot("");
    st.items = st.items.filter(x => x.id !== id);
    await save();
    return true;
}

/** Moves a waiting beat one place up (-1) or down (+1) among the waiting ones. */
export async function moveBeat(id, dir) {
    const st = state();
    if (!st) return false;
    const waiting = st.items.filter(b => b.state === "waiting");
    const at = waiting.findIndex(b => b.id === id);
    const to = at + (dir < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= waiting.length) return false;
    const a = st.items.indexOf(waiting[at]), b = st.items.indexOf(waiting[to]);
    [st.items[a], st.items[b]] = [st.items[b], st.items[a]];
    await save();
    return true;
}

/**
 * Fires a beat: its text goes into the "Next reply only" box. Returns "next" (it rides with
 * the next reply), "held" (the box holds something else: it stays waiting, due at once) or
 * "gone" (no such waiting beat).
 */
export async function fireBeat(id) {
    const st = state();
    const b = st && st.items.find(x => x.id === id && x.state === "waiting");
    if (!b) return "gone";
    if (oneShot().text.trim() || st.items.some(x => x.state === "next")) {
        b.dueAt = Math.max(1, replyCount());   // due now: it goes as soon as the box is free
        await save();
        return "held";
    }
    b.state = "next";
    setOneShot(b.text);
    await save();
    return "next";
}

/** Puts a fired beat back in the queue, waiting for a tap. */
export async function requeueBeat(id) {
    const st = state();
    const b = st && st.items.find(x => x.id === id && x.state === "fired");
    if (!b) return false;
    Object.assign(b, { state: "waiting", dueAt: 0, firedAt: null });
    st.items = [...st.items.filter(x => x !== b), b];
    await save();
    return true;
}

/**
 * After a reply (MESSAGE_RECEIVED, once the one-shot direction has settled its own account):
 * the beat in the box is spent if that reply used it, and back to waiting if the reader took
 * it out or rewrote it; then, the box being free, the first waiting beat whose time has come
 * goes into it for the next reply. Returns the beat it just fired, or null.
 */
export function vcrpBeatsOnReply(messageId, type) {
    if (type === "first_message") return null;
    const st = state();
    if (!st || !st.items.length) return null;
    let changed = false;
    const box = oneShot();
    for (const b of st.items.filter(x => x.state === "next")) {
        if (box.used && String(box.used.text || "").trim() === b.text && box.used.index === Number(messageId)) { b.state = "fired"; b.firedAt = replyCount(); changed = true; }
        // Still in the box: the reply was blank, and the direction waits for the swipe.
        else if (box.text.trim() !== b.text) { Object.assign(b, { state: "waiting", dueAt: 0 }); changed = true; }
    }
    let fired = null;
    if (!oneShot().text.trim() && !st.items.some(x => x.state === "next")) {
        const now = replyCount();
        const due = st.items.find(x => x.state === "waiting" && x.dueAt > 0 && now >= x.dueAt);
        if (due) {
            due.state = "next";
            setOneShot(due.text);
            fired = { ...due };
            changed = true;
            if (typeof toastr !== "undefined") toastr.info(`A beat you queued goes with your next message: "${due.text.slice(0, 120)}${due.text.length > 120 ? "…" : ""}". VCRP Quick → Next reply only shows it; clear it there to hold it back.`, "VCRP: beats", { timeOut: 9000 });
        }
    }
    if (changed) save();
    return fired;
}
