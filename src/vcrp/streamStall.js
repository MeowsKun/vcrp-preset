// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply's stream that has gone quiet.
//
// SillyTavern's server passes the provider's stream straight to the page. When the
// connection to the provider drops partway (a phone changing networks, a carrier closing an
// idle connection while the model reasons), the server neither ends the page's stream nor
// reports an error: its terminal shows "Streaming request in progress" and never "Streaming
// request finished", and the page goes on waiting for good, with an empty message, until the
// reader presses Stop. Nothing on the page says so.
//
// generationTrace.js watches the silence of a story's stream. Here it is said, once, in a
// notice that stays until data arrives again or the reply ends: how long nothing has come,
// what that may mean, and a tap to stop the reply and send the same request again (the same
// request, as swiping would). A reply the reader stops themselves is left to them.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpOnStreamStall } from "./generationTrace.js";

const ASK_MS = 20000;      // a tap on the notice counts for the reply that ends within this long
let notice = null;
let askedAt = 0;

/** The reader tapped "stop and send again" a moment ago. Read once: asking again says no. */
export function stallRetryAsked() {
    const yes = askedAt > 0 && Date.now() - askedAt <= ASK_MS;
    askedAt = 0;
    return yes;
}

/** For tests. */
export function resetStallNotice() { notice = null; askedAt = 0; }

function hide() {
    if (!notice) return;
    try { if (typeof toastr !== "undefined" && typeof toastr.clear === "function") toastr.clear(notice); } catch (e) { /* already gone */ }
    notice = null;
}

function stopAndResend() {
    askedAt = Date.now();
    hide();
    const ctx = getContext() || {};
    try {
        if (typeof ctx.stopGeneration === "function") { ctx.stopGeneration(); return; }
        const btn = typeof document !== "undefined" ? document.querySelector("#mes_stop") : null;
        if (btn && typeof btn.click === "function") btn.click();
    } catch (e) { console.warn("[VCRP] Could not stop the reply", e); }
}

/** What the notice says (pure). */
export function stallText(quietMs, source) {
    const s = Math.round(quietMs / 1000);
    // OpenRouter's own documentation: it sends comment lines on a waiting stream "to prevent
    // connection timeouts" (no interval given), so a long silence there is unusual.
    const dropped = source === "openrouter"
        ? "OpenRouter sends lines now and then to keep a waiting stream open, so a silence this long usually means the connection has dropped."
        : "The model may still be reasoning in silence, or the connection has dropped.";
    return `Nothing has arrived from the provider for ${s} seconds. ${dropped} SillyTavern does not notice a dropped connection: it goes on waiting, and its terminal shows "Streaming request in progress" with no "finished". Tap here to stop this reply and send the same request again. If the model was only slow, the reply you stop may still be billed.`;
}

/** Once, at start: the notice is hooked to the stream watch. */
export function vcrpInstallStallNotice() {
    vcrpOnStreamStall((what, info) => {
        if (what !== "stall") { hide(); return; }
        if (typeof toastr === "undefined" || notice) return;
        notice = toastr.warning(stallText(info.quietMs, info.source), "VCRP: the reply has gone quiet",
            { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true, closeButton: true, onclick: stopAndResend });
    });
}
