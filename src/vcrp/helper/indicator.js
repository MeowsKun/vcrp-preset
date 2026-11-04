// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the "helper is working" pill, the line under the input while a message waits for
// the helper, and the send guard that makes it wait.
//
// The pill sits at the bottom of the screen while a job is queued or running, with Stop;
// a <dialog> is not wanted here, it is a status, not a question. The send guard: a reply
// sent while the helper still writes the last reply's blocks waits for it (at most 30 s),
// so the next prompt carries those blocks; background calls and token-count dry runs pass
// straight through. SillyTavern waits for GENERATION_STARTED's handlers before it talks to
// the API.
// ─────────────────────────────────────────────────────────────────────────────

import { onHelperStatus, helperStatusText } from "./status.js";
import { stopHelperJobs, helperBlocksPending } from "./index.js";

const PILL_ID = "vcrp_helper_pill";
const LINE_ID = "vcrp_helper_waiting";
const GUARD_MAX_MS = 30000;

function stopNow() {
    const n = stopHelperJobs();
    if (typeof toastr !== "undefined") toastr.info(n === 1 ? "The helper stopped its job." : n ? `The helper stopped its ${n} jobs.` : "The helper had nothing running.", "VCRP: helper", { timeOut: 3000 });
}

function drawPill(s) {
    if (typeof document === "undefined" || !document.body) return;
    const busy = Boolean(s.running || s.waiting);
    let el = document.getElementById(PILL_ID);
    if (!busy) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement("div");
        el.id = PILL_ID;
        el.className = "vcrp-helper-pill";
        el.setAttribute("role", "status");
        el.innerHTML = `<i class="fa-solid fa-robot"></i><span class="vcrp-helper-pill-text"></span><button type="button" class="vcrp-helper-pill-stop" title="Stop the helper's jobs">Stop</button>`;
        el.querySelector("button").addEventListener("click", e => { e.preventDefault(); stopNow(); });
        document.body.appendChild(el);
    }
    el.querySelector(".vcrp-helper-pill-text").textContent = `Helper: ${helperStatusText(s)}`;
}

/** Draws the pill as the helper's status changes. */
export function initHelperIndicator() {
    onHelperStatus(drawPill);
}

/** The waiting line under the input. Returns false when there is no input to put it under. */
export function showWaitingLine() {
    hideWaitingLine();
    if (typeof document === "undefined") return false;
    const form = document.getElementById("send_form");
    if (!form || !form.parentNode) return false;
    const el = document.createElement("div");
    el.id = LINE_ID;
    el.className = "vcrp-helper-waiting";
    el.setAttribute("role", "status");
    el.innerHTML = `<i class="fa-solid fa-robot"></i><span>Waiting for the helper to finish the last reply's blocks…</span><button type="button" class="vcrp-helper-pill-stop" title="Stop the helper's job and send now">Stop</button>`;
    el.querySelector("button").addEventListener("click", e => { e.preventDefault(); stopNow(); });
    form.parentNode.insertBefore(el, form.nextSibling);
    return true;
}

export function hideWaitingLine() {
    if (typeof document === "undefined") return;
    const el = document.getElementById(LINE_ID);
    if (el) el.remove();
}

/** GENERATION_STARTED: a reply waits for the helper's blocks job, at most 30 seconds. */
export async function vcrpHelperSendGuard(genType, _params, dryRun) {
    if (dryRun || genType === "quiet") return;
    const wait = helperBlocksPending();
    if (!wait) return;
    if (!showWaitingLine() && typeof toastr !== "undefined") toastr.info("Waiting a moment for the helper to finish the last reply's blocks…", "VCRP: helper", { timeOut: 3000 });
    try {
        const gaveUp = await Promise.race([wait.then(() => false), new Promise(r => setTimeout(() => r(true), GUARD_MAX_MS))]);
        if (gaveUp) console.warn("[VCRP] Helper: still writing the blocks after 30 s; the reply goes out without them.");
    } finally { hideWaitingLine(); }
}
