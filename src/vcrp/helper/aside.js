// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a question with a prompt of its own.
//
// Two kinds of caller:
//   - askHelper: the continuity check (continuity.js) and the recall pick
//     (memory/smartRecall.js) each ask one short thing with every reply, a few thousand tokens
//     in and a line or two out. They are worth asking only of a cheap second model, so they run
//     only while the helper has a connection of its own (or, the reader's choice, the story's
//     current one): never by falling back to the story model on their own.
//   - askModel: a one-off the reader pressed a button for (the arc pitches, arc.js). It goes
//     wherever its job goes: to the helper when that job is switched to it, to the story model
//     otherwise.
// Either way the question's messages are parked under a marker of their own
// (activeRequests.js, parkAside) and sent by whichever way the job goes, like every other
// job's: nothing of the preset rides along.
// ─────────────────────────────────────────────────────────────────────────────

import { parkAside, unparkAside } from "../../core/activeRequests.js";
import { runHelperJob, helperRoute } from "./index.js";
import { vcrpCountBackgroundOutput } from "../memory/index.js";

/** Can this job be asked of the helper right now, and how: "profile" | "current" | "" (not at all). */
export function helperAnswers(job) {
    const route = helperRoute(job);
    return route === "profile" || route === "current" ? route : "";
}

// Sends `messages` as `job`: parked for as long as the request runs, and not a moment longer.
const send = (job, messages, opts) => runHelperJob(job, async quiet => {
    const marker = parkAside(messages);
    try { return await quiet({ prompt: marker }); } finally { unparkAside(marker); }
}, opts);

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
        r = await send(job, messages, { timeoutMs, deadlineMs, quietFail });
    } catch (e) {
        console.warn(`[VCRP] Helper: ${job} failed on the story's connection`, e);
        return null;
    }
    if (!r || r.failed || r.stopped) return null;
    return typeof r.value === "string" ? r.value : null;
}

/**
 * Asks `messages` of whoever does `job`: the helper when the job is switched to it, the story
 * model otherwise. A background call like any other (no limit of VCRP's; counted in the spend
 * estimate when the story model answers). Resolves to the answer's text, or null when it was
 * stopped or failed.
 */
export async function askModel(job, messages) {
    if (!Array.isArray(messages) || !messages.length) return null;
    let r;
    try {
        r = await send(job, messages, {});
    } catch (e) {
        console.error(`[VCRP] ${job}: the question failed`, e);
        return null;
    }
    if (!r || r.failed || r.stopped) return null;
    const answer = typeof r.value === "string" ? r.value : null;
    if (answer && r.route !== "profile") vcrpCountBackgroundOutput(answer);
    return answer;
}
