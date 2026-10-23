// ─────────────────────────────────────────────────────────────────────────────
// The Author's Notebook's panel, in the Focus tab: the switch, the live truths behind a
// spoiler (each editable, or marked revealed, or deleted), and the past ones with their
// clues (each can be made live again). Every change is the reader's, kept with the chat.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../st.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { splitNames } from "./model.js";
import {
    notebookOn, notebookForced, setNotebookOn, notebookFromChat, liveTruths, pastTruths, LIVE_CAP,
    editTruth, forgetTruth, revealTruth, restoreTruth, turnLabel,
} from "./index.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);

// Which spoilers the reader has open, so a save or a reveal (which redraw the tab) leaves
// them open. In this chat only: another chat's truths stay folded until asked for.
const opened = { live: false, past: false, chat: null };
function openedHere() {
    let id = null;
    try { id = (getContext() || {}).chatId || null; } catch (e) { id = null; }
    if (opened.chat !== id) Object.assign(opened, { live: false, past: false, chat: id });
    return opened;
}

function statusLine(on, live) {
    if (!on) return "Off. Nothing is sent.";
    if (!live.length) return `<i class="fa-solid fa-pen" style="color:#0ea5e9;"></i> Empty: the next reply writes it, two or three truths built from the card, the setting and the story so far.`;
    return `<i class="fa-solid fa-circle-check" style="color:#0ea5e9;"></i> <b>${live.length}</b> of ${LIVE_CAP} truths live. Each turn the model reads them after the chat (never cached) and notes a clue, who found out, or what came out.`;
}

const clueRows = t => (t.clues || []).map(c => `<div class="set-desc" style="margin:2px 0 0 8px;">🔎 ${esc(turnLabel(c.seq))}: ${esc(c.text)}${c.found === false ? ` <span style="color:#f59e0b;">(not found in the reply)</span>` : ""}</div>`).join("");

function liveCard(t) {
    const field = (key, label, value, rows = 2) => `
        <div class="set-label" style="margin:6px 0 2px; font-size:0.72rem;">${label}</div>
        <textarea class="ps-modern-input nb_field" data-id="${esc(t.id)}" data-key="${key}" rows="${rows}" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.75rem;">${esc(value)}</textarea>`;
    return `
        <div class="mtab-panel" style="margin:8px 0; padding:10px;">
            <div style="font-weight:700; font-size:0.8rem; color:#0ea5e9;">${esc(t.id)} <span class="set-desc" style="font-weight:400;">written in ${esc(turnLabel(t.createdSeq))}</span></div>
            ${field("truth", "Truth", t.truth, 3)}
            ${field("hiddenFrom", "Hidden from (comma separated)", (t.hiddenFrom || []).join(", "), 1)}
            ${field("when", "Comes out when", t.when)}
            ${field("changes", "What it changes", t.changes)}
            ${field("clueIdeas", "Clue ideas", t.clueIdeas)}
            ${(t.clues || []).length ? `<div class="set-label" style="margin:6px 0 2px; font-size:0.72rem;">Clues planted</div>${clueRows(t)}` : ""}
            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                <button class="ps-modern-btn primary nb_save" data-id="${esc(t.id)}" style="font-size:0.7rem;"><i class="fa-solid fa-check"></i> Save changes</button>
                <button class="ps-modern-btn secondary nb_reveal" data-id="${esc(t.id)}" style="font-size:0.7rem;"><i class="fa-solid fa-eye"></i> Mark revealed</button>
                <button class="ps-modern-btn secondary nb_forget" data-id="${esc(t.id)}" style="font-size:0.7rem; color:#ef4444;"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
        </div>`;
}

function pastRow(t, canRestore) {
    const how = t.revealedHow === "user" ? "marked revealed by you" : t.revealedHow === "learned" ? "everyone found out" : "came out";
    return `
        <div style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:0.78rem;"><b>${esc(t.id)}</b> ${esc(t.truth)}</div>
            <div class="set-desc">${esc(how)} in ${esc(turnLabel(t.revealedSeq))}</div>
            ${clueRows(t)}
            <button class="ps-modern-btn secondary nb_restore" data-id="${esc(t.id)}" style="font-size:0.68rem; margin-top:4px;" ${canRestore ? "" : `disabled title="${LIVE_CAP} truths are already live"`}><i class="fa-solid fa-rotate-left"></i> Activate again</button>
        </div>`;
}

/** The panel's HTML for the open chat. */
export function notebookPanel() {
    const on = notebookOn();
    const forced = notebookForced();
    const { state } = notebookFromChat();
    const live = liveTruths(state), past = pastTruths(state);
    const open = openedHere();
    return `
        <div class="mtab-panel" id="focus_notebook_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-book"></i> Author's Notebook</div>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info">
                    <div class="set-label">The story keeps secrets and pays them off</div>
                    <div class="set-desc">Megumin Suite V11's notebook: the story decides two or three hidden truths early, plants small clues and reveals each one when the story earns it, instead of forgetting a secret or blurting it out. VCRP keeps the rules (at most ${LIVE_CAP} live, a truth never quietly rewritten, a clue the reply never shows marked as such). It is read from this chat's replies, so swipes, edits and deletes undo exactly what a reply did. Its fixed rules sit in the cached part of the prompt; the live truths ride after the chat.${forced ? " <b>Always on with V11 Тайна</b>, whose own text speaks of its notebook." : ""}</div>
                </div>
                <input type="checkbox" id="focus_nb_on" ${on ? "checked" : ""} ${forced ? "disabled" : ""} />
            </div>
            <div id="focus_nb_status" class="set-desc" style="margin-top:8px;">${statusLine(on, live)}</div>
            ${live.length ? `<details class="nb_spoiler" data-which="live" style="margin-top:8px;" ${open.live ? "open" : ""}><summary class="set-desc" style="cursor:pointer;"><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> Show the live truths (spoilers)</summary>${live.map(liveCard).join("")}</details>` : ""}
            ${past.length ? `<details class="nb_spoiler" data-which="past" style="margin-top:8px;" ${open.past ? "open" : ""}><summary class="set-desc" style="cursor:pointer;">Past: ${past.length} ${past.length === 1 ? "truth" : "truths"} that came out</summary>${past.map(t => pastRow(t, live.length < LIVE_CAP)).join("")}</details>` : ""}
        </div>`;
}

/** Its handlers; `rerender` redraws the tab. */
export function wireNotebookPanel(c, rerender) {
    c.find("#focus_nb_on").on("change", function () { setNotebookOn($(this).is(":checked")); saveProfileToMemory(); rerender(); });
    c.find(".nb_spoiler").on("toggle", function () { openedHere()[String($(this).attr("data-which"))] = this.open; });
    c.find(".nb_save").on("click", function () {
        const id = String($(this).attr("data-id"));
        const fields = {};
        c.find(`.nb_field[data-id="${id}"]`).each(function () {
            const key = String($(this).attr("data-key"));
            const v = String($(this).val() || "").trim();
            fields[key] = key === "hiddenFrom" ? splitNames(v) : v;
        });
        if (!fields.truth) { if (typeof toastr !== "undefined") toastr.warning("A truth can't be empty: delete it instead."); return; }
        editTruth(id, fields);
        if (typeof toastr !== "undefined") toastr.success(fields.hiddenFrom && !fields.hiddenFrom.length ? `${id} is hidden from no one now, so it came out.` : `${id} saved. The next reply reads it.`, "Author's Notebook");
        rerender();
    });
    c.find(".nb_reveal").on("click", function () { revealTruth(String($(this).attr("data-id"))); rerender(); });
    c.find(".nb_forget").on("click", function () {
        const id = String($(this).attr("data-id"));
        if (!confirm(`Delete ${id} from the notebook? The story stops keeping it.`)) return;
        forgetTruth(id);
        rerender();
    });
    c.find(".nb_restore").on("click", function () { restoreTruth(String($(this).attr("data-id"))); rerender(); });
}
