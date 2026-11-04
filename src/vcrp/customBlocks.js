// ─────────────────────────────────────────────────────────────────────────────
// VCRP: custom blocks as Megumin Suite V11's 04/11 update has them (its plan 023), on VCRP's
// own carry instead of its state store. A custom block:
//
//   { id, label, tag, tags: [old tags after a rename], emoji, icon, color, visibility,
//     kind: "text" | "fields", content (free text), fields: [{ id, label, type, max, start,
//     hint, ownLine, desc }], rules (the user's rules for the whole block),
//     memory: "info" | "fresh" | "chat", when: "every" | "changes" | "everyN", everyN }
//
// memory, in VCRP's terms: "info" = its last copy travels with the block instructions after
// the chat, as every block's does (vcrp/blockHistory.js); "fresh" = the story never sees the
// last one; "chat" = its old copies stay in the earlier replies the story reads, while the
// other blocks come out of them. Every character shares one list (core/profile.js).
// Pure: no SillyTavern imports.
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_MEMORY = ["info", "fresh", "chat"];
export const CUSTOM_WHEN = ["every", "changes", "everyN"];

/** Added to the template of a block written "Only when something in it changes" (V11's line). */
export const CUSTOM_CHANGES_LINE = "[Leave this block out when nothing in it changed this turn.]";

/** The rules of a field block on "Starts fresh": it has no old values to start from (V11's line). */
export const CUSTOM_FRESH_FIELDS_LINE = "- Write each value as it stands at the end of this reply.";

/**
 * A block with every setting filled in. A block made before this keeps working as it did:
 * free text, carried forward (VCRP always carried every block), written every reply.
 */
export function normalizeCustomBlock(b) {
    const out = { ...(b || {}) };
    out.kind = out.kind === "fields" ? "fields" : "text";
    out.fields = Array.isArray(out.fields) ? out.fields : [];
    out.tags = Array.isArray(out.tags) ? out.tags.filter(t => t && t !== out.tag) : [];
    out.memory = CUSTOM_MEMORY.includes(out.memory) ? out.memory : "info";
    out.when = CUSTOM_WHEN.includes(out.when) ? out.when : "every";
    // "Only when it changes" needs the story to see what is there.
    if (out.when === "changes" && out.memory === "fresh") out.when = "every";
    const n = Math.round(Number(out.everyN));
    out.everyN = Number.isFinite(n) ? Math.max(2, Math.min(20, n)) : 3;
    out.rules = typeof out.rules === "string" ? out.rules : "";
    return out;
}

/**
 * Adds blocks to the shared list every character picks from (in place, so the list keeps
 * its identity). A block already there (same id) is skipped. A block whose tag another
 * block already uses is added as "Name (2)" with tag Name_2, keeping the old tag so its old
 * copies still read as it.
 * @param {object[]} library  the shared list
 * @param {object[]} blocks   blocks from one character
 * @returns {number} blocks added
 */
export function mergeCustomLibrary(library, blocks) {
    let added = 0;
    const tagTaken = t => library.some(x => String(x.tag || "").toLowerCase() === String(t || "").toLowerCase());
    for (const b of blocks || []) {
        if (!b || !b.id || library.some(x => x.id === b.id)) continue;
        const copy = JSON.parse(JSON.stringify(b));
        if (copy.tag && tagTaken(copy.tag)) {
            let n = 2;
            while (tagTaken(`${b.tag}_${n}`)) n++;
            copy.tags = [...(Array.isArray(copy.tags) ? copy.tags : []), b.tag];
            copy.tag = `${b.tag}_${n}`;
            copy.label = `${b.label || b.tag} (${n})`;
        }
        library.push(copy);
        added++;
    }
    return added;
}

/** The tag and every old tag (after a rename), so old replies still read as this block. */
export function customBlockTags(b) {
    return [b.tag, ...(b.tags || [])].filter(Boolean);
}

/**
 * Is the story asked for this block this turn? `repliesSince` counts the replies already
 * written after its last copy, so the reply about to be written is one more; null when it
 * has none yet.
 */
export function customBlockDue(b, repliesSince) {
    if (b.when !== "everyN") return true;
    if (repliesSince == null) return true;
    return repliesSince + 1 >= b.everyN;
}

/** The tags of the blocks whose copies stay in the chat ("Stays in the chat"). */
export function customTagsToKeep(blocks) {
    return (blocks || []).map(normalizeCustomBlock).filter(b => b.memory === "chat").flatMap(customBlockTags);
}

/**
 * What each field means, as the user wrote it: "- Trust: how much she…". One line each (the
 * template's rules are one bracketed paragraph, so line breaks and square brackets in a
 * description would end it early).
 * @param {object[]} fields  the block's fields ({ label, desc })
 * @returns {string[]}
 */
export function customFieldNotes(fields) {
    return (fields || [])
        .filter(f => f && String(f.label || "").trim() && String(f.desc || "").trim())
        .map(f => `- ${String(f.label).trim()}: ${String(f.desc).replace(/\s+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").trim()}`);
}

/**
 * The user's rules for the whole block, one line each as written. The block's rules sit
 * inside [ ], so their own brackets become round ones.
 */
export function customBlockRules(b) {
    return String((b && b.rules) || "").split(/\r?\n/)
        .map(l => l.replace(/\[/g, "(").replace(/\]/g, ")").trim())
        .filter(Boolean);
}
