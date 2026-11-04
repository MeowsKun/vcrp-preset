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
import { localProfile } from "../core/state.js";
import { vcrpWithoutSwipedReply, vcrpGenerationKind } from "./generation.js";
import { meguminActiveBlocks, MEGUMIN_BLOCK_REGISTRY } from "../features/blocks/registry.js";
import { puraEntries } from "../features/blocks/puraBlocks.js";
import { puraTidyBlocks, puraTidyText } from "./pura/tidy.js";
import { normalizeCustomBlock, customTagsToKeep, customBlockTags } from "./customBlocks.js";

// VCRP: the custom blocks (one list for every character, core/profile.js).
const customList = () => (localProfile && localProfile.blockStack && localProfile.blockStack.custom) || [];
// A custom block whose last copy is carried with the block instructions ("Carried forward").
const carriedCustom = b => b.builtin || normalizeCustomBlock(b).memory === "info";

const BLOCKS_PAIRED = /\s*<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi;
const BLOCKS_OPEN = /\s*<Blocks\b[^>]*>[\s\S]*$/i;   // a reply cut off inside its blocks

// VCRP: an Author's Notebook block the model wrote outside the envelope goes the same way,
// so the notebook is never in the history whichever way it was written.
const NOTEBOOK_LOOSE = /\s*<(Notebook|Notebook_Update)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
// A reply the length limit cut off inside a tag ("<Notebook_Up", "<Blo") ends on its start: that goes too.
const TAG_CUT = /\s*<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?$/;
const strip = s => String(s).replace(BLOCKS_PAIRED, "").replace(BLOCKS_OPEN, "").replace(NOTEBOOK_LOOSE, "").replace(TAG_CUT, "");

/**
 * Removes <Blocks> from every assistant message in the prompt except a trailing one (a
 * reply being continued, or a prefill). Changes the messages in place. A Pura tracker an
 * older reply wrote in its story goes with them (vcrp/pura/tidy.js), the same every turn.
 */
export function stripHistoryBlocks(messages) {
    if (!Array.isArray(messages)) return;
    const last = messages.length - 1;
    const pura = puraTidyBlocks();
    // VCRP: a custom block on "Stays in the chat" keeps its copies (Megumin V11): taken out of
    // the envelope first and put back at the end of the reply, the same every turn. The copies
    // come from the chat itself, not from the prompt: the preset's "Blocks cleanup" regex has
    // already taken the whole envelope out of every reply three deep when the prompt gets
    // here, the kept block with it.
    const keepRe = customTagsToKeep(customList()).map(t => new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, "gi"));
    const keptFromChat = keepRe.length ? keptCopiesByMessage(messages, keepRe) : null;
    // Whoever takes a reply's blocks out, it must end the same every turn. The preset's own
    // "Blocks cleanup" regex reaches replies three deep and leaves the blank lines before the
    // blocks; this strip took them too. So a reply ended "…prose" for two turns and
    // "…prose\n\n" from the third: its text changed, and the cache missed from it on. Every
    // older reply ends at its last character now, either way.
    const clean = (s, i) => {
        const t = pura.length ? puraTidyText(s, { blocks: pura }).text : s;
        const own = keepRe.flatMap(re => String(t).match(re) || []);
        const kept = keptFromChat && keptFromChat.has(i) ? keptFromChat.get(i) : own;
        // A kept block written loose (outside the envelope) is taken out of its place too, so it
        // stands once, at the end.
        let out = strip(t);
        for (const re of keepRe) out = out.replace(re, "");
        out = out.replace(/\s+$/, "");
        return kept.length ? `${out}\n\n${kept.join("\n")}` : out;
    };
    messages.forEach((m, i) => {
        if (!m || m.role !== "assistant" || i === last) return;
        if (typeof m.content === "string") {
            m.content = clean(m.content, i);
        } else if (Array.isArray(m.content)) {
            m.content = m.content.map(p => (p && p.type === "text" && typeof p.text === "string") ? { ...p, text: clean(p.text, i) } : p);
        }
    });
}

// The kept copies ("Stays in the chat") of each reply in the prompt, read from the chat: the
// prompt's replies are the newest of the chat's, in order (SillyTavern drops the oldest, Story
// Memory hides the summarized ones, a swiped-away reply is in neither), so they are matched
// from the end. A trailing assistant message is a prefill, or the reply being continued (then
// it is the chat's newest). Returns a Map of prompt index → copies; a reply the chat cannot be
// matched to keeps what its own text holds.
function keptCopiesByMessage(messages, keepRe) {
    const out = new Map();
    let chat = [];
    try { chat = ((getContext() || {}).chat || []).filter(m => m && !m.is_system); } catch (e) { return out; }
    let replies = vcrpWithoutSwipedReply(chat).filter(m => !m.is_user && typeof m.mes === "string");
    const last = messages.length - 1;
    const trailing = messages[last] && messages[last].role === "assistant";
    let kind = "reply";
    try { kind = vcrpGenerationKind(); } catch (e) { kind = "reply"; }
    if (trailing && kind === "continue") replies = replies.slice(0, -1);
    const prompt = messages.map((m, i) => ({ m, i })).filter(x => x.m && x.m.role === "assistant" && !(trailing && x.i === last));
    const offset = replies.length - prompt.length;
    if (offset < 0) return out;
    prompt.forEach((x, j) => {
        const src = replies[offset + j];
        if (src) out.set(x.i, keepRe.flatMap(re => src.mes.match(re) || []));
    });
    return out;
}

const LOOKBACK_REPLIES = 6;   // how far back a reply without blocks is looked past

// One reply's complete blocks, minus any that only hold that reply's own note (Pura's Notes);
// "" when it has none.
function blocksOf(mes) {
    const found = String(mes || "").match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi);
    if (!found) return "";
    let state = found[found.length - 1].trim();
    const transient = MEGUMIN_BLOCK_REGISTRY.filter(b => b.transient && b.tag);
    if (!transient.some(b => state.includes(`<${b.tag}`))) return state;
    for (const b of transient) state = state.replace(new RegExp(`\\s*<${b.tag}\\b[^>]*>[\\s\\S]*?<\\/${b.tag}\\s*>`, "gi"), "");
    return /<Blocks\b[^>]*>\s*<\w/i.test(state) ? state : "";
}

// The blocks that hold the story's state, written in full every reply. One a reply left out, or
// was cut off inside, would otherwise be missing from the blocks handed to the next reply, which
// writes its own from them and leaves it out again: so its newest complete copy stands in.
const STATE_BLOCKS = ["world", "bonds", "sheet", "tracker"];

// A reply without its thinking (a model may draft its blocks there); "" when it is all thinking.
function storyPart(mes) {
    const s = String(mes || "");
    if (/<think(?:ing)?\b[^>]*>/i.test(s) && !/<\/think(?:ing)?\s*>/i.test(s)) return "";
    let at = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(s)) !== null) at = m.index + m[0].length;
    return s.slice(at);
}

/**
 * The state blocks `state` lacks, or holds an older copy of than a newer reply cut off later
 * on, put in from the newest reply that has them whole. Returns { state, filled: [{ label, back }] }.
 */
// VCRP: a custom block on "Carried forward" is filled the same way, from further back: one
// written "Every few replies" has its last copy up to that many replies behind.
const LOOKBACK_CUSTOM = 60;

function fillStateBlocks(state, back, replies, repliesLong = replies) {
    let active = [];
    try { active = meguminActiveBlocks().filter(b => b && b.tag && !b.transient); } catch (e) { active = []; }
    const filled = [];
    for (const b of active) {
        const customInfo = !b.builtin && carriedCustom(b);
        if (!STATE_BLOCKS.includes(b.id) && !customInfo) continue;
        const pool = customInfo ? repliesLong : replies;
        // A renamed custom block's old tags count as it too.
        const alt = (b.builtin ? [b.tag] : customBlockTags(normalizeCustomBlock(b))).join("|");
        const whole = new RegExp(`<(${alt})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
        let found = null;
        for (let i = 0; i < pool.length && !found; i++) {
            const all = storyPart(pool[i].mes).match(whole);
            if (all) found = { text: all[all.length - 1].trim(), back: i };
        }
        if (!found) continue;
        const has = new RegExp(`<(?:${alt})\\b`, "i").test(state);
        if (has && found.back >= back) continue;   // the blocks' own copy is the newest
        if (!state) state = "<Blocks>\n</Blocks>";
        if (has) {
            state = state.replace(new RegExp(`<(${alt})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "i"), () => found.text);
        } else {
            // In its place in the stack: before the first later block that is there.
            const later = active.slice(active.indexOf(b) + 1).map(x => state.search(new RegExp(`<${x.tag}\\b`, "i"))).filter(i => i >= 0);
            const at = later.length ? Math.min(...later) : state.search(/<\/Blocks\s*>\s*$/i);
            state = `${state.slice(0, at)}${found.text}\n${state.slice(at)}`;
        }
        filled.push({ label: b.label || b.tag, back: found.back });
    }
    return { state, filled };
}

/**
 * The latest complete blocks, as { state, back, filled }: from the latest reply, or, when it
 * wrote none (the length limit cut it off before them, or the model left them out), from the
 * latest one of the few before it that did, `back` replies earlier. A state block missing from
 * them, or cut off in a newer reply, comes from the newest reply that has it whole (`filled`).
 * A reply being swiped does not count.
 */
export function lastBlocksInfo() {
    let chat = [];
    try { chat = ((getContext() || {}).chat || []).filter(m => !m.is_system); } catch (e) { return { state: "", back: 0, filled: [] }; }
    const all = [...vcrpWithoutSwipedReply(chat)].reverse().filter(m => !m.is_user && typeof m.mes === "string");
    const replies = all.slice(0, LOOKBACK_REPLIES);
    let state = "", back = 0;
    for (let i = 0; i < replies.length; i++) {
        state = blocksOf(replies[i].mes);
        if (state) { back = i; break; }
    }
    const whole = Boolean(state);
    if (!whole) back = 0;
    return { back, whole, ...fillStateBlocks(state, whole ? back : replies.length, replies, all.slice(0, LOOKBACK_CUSTOM)) };
}

/** The latest complete blocks, or "" when none of the last few replies has any. */
export function lastBlocksState() {
    return lastBlocksInfo().state;
}

// Last turn's blocks, only those still in the stack: a block taken out (or every block, the
// Author's Notebook riding alone) is not handed back as the state to carry forward. "" when
// none is left.
function onlyActive(state) {
    // VCRP: a custom block that starts fresh or stays in the chat is not carried (Megumin V11);
    // a renamed one's old tags still count as it.
    const tags = new Set(meguminActiveBlocks().filter(b => b && carriedCustom(b))
        .flatMap(b => (b.builtin ? [b.tag] : customBlockTags(normalizeCustomBlock(b))))
        .map(t => String(t || "").toLowerCase()).filter(Boolean));
    const m = String(state || "").match(/^(<Blocks\b[^>]*>)([\s\S]*?)(\s*<\/Blocks\s*>)$/i);
    if (!m) return state;
    const inner = m[2].replace(/\s*<([A-Za-z]\w*)\b[^>]*>[\s\S]*?<\/\1\s*>/g, (x, tag) => (tags.has(tag.toLowerCase()) ? x : ""));
    return /<\w/.test(inner) ? `${m[1]}${inner}${m[3]}` : "";
}

/** The latest complete blocks, only those still in the stack ("" when none is left). */
export function activeBlocksState() {
    return onlyActive(lastBlocksState());
}

/** What the per-turn block instructions add: last turn's blocks, as the starting point. */
export function previousBlocksNote() {
    const carried = carriedTrackerNote();
    const info = lastBlocksInfo();
    let state = onlyActive(info.state);
    // The trackers that carry their state are in their own section below, newest of each
    // from the whole chat; listing last turn's copy too would send them twice.
    if (state && carried) {
        for (const b of carriedBlocks()) state = state.replace(new RegExp(`\\s*<${b.tag}\\b[^>]*>[\\s\\S]*?<\\/${b.tag}\\s*>`, "gi"), "");
        if (!/<Blocks\b[^>]*>\s*<\w/i.test(state)) state = "";
    }
    const parts = [];
    const head = !info.whole ? "The blocks as your recent replies last wrote each one whole (none of them closed all of its blocks)."
        : info.back ? "The blocks as they stood at the end of an earlier reply (your last reply did not write them whole)."
            : "The blocks as they stood at the end of your last reply.";
    // A block that reply left out or was cut off in: said where it comes from, and asked for whole.
    const filled = info.filled || [];
    const from = filled.length ? ` Not written whole there, so each is its newest whole copy: ${filled.map(f => `${f.label} (${f.back ? `${f.back} ${f.back === 1 ? "reply" : "replies"} back` : "from your last reply"})`).join(", ")}. Write every block in full this reply.` : "";
    if (state) parts.push(`${head}${from} Write this reply's blocks from there: carry forward what this scene does not change.\n${state}`);
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
