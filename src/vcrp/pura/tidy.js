// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Pura's trackers back in their blocks.
//
// Pura's trackers are blocks here, each written in its own tag inside <Blocks> and drawn as
// a card. A model sometimes writes one in the story anyway (Pura's own preset puts a sheet
// right after an NPC's introduction and the scene at the top), where nothing draws it: a
// raw [NPC:MAJOR|…] … [/NPC] in the prose. And a Pura engine says some things out of
// character (the Kink randomiser asks it to), which land in the story as ((OOC: …)).
//
// So a reply is tidied as it arrives, before anything else reads it:
//   - an entry of a Pura tracker in the stack, written in the story, moves into that
//     tracker's tag inside <Blocks> (the tag and the envelope are made when missing, and an
//     entry the tag already has is not added twice);
//   - a Pura tracker's whole tag written outside <Blocks> moves inside it;
//   - with a Pura engine, a ((OOC: …)) moves to the Notes tab, unless the reader's own
//     message was out of character (then it is the answer, and stays in the story).
// Thinking is never touched. Older replies get the same tidy on their way to the model
// (stripHistoryBlocks), so a sheet left in an old reply's prose stops showing the model
// the wrong place, and leaves the history with the rest of the blocks.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, updateMessageBlock } from "../../st.js";
import { isPuraEngine } from "../../core/engines.js";
import { activeEngine } from "../../engine/meguminOriginal.js";
import { meguminActiveBlocks } from "../../features/blocks/registry.js";
import { PURA_NOTES_BLOCK, setPuraEngineOn } from "../../features/blocks/puraBlocks.js";

const puraEngineOn = () => { try { return isPuraEngine(activeEngine()); } catch (e) { return false; } };
setPuraEngineOn(puraEngineOn);

// Pura: "Do not add [/NPC] to this." A quick reference and a relationship change are one line.
const HEADER_ONLY = new Set(["NPC:REF", "NPC:REL"]);
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const family = marker => String(marker).split(":")[0];
const squash = s => String(s).replace(/\s+/g, " ").trim().toLowerCase();

/** The Pura trackers in the stack, the ones the tidy looks for. */
export function puraTidyBlocks() {
    return meguminActiveBlocks().filter(b => b && b.group === "pura" && Array.isArray(b.markers) && b.markers.length);
}

// Where the reply's own text starts: after its last </think>.
function afterThinking(text) {
    let at = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(text)) !== null) at = m.index + m[0].length;
    return at;
}

// An entry as it goes into its block: without the bold a model may wrap its header or closing
// tag in, and with the closing tag Pura's card needs when the model forgot it.
function entryText(raw, fam, closed) {
    const t = String(raw).trim()
        .replace(/^([ \t]*)(?:\*\*|__)(?=\[)/gm, "$1")
        .replace(/(\])(?:\*\*|__)([ \t]*)$/gm, "$1$2");
    return closed || HEADER_ONLY.has(fam) ? t : `${t}\n[/${fam}]`;
}

// One tracker's entries in a stretch of story text, as [{ start, end, body }]: from the header
// ([NPC:MAJOR|Name], or a bare [NPC]) to its [/NPC]. A header must start its line, the way
// Pura writes them: "[TIME]" inside a sentence is the story's own text. With no closing tag,
// a header alone on its line takes the lines under it, to the next blank line. A quick
// reference or a relationship change ([NPC:REF|…], [NPC:REL|…]) is one bracket, wherever it
// sits, and only with its fields.
function strayEntries(text, block) {
    const markers = [...new Set([...block.markers, ...block.markers.map(family)])];
    const re = new RegExp(`\\[(${markers.map(escRe).join("|")})(\\|[^\\]\\n\\r]*)?\\]`, "g");
    const heads = [];
    let m;
    while ((m = re.exec(text)) !== null) heads.push({ at: m.index, end: m.index + m[0].length, marker: m[1], fields: Boolean(m[2]) });
    const startsLine = at => /^[ \t]*(?:\*\*|__)?$/.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));
    return heads.map((h, i) => {
        if (HEADER_ONLY.has(h.marker)) return h.fields ? { start: h.at, end: h.end, body: text.slice(h.at, h.end) } : null;
        if (!startsLine(h.at)) return null;
        const rest = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : text.length);
        const fam = family(h.marker);
        const close = rest.search(new RegExp(`\\[\\/${escRe(fam)}\\]`));
        if (close >= 0) {
            const end = h.end + close + fam.length + 3;
            return { start: h.at, end, body: entryText(text.slice(h.at, end), fam, true) };
        }
        if (!/^(?:\*\*|__)?[ \t]*(?:\r?\n|$)/.test(rest)) return null;
        const blank = rest.search(/\n[ \t]*\r?\n/);
        const end = h.end + (blank >= 0 ? blank : rest.length);
        return { start: h.at, end, body: entryText(text.slice(h.at, end), fam, false) };
    }).filter(Boolean);
}

// Some tag in `tags` opened in this text and never closed: a reply cut off mid-block.
const opensUnclosed = (text, tags) => tags.some(tag =>
    (String(text).match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) || []).length > (String(text).match(new RegExp(`<\\/${tag}\\s*>`, "gi")) || []).length);

// A whole <Tag>…</Tag>, as [{ start, end, body }].
function tagSpans(text, tag) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length, body: m[1] });
    return out;
}

// ((OOC: …)), as [{ start, end, body }] (the body without the (( )) and the "OOC:").
function oocSpans(text) {
    const re = /\(\(\s*OOC\b\s*:?\s*([\s\S]*?)\s*\)\)/gi;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length, body: m[1] });
    return out;
}

// The text without the spans, and what they held.
function cut(text, spans) {
    const pieces = [];
    let out = "", from = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
        if (s.start < from) continue;
        pieces.push(String(s.body ?? text.slice(s.start, s.end)).trim());
        let kept = text.slice(from, s.start);
        from = s.end;
        // Inside a sentence: one space where the entry was, not two.
        const gap = text.slice(from).match(/^[ \t]+/);
        if (gap && /[ \t]$/.test(kept)) { kept = kept.replace(/[ \t]+$/, " "); from += gap[0].length; }
        out += kept;
    }
    return { text: out + text.slice(from), pieces: pieces.filter(Boolean) };
}

// What a move leaves behind: a code fence or bold markers with nothing in them, blank lines.
const tidyProse = s => String(s)
    .replace(/^[ \t]*```[\w-]*[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*```[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:\*{2,4}|_{2,4})[ \t]*$/gm, "")
    .replace(/(?:[ \t]*\r?\n){3,}/g, "\n\n");

/**
 * One reply, tidied: stray entries and tags of the Pura trackers in `blocks` into their tags
 * inside <Blocks>, and with `notes`, ((OOC: …)) into the Notes tab. Returns
 * { text, changed, moved }, `moved` counting what left the story per tag.
 */
export function puraTidyText(text, { blocks = [], notes = false } = {}) {
    const src = String(text ?? "");
    const none = { text: src, changed: false, moved: {} };
    if (!blocks.length && !notes) return none;
    const split = afterThinking(src);
    const head = src.slice(0, split), tail = src.slice(split);
    // Thinking opened and never closed (the length limit cut it): all of it is thinking.
    if (/<think(?:ing)?\b[^>]*>/i.test(tail)) return none;

    // The envelope, closed or cut off; the story is everything around it.
    const env = tail.match(/<Blocks\b[^>]*>[\s\S]*?(?:<\/Blocks\s*>|$)/i);
    let envText = env ? env[0] : "";
    let pre = env ? tail.slice(0, env.index) : tail;
    let post = env ? tail.slice(env.index + envText.length) : "";
    const tags = [...blocks.map(b => b.tag), ...(notes ? [PURA_NOTES_BLOCK.tag] : [])];

    // A reply cut off inside its blocks is left as it is: anything moved would land inside
    // the unfinished block. A Continue finishes it, and the tidy runs on the finished reply.
    if (env && !/<\/Blocks\s*>$/i.test(envText)) return none;
    if (opensUnclosed(pre, tags) || opensUnclosed(post, tags)) return none;

    const found = new Map();
    const sweep = (tag, spansOf) => {
        const a = cut(pre, spansOf(pre)), b = cut(post, spansOf(post));
        pre = a.text; post = b.text;
        const pieces = [...a.pieces, ...b.pieces];
        if (pieces.length) found.set(tag, [...(found.get(tag) || []), ...pieces]);
    };
    // Whole tags first, so the entries inside one are not taken twice.
    for (const tag of tags) sweep(tag, s => tagSpans(s, tag));
    for (const b of blocks) sweep(b.tag, s => strayEntries(s, b));
    if (notes) sweep(PURA_NOTES_BLOCK.tag, oocSpans);
    if (!found.size) return none;

    const moved = {};
    let added = "";
    for (const tag of tags.filter(t => found.has(t))) {
        const pieces = found.get(tag);
        moved[tag] = pieces.length;
        const re = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(<\\/${tag}\\s*>)`, "i");
        const existing = envText.match(re);
        const have = squash(existing ? existing[2] : "");
        const fresh = [];
        for (const p of pieces) {
            const k = squash(p);
            if (!k || have.includes(k) || fresh.some(f => squash(f) === k)) continue;
            fresh.push(p);
        }
        if (!fresh.length) continue;
        if (existing) envText = envText.replace(re, (all, open, body, close) => `${open}${body.replace(/\s+$/, "")}\n${fresh.join("\n")}\n${close}`);
        else added += `<${tag}>\n${fresh.join("\n")}\n</${tag}>\n`;
    }
    if (added) {
        if (!envText) envText = `<Blocks>\n${added}</Blocks>`;
        else if (/<\/Blocks\s*>$/i.test(envText)) envText = envText.replace(/\s*(<\/Blocks\s*>)$/i, (all, close) => `\n${added}${close}`);
        else envText = `${envText.replace(/\s+$/, "")}\n${added.replace(/\n$/, "")}`;   // cut off: at its end
    }

    const story = tidyProse(pre).replace(/\s+$/, "");
    const after = tidyProse(post);
    const out = `${story ? `${story}\n\n` : ""}${envText}${after.trim() ? after : ""}`;
    return { text: head + out, changed: out !== tail, moved };
}

/**
 * MESSAGE_RECEIVED: tidy the reply that just arrived. Runs early, with the dash cleaner and
 * Dialogue Colors, so the NPC Bank, Story Memory and the rest read the tidied text.
 */
export function vcrpPuraTidyOnReply(messageId, type) {
    if (type === "first_message") return;
    const blocks = puraTidyBlocks();
    const engine = puraEngineOn();
    if (!blocks.length && !engine) return;
    const chat = (getContext() || {}).chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return;
    // An out-of-character question from the reader gets its answer in the story.
    const reader = chat.slice(0, id).reverse().find(m => m && m.is_user);
    const notes = engine && !(reader && /\(\(|\bOOC\b/i.test(String(reader.mes || "")));
    const { text, changed, moved } = puraTidyText(msg.mes, { blocks, notes });
    if (!changed) return;
    msg.mes = text;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = text;
    console.debug("[VCRP] Pura: moved out of the story into <Blocks>", moved);
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) { console.warn("[VCRP] Pura tidy: could not redraw message", id, e); }
}
