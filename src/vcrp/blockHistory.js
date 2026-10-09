// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the <Blocks> of earlier replies, kept out of the history.
//
// The preset's "Blocks cleanup" regex strips a reply's blocks only from depth 3 on, so the
// latest reply kept them in the prompt for one turn and lost them the next. Its text
// changed between two requests in a row, and everything from it onward missed the cache:
// on a long chat, thousands of tokens written again at double price on every request.
//
// So every reply in the history goes to the model without its blocks (bar a reply being
// continued, which is still being written), and the latest reply's blocks travel with the
// per-turn block instructions instead ([[blocks]], after the chat), where they still tell
// the model what the trackers and stats said last turn.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpWithoutSwipedReply } from "./generation.js";
import { meguminActiveBlocks } from "../features/blocks/registry.js";
import { puraEntries } from "../features/blocks/puraBlocks.js";

const BLOCKS_PAIRED = /\s*<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi;
const BLOCKS_OPEN = /\s*<Blocks\b[^>]*>[\s\S]*$/i;   // a reply cut off inside its blocks

const strip = s => String(s).replace(BLOCKS_PAIRED, "").replace(BLOCKS_OPEN, "");

/**
 * Removes <Blocks> from every assistant message in the prompt except a trailing one (a
 * reply being continued, or a prefill). Changes the messages in place.
 */
export function stripHistoryBlocks(messages) {
    if (!Array.isArray(messages)) return;
    const last = messages.length - 1;
    messages.forEach((m, i) => {
        if (!m || m.role !== "assistant" || i === last) return;
        if (typeof m.content === "string") {
            if (/<Blocks\b/i.test(m.content)) m.content = strip(m.content);
        } else if (Array.isArray(m.content)) {
            m.content = m.content.map(p => (p && p.type === "text" && /<Blocks\b/i.test(p.text || "")) ? { ...p, text: strip(p.text) } : p);
        }
    });
}

/** The latest reply's blocks, complete, or "" when it has none. A reply being swiped does not count. */
export function lastBlocksState() {
    let chat = [];
    try { chat = ((getContext() || {}).chat || []).filter(m => !m.is_system); } catch (e) { return ""; }
    const reply = [...vcrpWithoutSwipedReply(chat)].reverse().find(m => !m.is_user);
    if (!reply || typeof reply.mes !== "string") return "";
    const found = reply.mes.match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi);
    return found ? found[found.length - 1].trim() : "";
}

/** What the per-turn block instructions add: last turn's blocks, as the starting point. */
export function previousBlocksNote() {
    const carried = carriedTrackerNote();
    let state = lastBlocksState();
    // The trackers that carry their state are in their own section below, newest of each
    // from the whole chat; listing last turn's copy too would send them twice.
    if (state && carried) {
        for (const b of carriedBlocks()) state = state.replace(new RegExp(`\\s*<${b.tag}\\b[^>]*>[\\s\\S]*?<\\/${b.tag}\\s*>`, "gi"), "");
        if (!/<Blocks\b[^>]*>\s*<\w/i.test(state)) state = "";
    }
    const parts = [];
    if (state) parts.push(`The blocks as they stood at the end of your last reply. Write this reply's blocks from there: carry forward what this scene does not change.\n${state}`);
    if (carried) parts.push(carried);
    return parts.join("\n\n");
}

// ── Trackers that carry their state (Pura's) ──────────────────────────────────
// Most of Pura's trackers are written only when something changes, so last turn's blocks
// are not the whole picture: an event opened ten replies ago is still pending, and a
// relationship card last shown an hour ago is still where it stands. Read from the whole
// chat, the newest entry of each goes with the block instructions every turn, after the
// chat (so the cache never sees it). See the `carry` notes in features/blocks/puraBlocks.js.

const CARRY_LIMIT = 10;     // entries per tracker at most
const NAMES_LIMIT = 40;

const carriedBlocks = () => meguminActiveBlocks().filter(b => b && b.carry && b.tag && b.markers);

/** The newest entries that still hold, per carrying block: [{ block, entries, names }]. */
export function carriedTrackerState() {
    const blocks = carriedBlocks();
    if (!blocks.length) return [];
    let chat = [];
    try { chat = vcrpWithoutSwipedReply(((getContext() || {}).chat || []).filter(m => !m.is_system)); } catch (e) { return []; }
    const replies = chat.filter(m => !m.is_user && typeof m.mes === "string" && m.mes.includes("<Pura_"));
    return blocks.map(block => {
        const c = block.carry;
        const markers = c.markers || block.markers;
        const tagRe = new RegExp(`<${block.tag}\\b[^>]*>([\\s\\S]*?)(?:<\\/${block.tag}\\s*>|$)`, "gi");
        const all = [];
        for (const m of replies) {
            let hit;
            tagRe.lastIndex = 0;
            while ((hit = tagRe.exec(m.mes)) !== null) all.push(...puraEntries(hit[1], markers));
        }
        if (!all.length) return null;
        if (c.mode === "single") return { block, entries: [all[all.length - 1]] };
        if (c.mode === "recent") return { block, entries: all.slice(-(c.count || 5)) };
        if (c.mode === "names") {
            const names = [];
            for (const e of all) {
                const name = String(e.fields[1] || "").trim();
                const label = e.marker.startsWith("NPC:") ? `${name} (${(e.marker === "NPC:UP" ? e.fields[2] : e.marker.slice(4)) || ""})`.replace(" ()", "") : name;
                if (!name) continue;
                const at = names.findIndex(n => n.key === name.toLowerCase());
                if (at >= 0) names.splice(at, 1);
                names.push({ key: name.toLowerCase(), label });
            }
            return names.length ? { block, names: names.slice(-NAMES_LIMIT).map(n => n.label) } : null;
        }
        // perKey: the newest entry per subject, minus subjects that ended.
        const latest = new Map();
        for (const e of all) {
            const key = c.key.map(i => String(e.fields[i] || "").trim().toLowerCase()).join("|");
            if (!key.replace(/\|/g, "")) continue;
            latest.delete(key);
            latest.set(key, e);
        }
        const live = [...latest.values()].filter(e => !(c.end && c.end.test(String(e.fields[c.endField] || ""))));
        return live.length ? { block, entries: live.slice(-CARRY_LIMIT) } : null;
    }).filter(Boolean);
}

/** The note itself, or "" when nothing carries. */
export function carriedTrackerNote() {
    const state = carriedTrackerState();
    if (!state.length) return "";
    const sections = state.map(s => s.names
        ? `${s.block.label}: ${s.block.carry.text || "Already written"}: ${s.names.join(", ")}.`
        : `${s.block.label}:\n${s.entries.map(e => e.text).join("\n")}`);
    return `Trackers still in effect, the newest entry of each from this chat (not just your last reply). Carry them forward; write an entry again only when this scene changes it.\n${sections.join("\n\n")}`;
}
