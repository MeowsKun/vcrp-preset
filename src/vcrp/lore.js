// ─────────────────────────────────────────────────────────────────────────────
// VCRP: lorebook entries for background calls (after Megumin Suite V11's core/lore.js).
//
// A background call (the Story Director, an NPC scan or update, a Focus audit) replaces
// SillyTavern's prompt with its own, so the World Info the story has active never reached
// it. These fetch it back:
//   loreForChat()      what SillyTavern itself would activate for the recent chat (a dry run:
//                      no timers, no events), up to about 3,000 tokens;
//   loreForNames([..]) every entry whose keys or title name one of these characters (full
//                      name or first name), for a call about one person (an NPC update).
// One install-wide switch: globalSettings.loreInTasks (missing = on). A background call is
// never cached, so its lore is priced with it. Never throws: a lorebook problem just means
// no lore in that call.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, getContext, substituteParams, checkWorldInfo, getSortedEntries } from "../st.js";
import { extensionName } from "../core/constants.js";
import { meguminCleanChatHistoryText } from "../engine/chatText.js";

export function loreInTasksOn() {
    const gs = extension_settings[extensionName] && extension_settings[extensionName].globalSettings;
    return !gs || gs.loreInTasks !== false;
}

const sub = t => { try { return substituteParams(t); } catch (e) { return t; } };
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const wordIn = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);

/**
 * The entries SillyTavern would activate for the recent chat, as one text ("" with none), up to
 * `maxChars` (about 3,000 tokens), cut between entries. SillyTavern's own budget is a share of
 * the whole context, tens of thousands of tokens on a big lorebook, and a background call is
 * never cached: every token of it is paid in full on each call.
 */
export async function loreForChat({ maxChars = 12000 } = {}) {
    if (!loreInTasksOn() || typeof checkWorldInfo !== "function") return "";
    try {
        const ctx = getContext();
        // The story as told: without the thinking and the blocks (a notebook's hidden truths
        // among them), whose words would wake entries the story never touched.
        // The newest 300 messages: SillyTavern scans the last few (its scan depth), and cleaning
        // a long chat whole would only cost time.
        const chat = (ctx.chat || []).filter(m => m && !m.is_system && typeof m.mes === "string").slice(-300)
            .map(m => `${m.name}: ${meguminCleanChatHistoryText(m.mes)}`).reverse();
        if (!chat.length) return "";
        const res = await checkWorldInfo(chat, Number(ctx.maxContext) || 8192, true, scanData(ctx));
        if (!res || typeof res !== "object") return "";
        const depth = (res.WIDepthEntries || []).flatMap(d => (d && d.entries) || []);
        const parts = [res.worldInfoBefore, res.worldInfoAfter, ...(res.ANBeforeEntries || []), ...(res.ANAfterEntries || []), ...depth]
            .map(t => String(t || "").trim()).filter(Boolean);
        const out = clipAtLine(sub([...new Set(parts)].join("\n\n")), maxChars);
        lastLore = { chat: chatKey(), text: out };
        return out;
    } catch (e) {
        console.warn("[VCRP] Lorebook read failed; going on without it.", e);
        return "";
    }
}

// What SillyTavern scans besides the chat (the card, the persona), and the generation the
// entries are for: a normal reply, the story's own. Newer SillyTavern reads it, and without
// it an entry limited to some generation types, or matched against the card or the persona,
// throws, and the call goes without lore. An older one takes three arguments and ignores it.
function scanData(ctx) {
    const ch = ((ctx && ctx.characters) || [])[ctx && ctx.characterId] || {};
    const data = ch.data || {};
    const depth = data.extensions && data.extensions.depth_prompt;
    return {
        personaDescription: String(sub("{{persona}}") || ""),
        characterDescription: String(sub("{{description}}") || ""),
        characterPersonality: String(sub("{{personality}}") || ""),
        characterDepthPrompt: String((depth && depth.prompt) || ""),
        scenario: String(sub("{{scenario}}") || ""),
        creatorNotes: String(data.creator_notes || ch.creatorcomment || ""),
        trigger: "normal",
    };
}

// The lore the last background call in this chat got, for the cost estimates the tabs show
// (they are drawn at once, and SillyTavern's lorebook scan is not).
let lastLore = { chat: null, text: "" };
const chatKey = () => { try { return (getContext() || {}).chatId || null; } catch (e) { return null; } };
export const lastLoreText = () => (loreInTasksOn() && lastLore.chat === chatKey() ? lastLore.text : "");

// The text up to `max` characters, ending at the last line break inside it (an entry's end,
// as far as the joined text shows one).
function clipAtLine(text, max) {
    if (!(max > 0) || text.length <= max) return text;
    const cut = text.lastIndexOf("\n", max);
    return text.slice(0, cut > max / 2 ? cut : max).trimEnd();
}

/** Entries that name these characters, in lorebook order, up to `maxChars`. */
export async function loreForNames(names, { maxChars = 6000 } = {}) {
    if (!loreInTasksOn() || typeof getSortedEntries !== "function") return "";
    const full = [...new Set((names || []).map(norm).filter(Boolean))];
    const wanted = [...new Set(full.flatMap(n => [n, n.split(" ")[0]]))].filter(w => w.length > 2);
    if (!wanted.length) return "";
    try {
        const entries = await getSortedEntries();
        const out = [];
        let size = 0;
        for (const e of Array.isArray(entries) ? entries : []) {
            if (!e || e.disable) continue;
            const content = String(e.content || "").trim();
            if (!content || out.includes(content)) continue;
            if (!entryNames(e, wanted, full)) continue;
            if (size + content.length > maxChars && out.length) break;
            out.push(content);
            size += content.length;
        }
        return sub(out.join("\n\n"));
    } catch (e) {
        console.warn("[VCRP] Lorebook read failed; going on without it.", e);
        return "";
    }
}

// A key that is a name ("Anno", "Anno Ryo"), a regex key that matches one, or a title that
// mentions one as a whole word.
function entryNames(e, wanted, full) {
    for (const raw of [...(e.key || []), ...(e.keysecondary || [])]) {
        const k = String(raw || "").trim();
        const rx = k.match(/^\/(.+)\/([a-z]*)$/i);
        if (rx) {
            try { if (full.some(n => new RegExp(rx[1], rx[2].replace(/g/g, "")).test(n))) return true; } catch (err) { /* a bad regex key */ }
            continue;
        }
        const nk = norm(k);
        if (nk && (wanted.includes(nk) || full.some(n => wordIn(nk, n)))) return true;
    }
    const title = norm(e.comment);
    return Boolean(title) && wanted.some(w => wordIn(title, w));
}

/** Lore wrapped for a prompt; "" when there is none. */
export function loreBlock(text, tag = "Lore") {
    const t = String(text || "").trim();
    return t ? `<${tag}>\n${t}\n</${tag}>` : "";
}
