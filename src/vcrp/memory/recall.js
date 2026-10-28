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
// Rarity is measured across the candidates, and a handful (right after the first cut: a
// chapter or two and the facts the cap left out) can't tell a rare word from a common one:
// the scene could name a fact outright and miss it. A small pool counts as this many.
const MIN_POOL = 8;
// A fact is one short line: one rare word in common (a name, a place, an object found in two
// candidates at most, in a pool of eight) is enough to bring it back. Common words adding up
// ("Mara", "ring") are not.
const FACT_RARE_DF = 2;

// The short words the shared stop list lets through (it drops only longer ones): they say
// nothing about a scene, and in a small pool they would outweigh the words that do.
const SHORT_STOP = new Set(["the", "and", "was", "were", "are", "has", "had", "his", "her", "him", "she", "hers", "you", "for", "but", "not", "all", "can", "its", "our", "out", "who", "why", "how", "too", "yes", "now", "own", "off", "get", "got", "let", "may", "did", "does", "into", "onto", "also", "any", "one", "two", "way", "say", "says", "see", "saw", "yet", "per", "via"]);

const kwCache = new Map();
/** The keywords of a text, cached by the text itself. */
export function keywordsOf(text) {
    const key = String(text || "");
    let kw = kwCache.get(key);
    if (!kw) {
        kw = new Set(memExtractKeywords(key.toLowerCase()).filter(w => !SHORT_STOP.has(w)));
        if (kwCache.size > 2000) kwCache.clear();
        kwCache.set(key, kw);
    }
    return kw;
}

/**
 * Candidates the scene matches, best first.
 * @param {{id:string, text:string, tokens:number}[]} candidates
 * @param {Set<string>} query  keywords of the recent messages
 * @param {{text:string}[]} [corpus]  what rarity is measured across: the whole story memory
 *   (every chapter and fact), where the main cast's names are common; the candidates alone
 *   when not given
 */
export function rankRecall(candidates, query, corpus = null) {
    if (!candidates.length || !query.size) return [];
    const kws = candidates.map(c => keywordsOf(c.text));
    const pool = corpus && corpus.length ? corpus.map(c => keywordsOf(c.text)) : kws;
    const df = new Map();
    for (const set of pool) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    // A candidate outside the corpus still counts its own words once.
    kws.forEach(set => { for (const w of set) if (!df.has(w)) df.set(w, 1); });
    const n = Math.max(pool.length, MIN_POOL);
    const ranked = [];
    const rareIdf = Math.log(1 + n / FACT_RARE_DF);
    candidates.forEach((c, i) => {
        let score = 0, shared = 0, best = 0;
        for (const w of query) {
            if (!kws[i].has(w)) continue;
            shared++;
            const idf = Math.log(1 + n / df.get(w));
            score += idf;
            best = Math.max(best, idf);
        }
        if (c.fact ? best >= rareIdf : shared >= MIN_SHARED && score >= MIN_SCORE) ranked.push({ c, score });
    });
    return ranked.sort((a, b) => b.score - a.score);
}

/** The best matches that fit in `capTokens`, back in story order. `corpus` as for rankRecall. */
export function pickRecall(candidates, query, capTokens, corpus = null) {
    const picked = [];
    let used = 0;
    for (const { c } of rankRecall(candidates, query, corpus)) {
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
