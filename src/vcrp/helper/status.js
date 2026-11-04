// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what the helper is doing right now, for the indicator (indicator.js) and the tab.
// index.js publishes; the others listen. Pure.
// ─────────────────────────────────────────────────────────────────────────────

import { joinJobNames } from "./notice.js";

let status = { running: null, waiting: 0 };
const listeners = new Set();

/** { running: { jobs: string[] } | null, waiting: number } */
export function getHelperStatus() {
    return status;
}

export function setHelperStatus(next) {
    status = { running: (next && next.running) || null, waiting: Math.max(0, (next && next.waiting) || 0) };
    listeners.forEach(fn => { try { fn(status); } catch (e) { /* a listener's problem stays its own */ } });
}

/** Listen for changes; returns the function that stops listening. */
export function onHelperStatus(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** "the blocks… (2 more waiting)", or "" while the helper is idle. */
export function helperStatusText(s = status) {
    if (!s.running) return s.waiting ? `${s.waiting} job${s.waiting === 1 ? "" : "s"} waiting…` : "";
    const what = joinJobNames(s.running.jobs || []) || "a job";
    return `${what}…${s.waiting ? ` (${s.waiting} more waiting)` : ""}`;
}
