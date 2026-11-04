// ─────────────────────────────────────────────────────────────────────────────
// VCRP: is a custom block due this turn? A block written "Every few replies" is asked for
// again once enough replies have followed its last whole copy in the chat (vcrp/customBlocks.js
// says how many). Read from the chat each time, like the carried blocks (vcrp/blockHistory.js).
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpWithoutSwipedReply } from "./generation.js";
import { normalizeCustomBlock, customBlockTags, customBlockDue } from "./customBlocks.js";

const LOOKBACK = 60;   // replies searched back for the last copy, at most

/**
 * Replies written after the newest reply that holds this block whole (under its tag or an
 * old one), or null when none of the last few dozen does.
 * @param {object} b      a normalized custom block
 * @param {object[]} replies  the chat's replies, oldest first
 */
export function customRepliesSince(b, replies) {
    const tags = customBlockTags(b);
    if (!tags.length) return null;
    const whole = tags.map(t => new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, "i"));
    let n = 0;
    for (let i = replies.length - 1, seen = 0; i >= 0 && seen < LOOKBACK; i--, seen++) {
        const mes = String(replies[i].mes || "");
        if (whole.some(re => re.test(mes))) return n;
        n++;
    }
    return null;
}

/** Is the story asked for this custom block this turn? Built-in blocks always are. */
export function customBlockDueNow(raw) {
    if (!raw || raw.builtin) return true;
    const b = normalizeCustomBlock(raw);
    if (b.when !== "everyN") return true;
    let since = null;
    try {
        const chat = (((getContext() || {}).chat) || []).filter(m => m && !m.is_system);
        const replies = vcrpWithoutSwipedReply(chat).filter(m => !m.is_user && typeof m.mes === "string");
        since = customRepliesSince(b, replies);
    } catch (e) { since = null; }
    return customBlockDue(b, since);
}
