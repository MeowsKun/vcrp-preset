// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the scene list, as Megumin Suite V11's 04/11 update has it (its plan 022), without its
// state store. The story writes who is in the scene at the end of every reply, first in
// <Blocks> (V11's rules and template, word for word, data/megumin.js):
//
//   <Scene>
//   Here: Lona, +Mira
//   Remote: Kade
//   </Scene>
//
// and is handed <Known_Names>: every character on file once, in the one spelling to use in
// every block, the scene first (V11's state/names.js). Read from the chat each turn, like the
// carried blocks. Who uses it: the NPC Bank sends the dossiers of everyone in the scene first,
// Existing cast only counts them, Remember every character brings back someone the scene
// lists, and the Bonds template asks for one line per character in <Scene>.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { localProfile } from "../core/state.js";
import { MEGUMIN_V11 } from "../../data/megumin.js";
import { parseScene } from "../state/scene.js";
import { knownNameList, whoIs } from "../state/names.js";
import { vcrpWithoutSwipedReply } from "./generation.js";
import { parseWorldState } from "../blocks/treatments.js";
import { lastBlocksState } from "./blockHistory.js";

/** The blocks whose names the scene list serves: while one is in the stack, it is asked for. */
export const SCENE_NEEDS = ["world", "bonds", "chatter"];
const LOOKBACK = 6;        // replies searched back for the newest scene list
const SOURCE_REPLIES = 30; // replies whose scene lists feed <Known_Names>

/** On by default; the switch is in the BLOCKS tab. */
export const sceneListOn = (p = localProfile) => !(p && p.sceneList && p.sceneList.enabled === false);

/** The scene list is asked for: the switch is on and a block that needs names is in the stack. */
export function sceneWanted(p = localProfile) {
    if (!sceneListOn(p)) return false;
    const order = (p && p.blockStack && p.blockStack.order) || [];
    return SCENE_NEEDS.some(id => order.includes(id));
}

/** V11's rules and the <Scene> lines to fill in, or null while it is not asked for. */
export function sceneBlockRequest(p = localProfile) {
    return sceneWanted(p) ? { rules: MEGUMIN_V11.sceneRules, template: MEGUMIN_V11.sceneTemplate } : null;
}

// The chat's replies, oldest first, a reply being swiped left out.
function replies() {
    try {
        const chat = (((getContext() || {}).chat) || []).filter(m => m && !m.is_system);
        return vcrpWithoutSwipedReply(chat).filter(m => !m.is_user && typeof m.mes === "string");
    } catch (e) { return []; }
}

/** The newest reply's scene list (one of the last few replies), or null. */
export function lastScene() {
    const r = replies();
    for (let i = r.length - 1, seen = 0; i >= 0 && seen < LOOKBACK; i--, seen++) {
        const s = parseScene(r[i].mes);
        if (s) return s;
    }
    return null;
}

/** The names in the newest scene list, Here then Remote, the "+" of someone new dropped. */
export function sceneNames() {
    const s = lastScene();
    return s ? [...s.here, ...s.remote].map(n => n.name) : [];
}

const bodies = (text, tag) => [...String(text || "").matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))].map(m => m[1]);

/** Everyone one World State body names, in the scene or off-screen. */
export function worldStateNames(body) {
    let parsed = null;
    try { parsed = parseWorldState(body); } catch (e) { parsed = null; }
    if (!parsed) return [];
    return [...(parsed.people || []).filter(p => p && !p.isPc), ...(parsed.offscreen || [])]
        .map(p => String((p && p.name) || "").replace(/[*_]/g, "").trim()).filter(Boolean);
}

/** The names on the lines of one Bonds body. */
export function bondsNames(body) {
    const out = [];
    for (const raw of String(body || "").split("\n")) {
        const line = raw.replace(/\*\*|__/g, "").trim();
        const m = line.match(/^[-*•]?\s*\[?([^:[\]|]{2,40}?)\]?\s*:\s*(.+\|.+)$/);
        if (!m || /^\[/.test(line)) continue;
        out.push(m[1].replace(/^\+\s*/, "").trim());
    }
    return out;
}

/**
 * <Known_Names> for the block instructions: every character on file once (the NPC Bank, the
 * last blocks' World State and Bonds, the recent scene lists), written the shortest way that
 * finds only them, those in the scene first. "" while the scene list is not asked for, or
 * nobody is on file yet.
 */
export function knownNamesBlock(p = localProfile) {
    if (!sceneWanted(p)) return "";
    const sources = [];
    const bank = p && p.npcBank;
    if (bank && bank.enabled) {
        for (const n of bank.npcs || []) if (n && n.name) sources.push({ name: n.name, seen: Number(n.messageIndex) || 0 });
    }
    let carried = "";
    try { carried = lastBlocksState(); } catch (e) { carried = ""; }
    for (const b of bodies(carried, "World_State")) for (const n of worldStateNames(b)) sources.push({ name: n, seen: 1e6 });
    for (const b of bodies(carried, "Bonds")) for (const n of bondsNames(b)) sources.push({ name: n, seen: 1e6 });
    const r = replies();
    for (let i = Math.max(0, r.length - SOURCE_REPLIES); i < r.length; i++) {
        const s = parseScene(r[i].mes);
        if (!s) continue;
        for (const n of [...s.here, ...s.remote]) sources.push({ name: n.name, seen: 1e6 + i });
    }
    const list = knownNameList(sources, { first: sceneNames() });
    return list.length ? `<Known_Names>\n${MEGUMIN_V11.knownNamesLead}\n${list.join(", ")}\n</Known_Names>` : "";
}

/**
 * The NPC Bank records the newest scene list names (by V11's name finder: a first name, a
 * nickname, a name in brackets), as indexes into `npcs`.
 */
export function npcsInScene(npcs) {
    const names = sceneNames();
    if (!names.length || !Array.isArray(npcs) || !npcs.length) return [];
    const people = {};
    npcs.forEach((n, i) => { if (n && n.name) people[`n${i}`] = { name: n.name, aliases: Array.isArray(n.aliases) ? n.aliases : [] }; });
    const out = new Set();
    for (const name of names) {
        const k = whoIs(people, name, { nickname: true });
        if (k) out.add(Number(k.slice(1)));
    }
    return [...out];
}
