// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: which messages the prompt carries.
//
// The cached prompt must not change between turns, so old messages are never dropped
// one at a time. They leave in one cut, and only when the cut costs nothing extra:
//
//   cold start   the cache has expired, so this request is a full miss anyway. Cut down
//                to what a miss can afford (budget.coldTokens).
//   warm         reads are cheap; the prompt keeps growing. Only past the ceiling
//                (budget.warmTokens) is a planned miss taken, cutting to coldTokens.
//
// A cut never removes a message the memory has not summarized yet, never touches the most
// recent budget.minVerbatim tokens, and always lands where a user message starts, so the
// carried history opens on a turn rather than halfway through a reply.
//
// Pure: callers pass token counts, the stored state, and the time.
// ─────────────────────────────────────────────────────────────────────────────

// The cache counts as cold a little before it really expires: a request that starts
// just inside the lifetime can still miss once the prompt has travelled.
const COLD_MARGIN = 0.95;

function suffixSums(msgs) {
    const after = new Array(msgs.length + 1);
    after[msgs.length] = 0;
    for (let i = msgs.length - 1; i >= 0; i--) after[i] = after[i + 1] + (msgs[i].tokens || 0);
    return after;
}

// The furthest a cut may go: covered by summaries, and leaving the verbatim floor.
function furthestCut(msgs, after, summarizedTo, minVerbatim) {
    let c = Math.min(Math.max(0, summarizedTo || 0), msgs.length);
    while (c > 0 && after[c] < minVerbatim) c--;
    return c;
}

const isBoundary = (msgs, c) => c === 0 || (msgs[c] && msgs[c].isUser);

/** True when the cache has expired (or never existed) at time `now`. */
export function isCold(state, now, budget) {
    return !state || !state.lastRequestAt || now - state.lastRequestAt > budget.ttlMs * COLD_MARGIN;
}

/**
 * @param {object} a
 * @param {{tokens:number,isUser:boolean}[]} a.msgs  chat messages in order, as the interceptor sees them
 * @param {number} a.fixedTokens  everything in the prompt that is not chat history
 * @param {{cutAt?:number,summarizedTo?:number,lastRequestAt?:number}} a.state
 * @param {number} a.now
 * @param {object} a.budget  from computeBudget()
 * @returns {{cutAt:number, cut:boolean, cold:boolean, promptTokens:number, behind:boolean, limit:(null|"summaries"|"verbatim floor"), reason:string}}
 */
export function planWindow({ msgs, fixedTokens, state = {}, now, budget }) {
    const n = msgs.length;
    const after = suffixSums(msgs);
    const prompt = c => fixedTokens + after[c];
    const from = Math.min(Math.max(0, state.cutAt || 0), n);
    const cold = isCold(state, now, budget);
    const ceiling = cold ? budget.coldTokens : budget.warmTokens;

    if (prompt(from) <= ceiling) {
        return { cutAt: from, cut: false, cold, promptTokens: prompt(from), behind: false, limit: null, reason: cold ? "cold start, already within budget" : "warm" };
    }

    // The gentlest cut that brings a miss within budget, keeping as much story as fits.
    const maxCut = furthestCut(msgs, after, state.summarizedTo, budget.minVerbatim);
    let target = -1;
    for (let c = from + 1; c <= maxCut; c++) {
        if (isBoundary(msgs, c) && prompt(c) <= budget.coldTokens) { target = c; break; }
    }
    let behind = false, limit = null;
    if (target < 0) {
        // Not enough is summarized (or the verbatim floor alone is over budget): cut as far
        // as is allowed and report it, rather than drop text the memory does not hold.
        behind = true;
        // Which wall it hit: the summaries not reaching far enough, or the recent text kept
        // word for word being more than the budget leaves room for.
        limit = maxCut < furthestCut(msgs, after, n, budget.minVerbatim) ? "summaries" : "verbatim floor";
        target = from;
        // Only a cold start cuts partway: that request misses the cache anyway, so a smaller
        // prompt is pure saving. While warm, a cut that can't reach the budget would throw
        // the whole cached prompt away for nothing, so the prompt stays as it is.
        if (cold) for (let c = maxCut; c > from; c--) if (isBoundary(msgs, c)) { target = c; break; }
    }
    return {
        cutAt: target, cut: target > from, cold, promptTokens: prompt(target), behind, limit,
        reason: `${cold ? "cold start" : "warm ceiling"}${behind ? `, over budget (${limit})` : ""}`,
    };
}

/**
 * How far the summaries need to reach right now, so that if the cache went cold this
 * moment a cut could still bring the prompt within budget, with `lookahead` tokens of
 * room for the chat to keep growing. Summarizing ahead while the cache is warm is what
 * makes the cold-start cut free.
 */
export function summaryTarget({ msgs, fixedTokens, budget, lookahead = 4000 }) {
    const after = suffixSums(msgs);
    const prompt = c => fixedTokens + after[c];
    const cap = furthestCut(msgs, after, msgs.length, budget.minVerbatim);
    if (prompt(0) + lookahead <= budget.coldTokens) return 0;
    for (let c = 1; c <= cap; c++) {
        if (isBoundary(msgs, c) && prompt(c) + lookahead <= budget.coldTokens) return c;
    }
    for (let c = cap; c > 0; c--) if (isBoundary(msgs, c)) return c;
    return 0;
}
