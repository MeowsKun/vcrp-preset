// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the helper model's settings (Megumin Suite V11's Chomusuke, in VCRP's terms).
//
// A second connection that does the background work so the story model writes only the
// story: the blocks after each reply, and the occasional jobs (Story Memory summaries,
// Focus audits, the Story Director, NPC scans, the ban list scan, the writing-style
// generator). One setup for every character, kept in the global settings. This module only
// reads them: which jobs go to the helper, and which blocks it writes. The sending is in
// index.js, the blocks job in blocks.js, the tab in ui.js.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings } from "../../st.js";
import { extensionName } from "../../core/constants.js";

/** The helper is the story's own connection: its jobs run as before, one at a time. */
export const CURRENT_CONNECTION = "__current__";

// What the helper can do. A job that costs a call on every reply says so (perReply).
export const HELPER_JOBS = [
    {
        key: "blocks", title: "Blocks", icon: "fa-cubes", color: "#f43f5e", perReply: true, defaultOn: true,
        desc: "Writes the blocks after each reply (the scene list, World State, Bonds, the sheets, your custom blocks): the story model is no longer asked for them, so all of its reply goes to the story and none of its blocks come back cut off. One helper call per reply.",
    },
    {
        key: "memory", title: "Story Memory summaries", icon: "fa-memory", color: "#3b82f6", defaultOn: false,
        desc: "Summarises each stretch of the chat into a chapter and its facts, and checks it. Your story model reads the stretch from its cache for a few cents; the helper reads it fresh. Keep it with the story model unless the helper is much cheaper.",
    },
    {
        key: "focus", title: "Focus audits", icon: "fa-crosshairs", color: "#eab308", defaultOn: false,
        desc: "Reads the recent replies for drift, repeated motifs and slop, every few replies. A close reading: a strong model does it better.",
    },
    { key: "director", title: "Story Director", icon: "fa-clapperboard", color: "#a855f7", defaultOn: true, desc: "Writes and evolves the story's next direction." },
    { key: "npc", title: "NPC Bank scans and updates", icon: "fa-address-book", color: "#10b981", defaultOn: true, desc: "Scans the story for new characters, and re-reads one character's record when you ask." },
    { key: "banList", title: "Dynamic Ban List scan", icon: "fa-ban", color: "#ef4444", defaultOn: true, desc: "Finds the phrases the story keeps repeating." },
    { key: "styleGen", title: "Writing style generator", icon: "fa-wand-magic-sparkles", color: "#ec4899", defaultOn: true, desc: "Writes a writing style from your tags." },
    // Two small questions asked only of the helper (helper/aside.js): without one they do not run.
    {
        key: "continuity", title: "Continuity check", icon: "fa-scale-balanced", color: "#f59e0b", perReply: true, defaultOn: true, helperOnly: true,
        desc: "Reads each reply against this chat's Canon sheet and the scene as it stood, and puts a line under a reply that contradicts them, with a one-tap corrected swipe. A few thousand tokens in, a line or two out, on every reply. Only the helper does it: without one, no check runs.",
    },
    {
        key: "recall", title: "Recall picks", icon: "fa-magnifying-glass", color: "#06b6d4", perReply: true, defaultOn: true, helperOnly: true, ownProfile: true,
        desc: "Before a reply, picks which old chapters Story Memory brings back, from their one-line gists and your newest messages, so a scene that returns to something in other words still finds it. Waits four seconds at most, then falls back to matching words. Needs a helper connection of its own.",
    },
];

/** The settings, made whole: { enabled, profileId, testedProfileId, jobs, blockRoutes }. */
export function helperSettings() {
    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    const gs = s.globalSettings || (s.globalSettings = {});
    if (!gs.helper || typeof gs.helper !== "object") gs.helper = {};
    const h = gs.helper;
    if (typeof h.enabled !== "boolean") h.enabled = false;
    if (typeof h.profileId !== "string") h.profileId = "";
    if (typeof h.testedProfileId !== "string") h.testedProfileId = "";
    if (!h.jobs || typeof h.jobs !== "object") h.jobs = {};
    if (!h.blockRoutes || typeof h.blockRoutes !== "object") h.blockRoutes = {};
    return h;
}

/** Is this job switched to the helper (its own switch, or the job's default)? */
export function helperJobWanted(key) {
    const h = helperSettings();
    const j = HELPER_JOBS.find(x => x.key === key);
    const onCurrent = h.profileId === CURRENT_CONNECTION;
    // Asked while the story's own connection is busy with the reply: only a connection of its
    // own can answer it (`ownProfile`).
    if (j && j.ownProfile && onCurrent) return false;
    if (typeof h.jobs[key] === "boolean") return h.jobs[key];
    // A question only the helper is asked (`helperOnly`) is on by default on a connection of
    // its own. On the story's connection it would be one more call on the story model with
    // every reply, which nobody asked for: there it waits to be ticked.
    if (j && j.helperOnly && onCurrent) return false;
    return j ? j.defaultOn : false;
}

/** The helper is on with a connection picked, and this job goes to it. */
export function helperJobOn(key) {
    const h = helperSettings();
    return Boolean(h.enabled && h.profileId) && helperJobWanted(key);
}

/** The helper writes the blocks after each reply. */
export const helperRoutesBlocks = () => helperJobOn("blocks");

/** A block the helper can write: in the stack, written every turn; not the Notebook's, not the scene list (it goes with them). */
export function routableBlock(b) {
    return Boolean(b && b.tag && !b.transient && !b.slot && !b.lead && !b.carry && !b.scene && b.group !== "notebook");
}

/** This block goes to the helper (while the helper writes the blocks; each block has a tick). */
export function helperBlockRouted(id) {
    if (!helperRoutesBlocks()) return false;
    return helperSettings().blockRoutes[id] !== false;
}
