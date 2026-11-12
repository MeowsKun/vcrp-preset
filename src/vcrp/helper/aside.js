// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a small question for the helper model, with a prompt of its own.
//
// The continuity check (continuity.js) and the recall pick (memory/smartRecall.js) each ask
// the helper one short thing: a few thousand tokens in, a line or two out. They are worth
// asking only of a cheap second model, so they run only while the helper has a connection of
// its own (or, the reader's choice, the story's current one): never by falling back to the
// story model on their own. The question's messages are parked (activeRequests.js, activeAside)
// and sent by whichever way the helper's job goes, like every other job's.
// ─────────────────────────────────────────────────────────────────────────────

import { TASK_MARKERS, setActiveAside } from "../../core/activeRequests.js";
import { runHelperJob, helperRoute } from "./index.js";

/** Can this job be asked of the helper right now, and how: "profile" | "current" | "" (not at all). */
export function helperAnswers(job) {
    const route = helperRoute(job);
    return route === "profile" || route === "current" ? route : "";
}

/**
 * Asks the helper `messages` under `job`'s switch. Resolves to its answer's text, or null when
 * the helper is not there for this job, was stopped, or failed. `timeoutMs`: the request gives
 * up sooner than a job's usual five minutes. `deadlineMs`: the answer is wanted within this
 * long of the asking, the wait behind the helper's other jobs included; past it the question is
 * dropped. `quietFail`: fail without a notice (the caller goes on without the answer).
 */
export async function askHelper(job, messages, { timeoutMs = 0, deadlineMs = 0, quietFail = true } = {}) {
    if (!helperAnswers(job) || !Array.isArray(messages) || !messages.length) return null;
    let r;
    try {
        r = await runHelperJob(job, async quiet => {
            setActiveAside({ messages });
            try { return await quiet({ prompt: TASK_MARKERS.aside }); } finally { setActiveAside(null); }
        }, { timeoutMs, deadlineMs, quietFail });
    } catch (e) {
        console.warn(`[VCRP] Helper: ${job} failed on the story's connection`, e);
        return null;
    }
    if (!r || r.failed || r.stopped) return null;
    return typeof r.value === "string" ? r.value : null;
}
