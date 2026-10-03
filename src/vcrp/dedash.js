// ──────────────────────────────────────────────────────────────────────────────
// Dash cleaner: takes em dashes out of each new reply.
//
// Claude leans on em dashes hard, and a prompt rule alone does not hold them back.
// Every dash that survives lands in the chat history, the model copies the
// history's style, and they multiply. Cleaning each reply as it arrives keeps the
// history clean, which is what actually breaks the habit.
//
// Narration: a dash becomes a comma. Speech: an ellipsis, which is how a stammer
// or a restart reads anyway. The one dash that stays is a cut-off, a spoken line
// that ends on it ("Wait, I didn't—").
//
// Only prose is touched. The thinking, the tracker, the blocks, HTML and code keep
// their dashes: several blocks parse "Name — rank" lines, and tag attributes can
// hold "--".
//
// English stories only. Russian, Spanish, Polish and others mark dialogue with
// dashes, and turning those into commas would wreck the text. Paused on the Megumin
// Original engines, whose whole point is to write the way Megumin does.
// ──────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext, saveChat, updateMessageBlock, eventSource, event_types } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { meguminAllBlockTags } from "../features/blocks/registry.js";
import { meguminOriginalActive } from "../engine/meguminOriginal.js";
import { escapeRegex } from "../utils/regex.js";

// Regions whose whole body is left alone. Block tags are added per call, since
// custom blocks bring their own.
const PROTECTED_TAGS = ["think", "thinking", "ksc", "Story_Tracker", "Blocks", "details", "div", "table", "pre", "code", "style", "script"];

// A dash in prose: em dash (and its long cousins), en dash, two or more hyphens,
// or a lone hyphen with a space after it. Arrows ("-->", "<--") are not dashes.
const DASH = /[ \t]*(?:[—―⸺⸻]+|–+|(?<!<)-{2,}(?!>)|-(?=[ \t]))[ \t]*/g;
const ANY_DASH = /[–—―⸺⸻]|--|[ \t]-[ \t]|\w-["”»]/;
// A horizontal rule line: ---, ***, ———, "* * *".
const RULE_LINE = /^\s*(?:[-–—_*=]\s*){3,}$/;
const MARK = /(\d+)/g;
const HAS_MARK = /\d+/;

function insideQuote(before) {
    let inside = false;
    for (const ch of before) {
        if (ch === '"') inside = !inside;
        else if (ch === "“" || ch === "«") inside = true;
        else if (ch === "”" || ch === "»") inside = false;
    }
    return inside;
}

function cleanLine(line) {
    if (RULE_LINE.test(line)) return line;
    // A hyphen standing in for a cut-off ("Wait-") becomes the real thing.
    line = line.replace(/(\w)-(?=["”»])/g, "$1—");
    return line.replace(DASH, (m, offset, whole) => {
        const core = m.trim();
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + m.length);
        // A lone hyphen is a dash only between words: not a list bullet, not "well- known".
        if (core === "-" && (!/^[ \t]/.test(m) || before.trim() === "")) return m;
        // A number range keeps its dash: 10–20, 9—5.
        if (m === core && core.length === 1 && /\d$/.test(before) && /^\d/.test(after)) return m;

        const inQuote = insideQuote(before);
        // The one dash that stays: a spoken line cut off.
        if (inQuote && (/^["”»]/.test(after) || after.trim() === "")) return "—";
        // Opening a line or a quote: just drop it.
        if (before.trim() === "" || (inQuote && /["“«]$/.test(before))) return "";
        // Already followed or preceded by punctuation: no new punctuation needed.
        if (/^[,.;:!?…)\]]/.test(after)) return "";
        // A closing *italic* or _emphasis_ mark counts as punctuation too; an opening one does not.
        if (/^[*_]+(?=$|\s|[,.;:!?"”])/.test(after)) return "";
        if (/[,;:.!?…]$/.test(before)) return " ";
        // Narration trailing off at the end of a line.
        if (after.trim() === "") return "...";
        return inQuote ? "... " : ", ";
    });
}

/**
 * The text with its dashes cleaned. Pure: no SillyTavern state, so the tests can
 * feed it strings. `blockTags` are the reply's block tags, left alone like the thinking.
 */
export function dedashText(text, blockTags = []) {
    if (typeof text !== "string" || !ANY_DASH.test(text)) return text;
    const kept = [];
    const keep = s => { kept.push(s); return `${kept.length - 1}`; };

    let t = text;
    // A reply that starts inside the thinking (a prefill) has a closer with no opener.
    t = t.replace(/^(?:(?!<(?:think|thinking|ksc)\b)[\s\S])*?<\/(?:think|thinking|ksc)\s*>/i, keep);
    t = t.replace(/```[\s\S]*?(?:```|$)/g, keep);
    t = t.replace(/<!--[\s\S]*?(?:-->|$)/g, keep);
    for (const tag of [...PROTECTED_TAGS, ...blockTags]) {
        const e = escapeRegex(tag);
        t = t.replace(new RegExp(`<${e}\\b[^>]*>[\\s\\S]*?<\\/${e}\\s*>`, "gi"), keep);
        // An opener with no closer (a reply cut off mid-block) protects the rest.
        t = t.replace(new RegExp(`<${e}\\b[^>]*>[\\s\\S]*$`, "i"), keep);
    }
    t = t.replace(/`[^`\n]*`/g, keep);
    // What is left of the markup (<font color="...">, <b>) keeps its attributes, and
    // its quote marks stop counting as speech.
    t = t.replace(/<[^>\n]*>/g, keep);

    t = t.split("\n").map(cleanLine).join("\n");
    // Masks can hold masks (a code fence inside a block), so restore until none are left.
    while (HAS_MARK.test(t)) t = t.replace(MARK, (_, i) => kept[Number(i)]);
    return t;
}

export function vcrpDashCleanerOn() {
    const gs = extension_settings[extensionName] && extension_settings[extensionName].globalSettings;
    return !gs || gs.cleanDashes !== false;
}

export function vcrpStoryIsEnglish() {
    const l = localProfile && typeof localProfile.userLanguage === "string" ? localProfile.userLanguage.trim() : "";
    return l === "" || /^(english|en)$/i.test(l);
}

/** Cleans one AI message in place, current swipe included. True when anything changed. */
function cleanMessage(msg, blockTags, allSwipes = false) {
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return false;
    let changed = false;
    const cleaned = dedashText(msg.mes, blockTags);
    if (cleaned !== msg.mes) { msg.mes = cleaned; changed = true; }
    if (Array.isArray(msg.swipes)) {
        msg.swipes = msg.swipes.map((s, i) => {
            if (typeof s !== "string") return s;
            if (i === msg.swipe_id) return msg.mes;
            if (!allSwipes) return s;
            const c = dedashText(s, blockTags);
            if (c !== s) changed = true;
            return c;
        });
    }
    return changed;
}

function redraw(id, msg) {
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) {
        console.warn("[VCRP] Dash cleaner: could not redraw message", id, e);
    }
}

/**
 * MESSAGE_RECEIVED: clean the reply that just arrived. Runs before VCRP's other
 * reply handlers, so the tracker capture and Story Memory see the cleaned text.
 * The greeting is the card author's text and is left alone.
 */
export function vcrpDedashOnReply(messageId, type) {
    if (type === "first_message" || !vcrpDashCleanerOn() || !vcrpStoryIsEnglish()) return;
    // Megumin Original engines write the way Megumin does, dashes included.
    if (meguminOriginalActive()) return;
    const chat = getContext().chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (cleanMessage(msg, meguminAllBlockTags())) redraw(id, msg);
}

/** Every reply in the open chat, every swipe. Returns how many messages changed. */
export async function vcrpDedashChat() {
    const chat = getContext().chat || [];
    const tags = meguminAllBlockTags();
    let changed = 0;
    for (let i = 0; i < chat.length; i++) {
        if (!cleanMessage(chat[i], tags, true)) continue;
        changed++;
        redraw(i, chat[i]);
        // Lets the block cards and Story Memory's dimming redraw over the new text.
        await eventSource.emit(event_types.MESSAGE_UPDATED, i);
    }
    if (changed) {
        const ctx = getContext();
        await (typeof ctx.saveChat === "function" ? ctx.saveChat() : saveChat());
    }
    return changed;
}
