// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply the length limit cut off ends on its last full sentence.
//
// The safety cap (or SillyTavern's own Max Response Length) stops a reply mid-word: "She
// turned toward the door and". That half-sentence would sit in the chat and in the history
// the model reads. So a reply that reached the limit and stops mid-sentence in its story is
// trimmed back to its last full sentence, a <font> it leaves open is closed, and you are told
// (Continue still writes the rest). A reply cut inside its thinking or its blocks is left as it
// is: the story is whole, and the next reply carries the last complete blocks
// (blockHistory.js). Runs as the reply arrives, after its cost is counted as written.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, updateMessageBlock } from "../st.js";
import { estimateTokens } from "./memory/index.js";
import { replyLimitTokens } from "./replyLength.js";

const NEAR = 0.85;   // a reply this close to the limit is taken to have reached it (the count is an estimate)
const LOOKBACK = 1500;   // characters searched back for the last full sentence

// Where a sentence may end: a terminator, then any closing quotes, brackets, emphasis and tags.
const ENDING = /[.!?…—–](?:["'”’)\]*_~]|<\/[a-z]+>)*/gi;

/**
 * The reply as it should stay, when it was cut: { text, where } with where "story" (trimmed),
 * "thinking" or "blocks" (left as is), or null when it ends cleanly.
 */
export function cutReply(text) {
    const s = String(text || "");
    const thinkOpen = /<think(?:ing)?\b[^>]*>/i.test(s) && !/<\/think(?:ing)?\s*>/i.test(s);
    if (thinkOpen) return { text: s, where: "thinking" };
    let split = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(s)) !== null) split = m.index + m[0].length;
    const head = s.slice(0, split), tail = s.slice(split);
    const count = r => (tail.match(r) || []).length;
    if (count(/<Blocks\b[^>]*>/gi) > count(/<\/Blocks\s*>/gi)) return { text: s, where: "blocks" };
    // A block or tracker tag (they are capitalised: World_State, Pura_Scene) opened outside the
    // envelope and never closed: cut inside it, so the story itself is whole.
    for (const t of new Set([...tail.matchAll(/<([A-Z][A-Za-z_]+)\b[^>]*>/g)].map(x => x[1]))) {
        if (count(new RegExp(`<${t}\\b[^>]*>`, "g")) > count(new RegExp(`<\\/${t}\\s*>`, "g"))) return { text: s, where: "blocks" };
    }
    const body = tail.replace(/\s+$/, "");
    if (!body) return null;
    // Ends cleanly: a terminator (with its closers), or a closed block or tag at the very end.
    if (/[.!?…—–](?:["'”’)\]*_~]|<\/[a-z]+>)*$/i.test(body) || /<\/[A-Za-z_]+\s*>$/.test(body)) return null;
    let last = -1;
    const from = Math.max(0, body.length - LOOKBACK);
    ENDING.lastIndex = from;
    while ((m = ENDING.exec(body)) !== null) last = m.index + m[0].length;
    if (last < 0) return null;   // no full sentence anywhere near: leave it
    let kept = body.slice(0, last);
    // A <font> (a colored line) opened in what is kept and not closed: close it.
    const opens = (kept.match(/<font\b[^>]*>/gi) || []).length, closes = (kept.match(/<\/font\s*>/gi) || []).length;
    if (opens > closes) kept += "</font>".repeat(opens - closes);
    return { text: head + kept, where: "story" };
}

/** MESSAGE_RECEIVED: a reply that reached the limit mid-sentence is trimmed to its last full sentence. */
export function vcrpCutOnReply(messageId, type) {
    if (type === "first_message") return;
    const limit = replyLimitTokens();
    if (!limit) return;
    const chat = ((getContext() || {}).chat) || [];
    const id = Number(messageId);
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return;
    const written = estimateTokens(msg.mes + String((msg.extra && msg.extra.reasoning) || ""));
    if (written < limit * NEAR) return;
    const cut = cutReply(msg.mes);
    if (!cut) return;
    const toast = (m) => { if (typeof toastr !== "undefined") toastr.info(m, "VCRP: length limit", { timeOut: 8000 }); };
    if (cut.where === "story") {
        msg.mes = cut.text;
        if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = cut.text;
        try {
            if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
        } catch (e) { console.warn("[VCRP] Length limit: could not redraw message", id, e); }
        toast(`This reply reached the ${limit.toLocaleString("en-US")}-token limit mid-sentence, so it now ends on its last full sentence. Its blocks were not written: the next reply carries the last complete ones. Continue writes the rest.`);
    } else if (cut.where === "blocks") {
        toast(`This reply reached the ${limit.toLocaleString("en-US")}-token limit inside its blocks. The story is whole; Continue finishes the blocks, or the next reply carries the last complete ones.`);
    } else {
        toast(`This reply reached the ${limit.toLocaleString("en-US")}-token limit while still thinking. Swipe for another, or raise the limit (Memory tab, Reply length).`);
    }
}
