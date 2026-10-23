// ─────────────────────────────────────────────────────────────────────────────
// VCRP: characters on file. Someone who walks out and comes back ninety messages later
// comes back as they left (after Megumin Suite V11's World State and Bonds).
//
// The blocks the model reads each turn are the last reply's (blockHistory.js), and a
// character no longer in the scene drops out of them: their outfit, mood and agenda in the
// World State, their numbers in Bonds. So when the newest message or the last reply names
// someone who is not in those blocks, their last World State entry and Bonds line are found
// in the chat (newest first, the cut part of a long chat included: Story Memory only takes
// it out of the prompt) and sent with the block instructions, after the chat, never cached.
// Nothing is sent when nobody returns. Pura's trackers already carry each character's
// newest entry from the whole chat, and the NPC Bank carries its dossiers.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { localProfile } from "../core/state.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import { parseWorldState } from "../blocks/treatments.js";
import { lastBlocksState } from "./blockHistory.js";
import { vcrpWithoutSwipedReply } from "./generation.js";
import { storyProse } from "./notebook/model.js";

const WINDOW = 400;      // replies searched back, at most
const MAX_PEOPLE = 5;    // characters sent at most
const MAX_LEN = 360;     // characters of one record

/** On by default; the switch is in the BLOCKS tab. */
export const castMemoryOn = () => !(localProfile && localProfile.castMemory && localProfile.castMemory.enabled === false);

const NAME_WORD = /\p{Lu}[\p{L}'’-]{2,}/gu;
const first = name => (String(name || "").match(/[\p{L}'’-]+/u) || [""])[0].toLowerCase();
const clip = s => (s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s);
const bodies = (text, tag) => [...String(text || "").matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))].map(m => m[1]);
// The reply's story: no thinking, no blocks, no Author's Notebook (written in the blocks or
// outside them: a hidden truth that names someone is not the story naming them).
const prose = text => storyProse(text);

/** The NPCs of one World State body: [{ name, fields: "Label: value | …" }]. */
function worldPeople(body) {
    let parsed = null;
    try { parsed = parseWorldState(body); } catch (e) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.people)) return [];
    return parsed.people.filter(p => p && p.name && !p.isPc)
        .map(p => ({ name: String(p.name).trim(), fields: p.fields.filter(f => f.value).map(f => (f.label ? `${f.label}: ${f.value}` : f.value)).join(" | ") }))
        .filter(p => p.fields);
}

/** Everyone one World State body names, in the scene or offscreen (the last blocks still carry them). */
function worldNames(body) {
    let parsed = null;
    try { parsed = parseWorldState(body); } catch (e) { parsed = null; }
    if (!parsed) return [];
    return [...(parsed.people || []), ...(parsed.offscreen || [])].map(p => String((p && p.name) || "").replace(/[*_]/g, "").trim()).filter(Boolean);
}

/** The lines of one Bonds body: [{ name, line }], the reasons in brackets left out. */
function bondsLines(body) {
    const out = [];
    for (const raw of String(body || "").split("\n")) {
        const line = raw.replace(/\*\*|__/g, "").trim();
        const m = line.match(/^[-*•]?\s*\[?([^:[\]|]{2,40}?)\]?\s*:\s*(.+\|.+)$/);
        if (!m || /^\[/.test(line)) continue;
        out.push({ name: m[1].trim(), line: m[2].replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim() });
    }
    return out;
}

/** The note for this turn's block instructions, or "" when no one returns. */
export function castMemoryNote() {
    if (!castMemoryOn()) return "";
    const ids = new Set(meguminActiveBlocks().map(b => b && b.id));
    const world = ids.has("world"), bonds = ids.has("bonds");
    if (!world && !bonds) return "";

    let all = [];
    try { all = ((getContext() || {}).chat) || []; } catch (e) { return ""; }
    const chat = vcrpWithoutSwipedReply(all);
    const user = String(((getContext() || {}).name1) || "");

    // Who the last blocks already carry.
    const carried = lastBlocksState();
    const present = new Set();
    for (const b of bodies(carried, "World_State")) for (const n of worldNames(b)) { present.add(n.toLowerCase()); present.add(first(n)); }
    for (const b of bodies(carried, "Bonds")) for (const l of bondsLines(b)) { present.add(l.name.toLowerCase()); present.add(first(l.name)); }

    // Who the newest message and the last reply name.
    let lastUser = "", lastReply = "";
    for (let i = chat.length - 1; i >= 0 && (!lastUser || !lastReply); i--) {
        const m = chat[i];
        if (!m || m.is_system || typeof m.mes !== "string") continue;
        if (m.is_user && !lastUser) lastUser = m.mes;
        else if (!m.is_user && !lastReply) lastReply = prose(m.mes);
    }
    const named = new Set([...`${lastUser}\n${lastReply}`.matchAll(NAME_WORD)].map(m => m[0].toLowerCase()));
    for (const w of user.match(/[\p{L}'’-]+/gu) || []) named.delete(w.toLowerCase());
    if (!named.size) return "";
    const back = name => (named.has(first(name)) || named.has(String(name).toLowerCase())) && !present.has(String(name).toLowerCase()) && !present.has(first(name));

    // Their last records, newest first.
    const found = new Map();   // first name -> { name, world, bonds }
    let seen = 0;
    for (let i = chat.length - 1; i >= 0 && seen < WINDOW; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
        seen++;
        if (![...named].some(n => m.mes.toLowerCase().includes(n))) continue;
        const at = all.indexOf(m);
        const note = (name) => {
            const k = first(name);
            if (!found.has(k)) found.set(k, { name, world: null, bonds: null });
            return found.get(k);
        };
        if (world) for (const b of bodies(m.mes, "World_State")) for (const p of worldPeople(b)) {
            if (!back(p.name)) continue;
            const r = note(p.name);
            if (!r.world) r.world = { at, text: p.fields };
        }
        if (bonds) for (const b of bodies(m.mes, "Bonds")) for (const l of bondsLines(b)) {
            if (!back(l.name)) continue;
            const r = note(l.name);
            if (!r.bonds) r.bonds = { at, text: l.line };
        }
    }
    const people = [...found.values()].filter(r => r.world || r.bonds).slice(0, MAX_PEOPLE);
    if (!people.length) return "";
    const lines = people.map(r => {
        const out = [`- ${r.name}${r.world ? ` (#${r.world.at}): ${clip(r.world.text)}` : ":"}`];
        if (r.bonds) out.push(`  Bonds (#${r.bonds.at}): ${clip(r.bonds.text)}`);
        return out.join("\n");
    });
    return `Characters on file: named again now, but not in the blocks above, as they were last recorded. When they appear, write them from here unless the story has changed them since.\n${lines.join("\n")}`;
}
