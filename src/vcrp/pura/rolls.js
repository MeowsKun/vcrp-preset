// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what Pura's randomisers rolled, reply by reply.
//
// Pura's scene randomisers (Dead Dove Escalation, Chaos Mode, the Kink randomiser …), the
// random voice and the Name Randomiser are {{random}} lists. SillyTavern rolls them as the
// prompt goes out and nobody sees the result. On a real reply VCRP rolls them itself (the
// same uniform pick) and, when the reply arrives, adds what came up to its Notes tab: out
// of the story, out of the history and out of the next turn's blocks.
//
// The latest reply's rolls are kept with the chat, so:
//   - a Continue keeps the random voice the reply was written in (it used to roll a new one
//     mid-reply);
//   - with "Swipes keep the rolls" on, a swipe or regenerate of that reply rolls nothing
//     new: the same escalation, twist and voice, written again.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, updateMessageBlock } from "../../st.js";
import { rollRandoms, pickLabel } from "./macros.js";

const META = "vcrp_rolls_last";
export const ROLLS_HEAD = "🎲 Rolled this reply";

let pending = null;   // { rolls, index } from the reply being written, until it arrives at that index

/** A roller for one prompt build: rolls each list (reusing `reuse[key]`'s indices) and keeps what came up. */
export function rollSession(reuse = {}) {
    const rolls = [];
    return {
        rolls,
        roll(key, label, text) {
            const r = rollRandoms(text, { reuse: reuse[key] || [] });
            if (r.picks.length) rolls.push({ key, label, picks: r.picks.map(p => ({ index: p.index, text: pickLabel(p.text) })) });
            return r.text;
        },
    };
}

/** The kept rolls of the reply at chat index `index`, as indices to pick again per list; {} when none. */
export function rollsReuseFor(index) {
    const last = chat_metadata && chat_metadata[META];
    if (!last || last.index !== index || !Array.isArray(last.rolls)) return {};
    return Object.fromEntries(last.rolls.map(r => [r.key, (r.picks || []).map(p => p.index)]));
}

/**
 * The rolls a reply is being written with (set as its prompt is built; [] when none), and the
 * chat index it will land at. Only the reply arriving there takes them: after a request that
 * failed, a Continue of the reply before it must not.
 */
export function setPendingRolls(rolls, index = null) { pending = Array.isArray(rolls) ? { rolls, index } : null; }
export const pendingRolls = () => pending;

/** The Notes lines for a reply's rolls. */
export function rollsNote(rolls) {
    return [ROLLS_HEAD, ...rolls.flatMap(r => [`${r.label}:`, ...r.picks.map(p => `- ${p.text}`)])].join("\n");
}

/**
 * `mes` with its rolls in its Notes tab (the tab and the envelope made when missing). Null
 * when the reply was cut off inside its blocks: the rolls wait for the Continue that ends it.
 */
export function withRollsNote(mes, rolls) {
    const s = String(mes || "");
    if (!rolls || !rolls.length || s.includes(ROLLS_HEAD)) return s;
    let split = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(s)) !== null) split = m.index + m[0].length;
    const head = s.slice(0, split), tail = s.slice(split);
    if (/<think(?:ing)?\b[^>]*>/i.test(tail)) return null;   // cut while thinking: wait, like a cut-off block
    const count = r => (tail.match(r) || []).length;
    if (count(/<Blocks\b[^>]*>/gi) > count(/<\/Blocks\s*>/gi) || count(/<Pura_\w+\b[^>]*>/gi) > count(/<\/Pura_\w+\s*>/gi)) return null;
    const note = rollsNote(rolls);
    let out;
    if (/<Pura_Notes\b[^>]*>/i.test(tail)) out = tail.replace(/(<Pura_Notes\b[^>]*>)/i, (all, open) => `${open}\n${note}\n`);
    else if (/<\/Blocks\s*>/i.test(tail)) {
        const at = tail.search(/<\/Blocks\s*>(?![\s\S]*<\/Blocks\s*>)/i);
        out = `${tail.slice(0, at).replace(/\s+$/, "")}\n<Pura_Notes>\n${note}\n</Pura_Notes>\n${tail.slice(at)}`;
    } else out = `${tail.replace(/\s+$/, "")}\n\n<Blocks>\n<Pura_Notes>\n${note}\n</Pura_Notes>\n</Blocks>`;
    return head + out;
}

/**
 * MESSAGE_RECEIVED (after the tidy): the reply that was just written gets its rolls, kept
 * with the chat for a Continue or a swipe, and shown in its Notes tab when `show`.
 */
export function vcrpPuraRollsOnReply(messageId, type, { show = true } = {}) {
    if (type === "first_message" || !pending) return;
    const chat = (getContext() || {}).chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return;
    if (Number.isInteger(pending.index) && pending.index !== id) return;
    const { rolls } = pending;
    if (chat_metadata) chat_metadata[META] = { index: id, rolls };
    if (!rolls.length || !show) { pending = null; return; }
    const text = withRollsNote(msg.mes, rolls);
    if (text === null) return;
    pending = null;
    if (text === msg.mes) return;
    msg.mes = text;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = text;
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) { console.warn("[VCRP] Pura rolls: could not redraw message", id, e); }
}
