// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the continuity check.
//
// A long story loses a fact one reply at a time: an eye colour, who knows what, a promise
// already kept. Once a wrong line is in the chat it is summarised, recalled and built on. So
// each reply is read as it arrives, by the helper model, against what the story has
// established: this chat's Canon sheet (canon.js) and the scene as it stood before the reply
// (the last World State). A reply that plainly contradicts them carries a line under it, and
// a tap offers a swipe with the correction as that swipe's direction, or to wave it off.
//
// Only the helper does it (a few thousand tokens in, a line or two out, on every reply:
// worth it on a cheap second model, not on the story's). Without a helper, or with its
// Continuity check switched off in the Helper tab, nothing runs. It runs after the reply is
// on screen and never holds anything up; a check that fails says nothing. The checker is told
// to report only what cannot both be true, and that a change the reply itself shows is none.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, saveChat } from "../st.js";
import { canonItems } from "./canon.js";
import { worldStateOf } from "./storyTime.js";
import { blankReplyKind, swipeLastReply } from "./blankReply.js";
import { setOneShot } from "./oneShot.js";
import { askHelper, helperAnswers } from "./helper/aside.js";

const NOTE = "vcrp-continuity-note";
const WAIT_MS = 1500;          // after the reply lands, before it is read (the other handlers finish first)
const MAX_FINDINGS = 3;
const REPLY_CHARS = 9000;
const SCENE_CHARS = 1800;

/** The check runs: the helper is there for it (Helper tab). */
export const continuityOn = () => Boolean(helperAnswers("continuity"));

// The reply as the reader sees it: no thinking, no blocks, no markup.
const storyOf = mes => String(mes || "")
    .replace(/^[\s\S]*<\/think(?:ing)?\s*>/i, "")
    .replace(/<Blocks\b[^>]*>[\s\S]*?(?:<\/Blocks\s*>|$)/gi, "")
    .replace(/<\/?font\b[^>]*>/gi, "")
    .replace(/<[^>]{1,80}>/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** The scene as it stood before message `index`: the latest earlier World State, shortened; "" with none. */
export function sceneBefore(chat, index, back = 8) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = index - 1, n = 0; i >= 0 && n < back; i--, n++) {
        const m = list[i];
        if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
        const body = worldStateOf(m.mes).replace(/[*_`]/g, "").replace(/\n{2,}/g, "\n").trim();
        if (body) return body.slice(0, SCENE_CHARS);
    }
    return "";
}

/** The question, as messages (pure). */
export function continuityMessages({ canon, scene, reply }) {
    const facts = canon.length ? `<established_facts>\n${canon.map(c => `- ${c}`).join("\n")}\n</established_facts>\n\n` : "";
    const before = scene ? `<scene_before_this_reply>\n${scene}\n</scene_before_this_reply>\n\n` : "";
    return [
        { role: "system", content: "You check one reply of a long story against what the story has already established. You report only clear contradictions: a statement in the reply that cannot be true if an established fact is true. A change the reply itself shows happening (someone changes clothes, crosses the room, time passes, a secret comes out) is not a contradiction. Something the facts do not mention is not a contradiction. Style, taste and plausibility are not your concern. When in doubt, report nothing." },
        { role: "user", content: `${facts}${before}<reply>\n${reply}\n</reply>\n\nList each clear contradiction on its own line, at most ${MAX_FINDINGS}, in exactly this form:\nCONTRADICTION: "a short quote from the reply" | the established fact it contradicts\nIf there is none, answer exactly: OK` },
    ];
}

/** The checker's answer read: { ok, findings: [{ quote, fact }] }. Anything unreadable counts as nothing found. */
export function parseContinuity(answer) {
    const text = String(answer || "").replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?\s*>|$)/gi, "");
    const findings = [];
    for (const raw of text.split(/\r?\n/)) {
        const m = raw.replace(/[*_`]/g, "").match(/^\s*(?:[-•\d.)\s]*)CONTRADICTION\s*:\s*(.+)$/i);
        if (!m) continue;
        const at = m[1].lastIndexOf("|");
        if (at <= 0) continue;
        const quote = m[1].slice(0, at).trim().replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
        const fact = m[1].slice(at + 1).trim();
        if (quote && fact) findings.push({ quote: quote.slice(0, 240), fact: fact.slice(0, 300) });
        if (findings.length >= MAX_FINDINGS) break;
    }
    return { ok: findings.length === 0, findings };
}

/** The direction a corrected swipe is written with (pure). */
export function correctionText(findings) {
    const lines = findings.map(f => `- Established: ${f.fact} The last version of this reply had it wrong ("${f.quote}").`);
    return `Keep to what the story has established:\n${lines.join("\n")}\nWrite the reply so that it agrees with ${findings.length === 1 ? "this" : "these"}, changing nothing else about where the scene was going.`;
}

// What the check found, kept with the reply (and its swipe).
function keep(msg, value) {
    msg.extra = { ...(msg.extra || {}), vcrp_continuity: value };
    const info = Array.isArray(msg.swipe_info) && typeof msg.swipe_id === "number" ? msg.swipe_info[msg.swipe_id] : null;
    if (info && typeof info === "object") { info.extra = info.extra || {}; info.extra.vcrp_continuity = { ...value }; }
}

/**
 * Reads message `id` against the Canon sheet and the scene before it. Resolves to "found" |
 * "ok" | "skipped" | "failed". Draws the line under the reply when something was found.
 */
export async function checkContinuity(id) {
    const ctx = getContext() || {};
    const chat = ctx.chat || [];
    const msg = chat[id];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || blankReplyKind(msg.mes)) return "skipped";
    if (!continuityOn()) return "skipped";
    const canon = canonItems().map(i => i.text);
    const scene = sceneBefore(chat, id);
    const reply = storyOf(msg.mes).slice(0, REPLY_CHARS);
    if ((!canon.length && !scene) || !reply) return "skipped";
    const text = msg.mes;
    const answer = await askHelper("continuity", continuityMessages({ canon, scene, reply }), { quietFail: true });
    if (answer === null) return "failed";
    // The reply was swiped, edited or deleted meanwhile: what was read is not what is there.
    const now = ((getContext() || {}).chat || [])[id];
    if (now !== msg || msg.mes !== text) return "skipped";
    const r = parseContinuity(answer);
    keep(msg, r.ok ? { ok: true, at: Date.now() } : { findings: r.findings, at: Date.now() });
    drawContinuityNote(id);
    try { await saveChat(); } catch (e) { /* SillyTavern saves it with the next message anyway */ }
    return r.ok ? "ok" : "found";
}

/** MESSAGE_RECEIVED: the reply is read a moment later; nothing waits for it. */
export function vcrpContinuityOnReply(messageId, type) {
    if (type === "first_message" || !continuityOn()) return;
    const id = Number(messageId);
    setTimeout(() => { checkContinuity(id).catch(e => console.warn("[VCRP] Continuity check failed", e)); }, WAIT_MS);
}

// ── The line under a reply ───────────────────────────────────────────────────

/** What to say under a reply: { short, findings } or null (nothing found, waved off, not checked). Pure. */
export function continuityNoteFor(msg) {
    const c = msg && !msg.is_user && msg.extra && msg.extra.vcrp_continuity;
    const findings = c && Array.isArray(c.findings) ? c.findings.filter(f => f && f.quote && f.fact) : [];
    if (!findings.length) return null;
    const f = findings[0];
    return { short: `May contradict the story: "${f.quote.slice(0, 80)}${f.quote.length > 80 ? "…" : ""}" against "${f.fact.slice(0, 90)}${f.fact.length > 90 ? "…" : ""}"${findings.length > 1 ? ` (and ${findings.length - 1} more)` : ""}.`, findings };
}

const escape = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The findings in a dialog, with what can be done about them (a <dialog>: fixed overlays get
// squashed on a phone).
function openFindings(id, doc) {
    const ctx = getContext() || {};
    const chat = ctx.chat || [];
    const msg = chat[id];
    const note = continuityNoteFor(msg);
    if (!note || !doc || typeof doc.createElement !== "function") return;
    const last = id === chat.length - 1;
    const dlg = doc.createElement("dialog");
    dlg.className = "vcrp-text-dialog vcrp-continuity-dialog";
    dlg.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px; max-width:min(92vw, 560px);">
        <b>This reply may contradict the story</b>
        <div style="font-size:0.8rem; line-height:1.5;">${note.findings.map(f => `<div style="margin-bottom:8px;">The reply: <i>"${escape(f.quote)}"</i><br>Established: ${escape(f.fact)}</div>`).join("")}</div>
        <div style="font-size:0.72rem; opacity:.75;">Found by the helper model reading the reply against the Canon sheet and the scene before it. It can be wrong.</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
            ${last ? `<button type="button" class="ps-modern-btn vcrp-cont-fix" title="Swipes this reply, with the established facts as that swipe's direction">Swipe with the correction</button>` : ""}
            <button type="button" class="ps-modern-btn secondary vcrp-cont-fine" title="Takes the line away; the reply stays as it is">It is fine</button>
            <button type="button" class="ps-modern-btn secondary vcrp-cont-close">Close</button>
        </div></div>`;
    const close = () => { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); };
    dlg.querySelector(".vcrp-cont-close").addEventListener("click", close);
    dlg.querySelector(".vcrp-cont-fine").addEventListener("click", async () => {
        keep(msg, { ok: true, waved: true, at: Date.now() });
        drawContinuityNote(id, doc);
        close();
        try { await saveChat(); } catch (e) { /* saved with the next message */ }
    });
    const fix = dlg.querySelector(".vcrp-cont-fix");
    if (fix) fix.addEventListener("click", async () => {
        setOneShot(correctionText(note.findings));
        close();
        const started = await swipeLastReply(id);
        if (typeof toastr !== "undefined") {
            if (started) toastr.info("Swiping, with the established facts as this swipe's direction (VCRP Quick → Next reply only shows it).", "VCRP: continuity");
            else toastr.warning("VCRP could not swipe by itself here. The correction is waiting in VCRP Quick → Next reply only: swipe, and it goes with it.", "VCRP: continuity");
        }
    });
    doc.body.appendChild(dlg);
    if (typeof dlg.showModal === "function") { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } } else dlg.setAttribute("open", "");
}

/** Draws (or takes away) the line under message `id`. */
export function drawContinuityNote(id, doc = typeof document !== "undefined" ? document : null) {
    const el = doc && doc.querySelector(`#chat .mes[mesid="${id}"]`);
    if (!el) return;
    const old = el.querySelector(`.${NOTE}`);
    const msg = (((getContext() || {}).chat) || [])[Number(id)];
    const note = continuityNoteFor(msg);
    if (!note) { if (old) old.remove(); return; }
    const line = old || doc.createElement("div");
    line.className = `${NOTE} vcrp-finish-note cut`;
    line.textContent = `⚠ ${note.short} Tap for what to do.`;
    if (!old) {
        line.addEventListener("click", e => { e.stopPropagation(); openFindings(Number(id), doc); });
        (el.querySelector(".mes_block") || el).appendChild(line);
    }
}

/** Every message on screen (a chat opened, more loaded). */
export function drawAllContinuityNotes(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    doc.querySelectorAll("#chat .mes[mesid]").forEach(el => drawContinuityNote(el.getAttribute("mesid"), doc));
}
