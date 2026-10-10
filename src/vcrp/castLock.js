// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Existing cast only. A per-chat switch (VCRP Quick) for scenes that should stay with
// the characters and threads already in the story: while it is on, every reply is told not
// to introduce anyone new.
//
// It goes out after the newest message (the slot the presets already have, [[pura_late]]),
// after Pura's randomisers, so it overrides the ones that can call for someone new (Grounded
// Complication's third party, Chaos Mode's unexpected arrival, the Director's Cut's
// intruder): an existing character takes that part instead. Pura's Name Randomiser, which
// only names new NPCs, is not sent while it is on. Unnamed background people may still be
// scenery. The model is reminded who is already in the story: the card's character (or the
// group), you, and the NPC Bank. Replies and Continue only; never Impersonate (your turn).
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata } from "../st.js";
import { localProfile } from "../core/state.js";

const META = "vcrp_cast_lock";   // { enabled }
const ROSTER_LIMIT = 40;

export const CAST_LOCK_HEADER = "### Existing cast only";

/** This chat's switch. */
export function castLockOn() {
    const m = chat_metadata && chat_metadata[META];
    return Boolean(m && m.enabled);
}

export function setCastLock(on) {
    if (!chat_metadata) return;
    chat_metadata[META] = { enabled: !!on };
    try { saveMetadata(); } catch (e) { console.warn("[VCRP] Existing cast only: could not save", e); }
}

/** Who is already in the story: the card's character (or the group), {{user}}, the NPC Bank. */
export function castRoster() {
    const names = [];
    let ctx = null;
    try { ctx = getContext(); } catch (e) { ctx = null; }
    if (ctx) {
        const group = ctx.groupId && (ctx.groups || []).find(g => g.id === ctx.groupId);
        if (group) (group.members || []).forEach(av => { const ch = (ctx.characters || []).find(c => c.avatar === av); if (ch && ch.name) names.push(ch.name); });
        else if (typeof ctx.name2 === "string" && ctx.name2) names.push(ctx.name2);
        if (typeof ctx.name1 === "string" && ctx.name1) names.push(ctx.name1);
    }
    const bank = localProfile && localProfile.npcBank;
    if (bank && bank.enabled) (bank.npcs || []).forEach(n => { if (n && n.name) names.push(n.name); });
    const seen = new Set();
    return names.map(n => String(n).trim()).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, ROSTER_LIMIT);
}

/** What goes out for this generation kind, without leading blank lines; "" when off. */
export function castLockText(gen = "reply") {
    if ((gen !== "reply" && gen !== "continue") || !castLockOn()) return "";
    const roster = castRoster();
    return [
        CAST_LOCK_HEADER,
        "For this stretch of the story the reader wants it to stay with the characters already in it. Do not introduce any new character: no newcomers, strangers, arrivals, rivals or new names, in person or by message. Unnamed background people may exist only as scenery: they do not speak, act on the plot or draw the focus.",
        "Drive the scene through the characters, threads and developments already established. This overrides anything above that calls for someone new (a randomiser, a complication, a twist): give that part to an existing character, or leave it out.",
        roster.length ? `Characters already in the story include: ${roster.join(", ")} (and anyone else who has already appeared).` : "",
    ].filter(Boolean).join("\n");
}
