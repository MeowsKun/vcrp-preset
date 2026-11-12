// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: the helper's recall pick.
//
// Story Memory brings an old chapter back when the scene touches it, and "touches" has meant
// shared rare words (recall.js). A scene that returns to something in other words ("the thing
// you promised my sister" for a chapter about Mara and the ring) shares none, and finds
// nothing. So, before a reply, the helper model is shown the old chapters' one-line gists
// beside the newest messages and asked which few the reply will need. Its chapters are
// brought back first; matching words still fills what room is left, and stands alone when
// the helper is not there, says nothing useful, or takes more than a few seconds.
//
// Asked only of a helper with a connection of its own: the question goes out while the
// story's own request is being prepared, when the story's connection is busy. One question
// per turn: a swipe of the same turn keeps the pick it was given.
// ─────────────────────────────────────────────────────────────────────────────

import { recallCandidates, setHelperRecall, onMemoryIntercept } from "./index.js";
import { askHelper, helperAnswers } from "../helper/aside.js";
import { vcrpIsDryRun } from "../generation.js";

export const RECALL_WAIT_MS = 4000;   // the longest a reply waits for the pick
let waitMs = RECALL_WAIT_MS;
/** For tests: a shorter wait; with no argument, the real one again. */
export const setRecallWait = (ms = RECALL_WAIT_MS) => { waitMs = ms; };
const MAX_PICKS = 3;
const MIN_CHAPTERS = 2;               // with fewer old chapters there is nothing to choose between
const SCENE_CHARS = 1400;             // of each of the last messages, its end

let last = null;   // { key, ids }: the pick made for this turn

/** The question, as messages (pure). */
export function recallPickMessages({ chapters, scene, extra }) {
    const list = chapters.map(c => `${c.id}${c.when ? ` [${c.when}]` : ""}: ${String(c.gist || "").replace(/\s+/g, " ").trim()}`).join("\n");
    const now = scene.map(m => `${m.user ? "READER" : "STORY"}: ${String(m.text || "").replace(/\s+/g, " ").trim().slice(-SCENE_CHARS)}`).join("\n\n");
    return [
        { role: "system", content: "You look after the memory of a long story. You are shown one-line summaries of its earlier chapters, which the storyteller can no longer see, and the newest messages. You name the chapters whose details the next reply will need. You answer with chapter ids only." },
        { role: "user", content: `<chapters>\n${list}\n</chapters>\n\n<newest_messages>\n${now}\n</newest_messages>${extra ? `\n\n<also_in_play>\n${extra}\n</also_in_play>` : ""}\n\nWhich chapters does the next reply need? Name a chapter when the newest messages return to its people, places, promises or events, even in other words, or when the reply could not stay true to the story without it. Name at most ${MAX_PICKS}, the most needed first. If none is needed, answer NONE.\n\nAnswer with the ids alone, separated by commas (for example: C4, C11), or NONE.` },
    ];
}

/** The ids in the helper's answer that are real chapters, in its order, at most MAX_PICKS. [] for NONE or nothing usable. */
export function parseRecallPick(answer, valid) {
    const text = String(answer || "").replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?\s*>|$)/gi, "");
    const known = new Set(valid);
    const out = [];
    for (const m of text.matchAll(/\bC\d+\b/gi)) {
        const id = m[0].toUpperCase();
        if (known.has(id) && !out.includes(id)) out.push(id);
        if (out.length >= MAX_PICKS) break;
    }
    return out;
}

/** Before the prompt is built (Story Memory's interceptor): the helper's pick for this turn, or none. */
export async function vcrpSmartRecall(type) {
    if (type === "quiet" || vcrpIsDryRun()) return;
    if (helperAnswers("recall") !== "profile") { last = null; setHelperRecall(null); return; }
    const c = recallCandidates();
    if (!c || c.chapters.length < MIN_CHAPTERS) { setHelperRecall(null); return; }
    if (last && last.key === c.key) { setHelperRecall(last); return; }
    // A deadline, not only a time limit on the request: the helper does one job at a time, and a
    // pick still waiting behind the last reply's blocks must not hold this reply up either.
    const answer = await askHelper("recall", recallPickMessages(c), { deadlineMs: waitMs, quietFail: true });
    last = answer === null ? null : { key: c.key, ids: parseRecallPick(answer, c.chapters.map(x => x.id)) };
    setHelperRecall(last);
}

/** Once, at start. */
export function vcrpInstallSmartRecall() {
    onMemoryIntercept(vcrpSmartRecall);
}

/** For tests, and when another chat is opened: no pick carries over. */
export function forgetRecallPick() {
    last = null;
    setHelperRecall(null);
}
