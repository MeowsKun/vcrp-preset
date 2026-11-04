// ─────────────────────────────────────────────────────────────────────────────
// VCRP: telling the reader when the helper's answer is missing or unusable (Megumin Suite
// V11's Chomusuke notices, in VCRP's terms).
//
// Three different problems, three different fixes, so three messages:
//   failed: the request errored (connection, key, provider)
//   empty:  it answered with nothing, or only with its thinking
//   format: it answered, but not in a format the job can use
// Pure apart from the toast itself, so the wording is tested under node.
// ─────────────────────────────────────────────────────────────────────────────

export const HELPER_JOB_NAMES = {
    blocks: "the blocks",
    memory: "the Story Memory summary",
    focus: "the Focus audit",
    director: "the Story Director",
    npc: "the NPC Bank",
    banList: "the ban list scan",
    styleGen: "the writing style",
    test: "the test",
};

// Jobs whose result can be asked for again from the Helper tab.
const HAS_AGAIN = new Set(["blocks"]);

const nameOf = job => HELPER_JOB_NAMES[job] || job;

/** "A", "A and B", "A, B and C" */
export function joinJobNames(jobs) {
    const names = (jobs || []).map(nameOf);
    if (names.length <= 1) return names[0] || "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Empty once the thinking is taken out? Then it said nothing. */
export function answerKind(raw) {
    const text = String(raw ?? "").replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "").trim();
    return text ? "format" : "empty";
}

// Why a request failed, in the reader's words. SillyTavern hands back no status number,
// only words: the provider's status text ("Bad Gateway", "Unauthorized") or the
// connection's own error ("fetch failed", "terminated").
// [test, what happened, what to do]; the error's own words go in brackets.
const FAILURE_REASONS = [
    [/unauthori[sz]ed|forbidden|invalid[^.]*key|api key|authenticat|\b40[13]\b/i,
        "The provider didn't accept the API key", "Check the key in the helper's connection profile."],
    [/too many requests|rate.?limit|quota|insufficient|\b429\b/i,
        "The provider is limiting requests right now, or the credits are used up", "Wait a little, or check your plan with them."],
    [/context length|too long|maximum context|payload too large|\b413\b/i,
        "The request was too long for the helper's model", "Pick a model that takes longer prompts."],
    [/model[^.]*(not found|not exist|unavailable)|no such model|\b404\b|not found/i,
        "The provider doesn't know the model set for the helper", "Check the model in the helper's connection profile."],
    [/bad gateway|service unavailable|gateway timeout|internal server error|overloaded|\b5\d\d\b/i,
        "The provider's server had a problem on their side", "This usually passes in a minute."],
    [/fetch failed|terminated|socket hang up|econnreset|etimedout|timed? ?out|connection refused|econnrefused|enotfound|eai_again|network|other side closed/i,
        "The provider couldn't be reached: the connection dropped or timed out", "This usually passes in a minute. If it keeps happening, check your internet or the provider's status page."],
];

/** The API's own words for a failed request (sendRequest wraps the real error in `cause`). */
export function requestError(e) {
    let err = e;
    for (let i = 0; i < 4 && err && err.cause; i++) err = err.cause;
    const msg = String((err && err.message) || err || "").trim();
    return msg || String((e && e.message) || e || "").trim();
}

/** The failure in plain words: "<what happened> (<the error's words>). <what to do>" */
export function failureReason(error) {
    const why = requestError(error).slice(0, 200);
    const hit = why && FAILURE_REASONS.find(([re]) => re.test(why));
    if (hit) return `${hit[1]} (${why}). ${hit[2]}`;
    return why ? `The request failed (${why}).` : "The request failed.";
}

/**
 * @param {"failed"|"empty"|"format"} kind
 * @param {string[]} jobs  job keys (blocks, memory, …)
 * @param {{ error?: any }} [opts]
 * @returns {string}
 */
export function helperProblemText(kind, jobs, { error } = {}) {
    const what = joinJobNames(jobs);
    const again = (jobs || []).some(j => HAS_AGAIN.has(j));
    if (kind === "failed") {
        return `The helper couldn't get an answer for ${what}. ${failureReason(error)}`
            + (again ? " Then use \"Write the last reply's blocks again\" in the Helper tab." : "");
    }
    if (kind === "empty") {
        return `The helper's model sent back nothing for ${what}. A censored model can refuse an NSFW story without a word: try a less censored one (GLM 5.3 Flash, DeepSeek 4.1 Flash) in the Helper tab, or check its connection there`
            + (again ? ", then use \"Write the last reply's blocks again\"." : ".");
    }
    return `The helper answered, but not in a format it could use for ${what}, so nothing changed. `
        + (again ? "Use \"Write the last reply's blocks again\" in the Helper tab, or pick a stronger model for the helper." : "Pick a stronger model for the helper if this keeps happening.");
}

// An empty answer usually means the model refuses this story, and it will keep refusing
// every reply: one warning per chat says it, more is noise. Failed requests and wrong
// formats still warn every time (they come and go).

/** Should this warning show? Records it in `seen` when it does. */
export function shouldWarn(kind, chatId, seen) {
    if (kind !== "empty") return true;
    const key = String(chatId || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
}

const warnedEmpty = new Set();
const openChatId = () => {
    try {
        const id = globalThis.SillyTavern?.getContext?.()?.chatId;
        return typeof id === "string" || typeof id === "number" ? String(id) : "";
    } catch (e) { return ""; }
};

// The Test button asks for one known word, so the test checks the model follows a short
// instruction, not only that something came back.
export const TEST_WORD = "pineapple";
export const TEST_PROMPT = `Reply with only this one word and nothing else: ${TEST_WORD}`;

/** "ok": the word came back; "empty": nothing (or only thinking); "other": something else. */
export function testAnswerKind(raw) {
    if (answerKind(raw) === "empty") return "empty";
    const text = String(raw).replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "");
    return new RegExp(`\\b${TEST_WORD}\\b`, "i").test(text) ? "ok" : "other";
}

/** Shows the warning. A failed request is an error (red), the rest are warnings. An empty answer warns once per chat. */
export function warnHelper(kind, jobs, opts) {
    if (!jobs || !jobs.length || typeof toastr === "undefined") return;
    if (!shouldWarn(kind, openChatId(), warnedEmpty)) return;
    const text = helperProblemText(kind, jobs, opts);
    if (kind === "failed") toastr.error(text, "VCRP: helper", { timeOut: 12000 });
    else toastr.warning(text, "VCRP: helper", { timeOut: 8000 });
}
