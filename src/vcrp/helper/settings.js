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
];

const jobDefault = key => { const j = HELPER_JOBS.find(x => x.key === key); return j ? j.defaultOn : false; };

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
    return typeof h.jobs[key] === "boolean" ? h.jobs[key] : jobDefault(key);
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
