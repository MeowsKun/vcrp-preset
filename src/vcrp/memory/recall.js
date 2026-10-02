// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: bringing old chapters back when the scene touches them.
//
// After a cut, a chapter lives in the prompt only as its one-line gist. When the recent
// messages share enough rare words with a chapter (a name, a place, an object), its full
// text comes back for this request. Facts the memory cap keeps out of the prompt come back
// the same way. Matching is keyword overlap weighted by rarity across the candidates:
// local, free, and the same answer every time for the same messages.
//
// Recall sits after the chat, where changing it every turn leaves the cache alone. It is
// rewritten to the cache on every request though, so it is kept small (recallTokens).
//
// Pure: callers pass the candidates, the recent text and the size limit.
// ─────────────────────────────────────────────────────────────────────────────

import { memExtractKeywords } from "../../core/keywords.js";

const MIN_SHARED = 2;      // a chapter needs at least this many words in common with the scene
const MIN_SCORE = 3;       // and enough of them rare enough to count

const kwCache = new Map();
/** The keywords of a text, cached by the text itself. */
export function keywordsOf(text) {
    const key = String(text || "");
    let kw = kwCache.get(key);
    if (!kw) {
        kw = new Set(memExtractKeywords(key.toLowerCase()));
        if (kwCache.size > 2000) kwCache.clear();
        kwCache.set(key, kw);
    }
    return kw;
}

/**
 * Candidates the scene matches, best first.
 * @param {{id:string, text:string, tokens:number}[]} candidates
 * @param {Set<string>} query  keywords of the recent messages
 */
export function rankRecall(candidates, query) {
    if (!candidates.length || !query.size) return [];
    const kws = candidates.map(c => keywordsOf(c.text));
    const df = new Map();
    for (const set of kws) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    const n = candidates.length;
    const ranked = [];
    candidates.forEach((c, i) => {
        let score = 0, shared = 0;
        for (const w of query) {
            if (!kws[i].has(w)) continue;
            shared++;
            score += Math.log(1 + n / df.get(w));
        }
        if (shared >= MIN_SHARED && score >= MIN_SCORE) ranked.push({ c, score });
    });
    return ranked.sort((a, b) => b.score - a.score);
}

/** The best matches that fit in `capTokens`, back in story order. */
export function pickRecall(candidates, query, capTokens) {
    const picked = [];
    let used = 0;
    for (const { c } of rankRecall(candidates, query)) {
        if (used + c.tokens > capTokens) continue;
        picked.push(c);
        used += c.tokens;
    }
    return picked.sort((a, b) => a.order - b.order);
}

export function formatRecall(chapters, facts) {
    const parts = [];
    for (const c of chapters) parts.push(`[${c.label}]\n${c.text}`);
    if (facts.length) parts.push(`Facts that still hold:\n${facts.map(f => `- ${f.text}`).join("\n")}`);
    if (!parts.length) return "";
    return `<story_recall>\nEarlier events the current scene touches, from the story memory:\n${parts.join("\n\n")}\n</story_recall>`;
}
