// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Pura's NPC sheets and the NPC Bank, as one system.
//
// Pura's NPC Profile Sheets tracker writes a sheet when a named NPC first appears:
//
//   [NPC:MAJOR|Name]                    [NPC:SUPPORT|Name]          [NPC:MINOR|Name]
//   b: Full Name | Age | Gender | Job   b: Name | Age | Gender | Role   b: Name | Age | Role
//   a: Build | Hair | Eyes | Skin | …   a: Build | Features | Attire    a: Quick description
//   p: Demeanor | Speech | Traits | …   p: Demeanor | Speech | Traits   p: One-line personality
//   h: History | Motivations | Secrets  h: History | Motivation
//   r: Connection | Other Ties          r: Connection | Ties
//
// plus [NPC:UP|Name|NEW_TIER] (an upgrade, with new fields) and [NPC:REL|Name|change].
//
// With the block in the stack:
//   - each new sheet becomes the bank's record, its parts filed under the bank's fields;
//   - an upgrade fills in what the record still lacks (never overwriting), and a
//     relationship change updates "Read on the PC": both in the record's history, so
//     each can be undone from the chat card like the bank's own updates;
//   - Pura is told, every turn, who never gets a sheet (the card's own cast, {{user}},
//     the bank's ignored names) and who the bank already has, and a sheet for one of
//     the former is never filed.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { npcFields } from "../../features/npc/fields.js";
import { npcApplyUpdates, npcFindByName } from "../../features/npc/updates.js";
import { puraEntries, setPuraNpcNames } from "../../features/blocks/puraBlocks.js";

const SHEETS = ["NPC:MAJOR", "NPC:SUPPORT", "NPC:MINOR", "NPC:UP"];
const ROSTER_LIMIT = 40;
const parts = s => String(s || "").split("|").map(p => p.trim()).filter(Boolean);
const line = (text, key) => { const m = String(text).match(new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "mi")); return m ? m[1].trim() : ""; };
const uniq = list => [...new Map(list.filter(Boolean).map(n => [String(n).trim().toLowerCase(), String(n).trim()])).values()].filter(Boolean);

/**
 * Who never gets a sheet (the card's own character, every member of a group, {{user}}, the
 * bank's ignored names), and who the bank already has.
 */
export function puraNpcNames() {
    let ctx = null;
    try { ctx = getContext(); } catch (e) { ctx = null; }
    const skip = [];
    if (ctx) {
        const group = ctx.groupId && (ctx.groups || []).find(g => g.id === ctx.groupId);
        if (group) (group.members || []).forEach(av => { const ch = (ctx.characters || []).find(c => c.avatar === av); if (ch && ch.name) skip.push(ch.name); });
        else if (typeof ctx.name2 === "string") skip.push(ctx.name2);
        if (typeof ctx.name1 === "string") skip.push(ctx.name1);
    }
    const bank = localProfile && localProfile.npcBank;
    if (bank && bank.ignoredNames) skip.push(...String(bank.ignoredNames).split(",").map(s => s.trim()));
    const roster = bank && bank.enabled ? (bank.npcs || []).map(n => n && n.name) : [];
    return { skip: uniq(skip), bank: uniq(roster).slice(-ROSTER_LIMIT) };
}
setPuraNpcNames(puraNpcNames);

/** One sheet's lines as bank fields (only fields the bank has). */
export function puraSheetFields(entry) {
    const tier = entry.marker === "NPC:UP" ? String(entry.fields[2] || "").toUpperCase() : entry.marker.slice(4);
    const b = parts(line(entry.text, "b")), a = line(entry.text, "a"), p = parts(line(entry.text, "p"));
    const h = parts(line(entry.text, "h")), r = parts(line(entry.text, "r"));
    const out = {};
    if (tier === "MINOR") {
        Object.assign(out, { name: b[0], age: b[1], role: b[2], appearance: a, personality: line(entry.text, "p") });
    } else {
        Object.assign(out, {
            name: b[0], age: b[1], sex: b[2], role: b[3],
            appearance: parts(a).join("; "),
            voice: p[1],
            personality: [p[0] && `Demeanor: ${p[0]}`, p[2] && `Traits: ${p[2]}`, p[3] && `Tells: ${p[3]}`].filter(Boolean).join("\n"),
            background: h[0], agenda: h[1], secrets: h[2],
            readOnPc: r[0], innerCircle: r.slice(1).join("; "),
        });
    }
    const have = new Set(npcFields().map(f => f.id));
    return Object.fromEntries(Object.entries(out).filter(([k, v]) => v && have.has(k)));
}

/**
 * Every Pura NPC sheet in a text, as { name, raw, parsed }: the shape the bank's readers
 * take. A sheet for the card's own cast, {{user}} or an ignored name is left out.
 */
export function puraFindNpcSheets(text) {
    if (!text || !String(text).includes("[NPC:")) return [];
    const skip = new Set(puraNpcNames().skip.map(n => n.toLowerCase()));
    return puraEntries(text, SHEETS)
        .map(e => ({ name: String(e.fields[1] || "").replace(/\*\*/g, "").trim(), raw: e.text, parsed: puraSheetFields(e) }))
        .filter(s => s.name && !skip.has(s.name.toLowerCase()));
}

let seq = 0;

/**
 * Pura's upgrades and relationship changes, applied to NPCs already in the bank. Returns
 * { applied, refused } in the shape of npcApplyUpdates, every change in the record's
 * history (so the chat card can undo it).
 */
export function puraApplyNpcChanges(text, { messageIndex = 0 } = {}) {
    const applied = [], refused = [];
    if (!text || !String(text).includes("[NPC:")) return { applied, refused };
    const fields = npcFields();
    const readOnPc = fields.find(f => f.id === "readOnPc" && f.updatable);
    const updates = [];
    for (const e of puraEntries(text, ["NPC:UP", "NPC:REL"])) {
        const name = String(e.fields[1] || "").replace(/\*\*/g, "").trim();
        const npc = name && npcFindByName(name);
        if (!npc) continue;   // a new NPC: the sheet pass files it
        if (e.marker === "NPC:REL") {
            const change = String(e.fields[2] || "").trim();
            if (readOnPc && change) updates.push({ name: npc.name, ops: [{ op: "~", label: readOnPc.label, text: change }] });
            continue;
        }
        // An upgrade adds what a smaller sheet left out; it never overwrites what is on file.
        for (const [id, value] of Object.entries(puraSheetFields(e))) {
            if (id === "name" || !value || String(npc[id] || "").trim()) continue;
            const f = fields.find(x => x.id === id);
            if (!Array.isArray(npc.history)) npc.history = [];
            const entry = { id: `hp${Date.now().toString(36)}${(seq++).toString(36)}`, msgIndex: messageIndex, at: Date.now(), npc: npc.name, field: id, label: f ? f.label : id, op: "~", text: value, before: "" };
            npc[id] = value;
            npc.history.push(entry);
            applied.push(entry);
        }
    }
    if (updates.length) {
        const r = npcApplyUpdates(updates, { messageIndex });
        applied.push(...r.applied);
        refused.push(...r.refused);
    }
    return { applied, refused };
}
