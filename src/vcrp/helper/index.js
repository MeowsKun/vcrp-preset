// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the helper model (Megumin Suite V11's Chomusuke, in VCRP's terms): a second
// connection that does the background work, so the story model writes only the story.
//
// Each job goes straight to the helper's connection profile through SillyTavern's own
// connection manager (ConnectionManagerRequestService.sendRequest): the story's connection
// never changes, nothing switches, the chat never reloads. While a job runs on the profile,
// every quiet prompt VCRP makes (st.js) comes here instead of SillyTavern's quiet
// generation: the job's own messages are built as they are for the story's connection (the
// prompt handler on an empty list) and sent to the profile. "Use my current connection" runs
// the jobs as before, on the story's connection, one at a time and never while a reply is
// being written. A SillyTavern without sendRequest runs them on the story model, and Setup
// Check says so.
//
// Jobs run one at a time. While one runs on the profile, the payload it parked for the
// prompt handler is its own (activeRequests.js, helperOwnsPayloads): a prompt built for the
// story's connection meanwhile leaves it alone. Each job can be stopped (the indicator's
// Stop, or leaving the chat); a stopped job sends nothing more and comes back as stopped,
// with no warning. A failed request on the profile is said once, in plain words (notice.js),
// and comes back null; on the story's connection it throws, as it always did.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, extension_settings, generateQuietPrompt, setQuietRoute, isGenerating } from "../../st.js";
import { handlePromptInjection } from "../../engine/injection.js";
import { setHelperOwnsPayloads } from "../../core/activeRequests.js";
import { memoryTaskActive, memoryStandaloneMessages } from "../memory/index.js";
import { helperSettings, helperJobOn, CURRENT_CONNECTION } from "./settings.js";
import { warnHelper, TEST_PROMPT, testAnswerKind } from "./notice.js";
import { setHelperStatus, onHelperStatus } from "./status.js";

const MARKER = /^___PS_[A-Z_]+___$/;
const IDLE_WAIT_MS = 500;
const IDLE_MAX_MS = 120000;

/** Is this quiet prompt one of the jobs' markers ("___PS_FOCUS___" and so on)? */
export const isJobMarker = text => MARKER.test(String(text || "").trim());

/** A plain prompt (the test's one question) goes as one user message. */
export const plainMessages = text => { const t = String(text || "").trim(); return t ? [{ role: "user", content: t }] : []; };

/** Only Chat Completion profiles: Text Completion ones are not supported. */
export const isChatProfile = p => Boolean(p) && p.mode !== "tc";

/** SillyTavern's connection profiles: [{ id, name, mode, preset }]. */
export function connectionProfiles() {
    try {
        const list = extension_settings.connectionManager && extension_settings.connectionManager.profiles;
        return Array.isArray(list) ? list.map(p => ({ id: p.id, name: p.name, mode: p.mode, preset: p.preset })) : [];
    } catch (e) { return []; }
}

/** Can this SillyTavern send to a profile without switching? */
export function canSendToProfile() {
    try { return typeof getContext()?.ConnectionManagerRequestService?.sendRequest === "function"; } catch (e) { return false; }
}

/**
 * How a job reaches its model: "story" (the helper is off, the job stays with the story
 * model, or the profile cannot be sent to), "current" (the helper is the story's own
 * connection) or "profile" (sent to the helper's profile). `force` ignores the switches
 * (the Test button).
 */
export function helperRoute(job, { force = false } = {}) {
    const h = helperSettings();
    if (!h.profileId) return "story";
    if (!force && (!h.enabled || !helperJobOn(job))) return "story";
    if (h.profileId === CURRENT_CONNECTION) return "current";
    return canSendToProfile() ? "profile" : "story";
}

/** The longest answer to ask the profile for: its preset's response length, else the story's, within reason. */
export function helperReplyLength(presetLength, storyLength) {
    let n = 0;
    for (const v of [presetLength, storyLength]) {
        const x = Math.floor(Number(v));
        if (Number.isFinite(x) && x > 0) { n = x; break; }
    }
    if (!n) n = 8000;
    return Math.min(Math.max(n, 2048), 16000);
}

function profileReplyLength(ctx, profileId) {
    let presetLength;
    const profile = connectionProfiles().find(p => p.id === profileId);
    if (profile && profile.preset) {
        try { presetLength = ctx.getPresetManager("openai")?.getCompletionPresetByName(profile.preset)?.openai_max_tokens; } catch (e) { presetLength = undefined; }
    }
    return helperReplyLength(presetLength, ctx.chatCompletionSettings && ctx.chatCompletionSettings.openai_max_tokens);
}

/** The text out of sendRequest's answer ({ content, reasoning }); the reasoning is dropped. */
export const answerOf = res => (typeof res === "string" ? res : (res && typeof res.content === "string" ? res.content : ""));

const abortError = () => {
    try { return new DOMException("The helper's job was stopped.", "AbortError"); } catch (e) {
        const err = new Error("The helper's job was stopped."); err.name = "AbortError"; return err;
    }
};
const isAbort = e => Boolean(e) && (e.name === "AbortError" || /job was stopped/i.test(String(e.message || "")));

/**
 * One quiet prompt, sent to the profile instead of SillyTavern: a job's marker builds the
 * job's own messages (the prompt handler on an empty list, as for the story's connection);
 * a Story Memory call carries its standalone prompt; plain text goes as one user message.
 */
async function sendToProfile(text, entry) {
    const signal = entry.abort.signal;
    if (signal.aborted) throw abortError();
    const ctx = getContext();
    let messages;
    const standalone = memoryTaskActive() ? memoryStandaloneMessages() : null;
    if (standalone) messages = standalone;
    else if (isJobMarker(text)) {
        messages = [];
        await handlePromptInjection({ chat: messages, dryRun: false, helper: true }, "quiet");
        if (!messages.length) throw new Error("VCRP built no prompt for this job");
    } else if (memoryTaskActive()) throw new Error("a Story Memory call that reads the story's cache cannot go to the helper");
    else messages = plainMessages(text);
    if (!messages.length) return "";
    const profileId = helperSettings().profileId;
    const maxTokens = profileReplyLength(ctx, profileId);
    console.debug(`[VCRP] Helper → ${entry.job}: ${messages.length} messages, up to ${maxTokens} tokens.`);
    let res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, { stream: false, extractData: true, includePreset: true, signal });
    // Streamed after all (a preset that forces it): read it to the end.
    if (typeof res === "function") {
        let last = null;
        for await (const chunk of res()) last = chunk;
        res = { content: last ? String(last.text || "") : "" };
    }
    const answer = answerOf(res);
    if (!answer.trim()) console.warn("[VCRP] Helper: the profile sent back no text.", res);
    return answer;
}

// ── The queue ────────────────────────────────────────────────────────────────

const live = new Set();   // queued and running jobs: { job, chatId, abort, route, running }
let queue = Promise.resolve();
const chatIdNow = () => { try { return String((getContext() || {}).chatId || ""); } catch (e) { return ""; } };

function publish() {
    const running = [...live].find(e => e.running);
    setHelperStatus({ running: running ? { jobs: [running.job] } : null, waiting: [...live].filter(e => !e.running).length });
}

// A job on the story's own connection never starts while a reply is being written.
async function waitForIdle(signal) {
    const until = Date.now() + IDLE_MAX_MS;
    while (typeof isGenerating === "function" && isGenerating() && Date.now() < until) {
        if (signal.aborted) throw abortError();
        await new Promise(r => setTimeout(r, IDLE_WAIT_MS));
    }
}

/**
 * Runs one job's `task` (which parks its payload and sends its quiet prompt, as always) on
 * the route the helper's settings give it. Resolves to { value, route, stopped?, failed?,
 * error? }: on the profile, a failed request is said and comes back null; on the story's
 * connection the task's own error is thrown, as before.
 */
export function runHelperJob(job, task, { force = false } = {}) {
    const route = helperRoute(job, { force });
    if (route === "story") return Promise.resolve().then(task).then(value => ({ value, route }));
    const entry = { job, chatId: chatIdNow(), abort: new AbortController(), route, running: false };
    live.add(entry);
    publish();
    const run = async () => {
        if (entry.abort.signal.aborted) { live.delete(entry); publish(); return { value: null, route, stopped: true }; }
        entry.running = true;
        publish();
        if (route === "profile") {
            setHelperOwnsPayloads(true);
            setQuietRoute(text => sendToProfile(text, entry));
        }
        try {
            if (route === "current") await waitForIdle(entry.abort.signal);
            const value = await task();
            return { value, route };
        } catch (e) {
            if (isAbort(e) || entry.abort.signal.aborted) return { value: null, route, stopped: true };
            if (route !== "profile") throw e;
            console.error(`[VCRP] Helper: ${job} failed`, e);
            warnHelper("failed", [job], { error: e });
            return { value: null, route, failed: true, error: e };
        } finally {
            if (route === "profile") {
                setQuietRoute(null);
                setHelperOwnsPayloads(false);
            }
            live.delete(entry);
            publish();
        }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
}

/** Stops every queued or running job. Returns how many. */
export function stopHelperJobs() {
    let n = 0;
    for (const e of live) if (!e.abort.signal.aborted) { e.abort.abort(); n++; }
    return n;
}

/** Leaving a chat stops the jobs queued in it: nothing is written into the wrong chat. */
export function stopHelperJobsForOtherChats() {
    const now = chatIdNow();
    for (const e of live) if (e.chatId !== now && !e.abort.signal.aborted) e.abort.abort();
}

/** True while any job is queued or running. */
export const helperBusy = () => live.size > 0;

const blocksPending = () => [...live].some(e => e.job === "blocks" && !e.abort.signal.aborted);

/**
 * Resolves once no blocks job is queued or running (the next prompt reads the blocks it
 * writes); null when none is. The send guard (indicator.js) waits on it.
 */
export function helperBlocksPending() {
    if (!blocksPending()) return null;
    return new Promise(resolve => {
        const off = onHelperStatus(() => { if (!blocksPending()) { off(); resolve(); } });
        if (!blocksPending()) { off(); resolve(); }
    });
}

/** The Test button: one short question on the helper's connection, whatever the switches say. */
export async function helperTest() {
    const r = await runHelperJob("test", () => generateQuietPrompt({ prompt: TEST_PROMPT }), { force: true });
    if (r.failed) return { kind: "failed", error: r.error, route: r.route };
    if (r.stopped) return { kind: "stopped", route: r.route };
    const reply = typeof r.value === "string" ? r.value.trim() : "";
    return { kind: testAnswerKind(reply), reply, route: r.route };
}
