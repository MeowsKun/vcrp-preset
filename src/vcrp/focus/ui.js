// ─────────────────────────────────────────────────────────────────────────────
// The Focus tab: the plot focus, then the drift audits (settings, the audit waiting for
// review, the correction in the prompt, and what audits have flagged so far).
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { saveProfileToMemory, saveProfileDebounced } from "../../core/profile.js";
import { syncPromptsGlobally } from "../../core/sync.js";
import { DEFAULT_PROMPTS } from "../../prompts/index.js";
import { renderPromptEditor } from "../../ui/promptEditor.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import {
    FOCUS_CHECKS, FOCUS_MIN_REPLIES, FOCUS_MAX_FAILURES, focusSettings, peekFocusState, repliesSinceAudit, focusEstimate, focusStanding,
    focusAuditRunning, runFocusAudit, approveFocusAudit, discardFocusAudit, setFocusNote, removeFocusItem, resetFocus,
    onFocusChange, PLOT_STRENGTHS, PLOT_DEFAULTS, plotFocusActive, plotFocusRemaining, setPlotFocus,
} from "./index.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const when = t => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const KIND_COLOR = { drift: "#f59e0b", motif: "#a855f7", slop: "#ef4444", plot: "#2dd4bf" };
const kindBadge = k => `<span style="display:inline-block; min-width:44px; text-align:center; font-size:0.62rem; font-weight:700; text-transform:uppercase; padding:1px 6px; border-radius:6px; margin-right:6px; color:${KIND_COLOR[k] || "var(--text-muted)"}; background:rgba(255,255,255,0.06);">${esc(k)}</span>`;

let shown = null;   // the container the tab is drawn in, redrawn when an audit lands
let listening = false;

function ensureFocusSettings() {
    if (!localProfile.focus || typeof localProfile.focus !== "object") localProfile.focus = {};
    const s = focusSettings();
    Object.assign(localProfile.focus, { enabled: s.enabled, every: s.every, checks: { ...s.checks }, standing: s.standing });
    return localProfile.focus;
}

function statusLine(s, st) {
    if (focusAuditRunning()) return `<i class="fa-solid fa-spinner fa-spin"></i> An audit is running.`;
    if (st && st.pending) return `<i class="fa-solid fa-circle-pause" style="color:#f59e0b;"></i> An audit is waiting for your review below. Automatic audits hold until you approve or discard it.`;
    if (st && (st.failures || 0) >= FOCUS_MAX_FAILURES) return `<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> Automatic audits are paused after ${st.failures} failed audits. Use Audit now to retry.`;
    const since = repliesSinceAudit();
    const left = s.every - since;
    const last = st && st.lastAuditAt ? ` Last audit: ${esc(when(st.lastAuditAt))}${st.lastClean ? ", no drift found" : ""}.` : " No audit yet in this chat.";
    return left > 0
        ? `Next audit in <b>${left}</b> ${left === 1 ? "reply" : "replies"}.${last}`
        : `The next audit runs after the next reply.${last}`;
}

function estimateLine() {
    const e = focusEstimate();
    return e ? `Next audit: ${esc(e.text)}` : `An audit needs at least ${FOCUS_MIN_REPLIES} replies to read.`;
}

function plotStatus(st) {
    const p = { ...PLOT_DEFAULTS, ...((st && st.plot) || {}) };
    if (!p.active) return "Off. Nothing is sent.";
    if (!p.text.trim()) return `<i class="fa-solid fa-pen" style="color:#f59e0b;"></i> On, but empty: write what the story should revolve around.`;
    const left = plotFocusRemaining(st);
    if (left <= 0) return `<i class="fa-solid fa-flag-checkered" style="color:#f59e0b;"></i> It has run its ${esc(p.endAfter)} replies and is no longer sent. Switch it off and on again to restart the count.`;
    return `<i class="fa-solid fa-circle-check" style="color:#2dd4bf;"></i> Goes out with every reply, last in the prompt${Number.isFinite(left) ? `: <b>${left}</b> ${left === 1 ? "reply" : "replies"} left` : ", until you switch it off"}.`;
}

function plotPanel(st) {
    const p = { ...PLOT_DEFAULTS, ...((st && st.plot) || {}) };
    return `
        <div class="mtab-panel" id="focus_plot_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-compass"></i> Plot focus</div>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info">
                    <div class="set-label">Steer the story around something</div>
                    <div class="set-desc">While on, it goes out with every reply as the last thing the model reads, right after your message. That part of the prompt is never cached, so it costs only its own few dozen tokens. Story Memory's recall looks for it, drift audits check the story stays on it, and the Story Director plans around it.</div>
                </div>
                <input type="checkbox" id="focus_plot_on" ${p.active ? "checked" : ""} />
            </div>
            <div class="set-label" style="margin:10px 0 4px;">What should the story revolve around?</div>
            <textarea id="focus_plot_text" class="ps-modern-input" rows="3" style="width:100%; background:rgba(0,0,0,0.2);" placeholder="e.g. The ring Mara pawned, and the people who want it back">${esc(p.text)}</textarea>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">How hard it steers</div><div class="set-desc">Background thread: surfaces now and then. Central: scenes keep coming back to it. Driving: every reply moves it forward.</div></div>
                <select id="focus_plot_strength" class="ps-modern-input" style="width:180px; cursor:pointer;">
                    ${Object.entries(PLOT_STRENGTHS).map(([k, d]) => `<option value="${k}" ${p.strength === k ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
                </select>
            </div>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">End after</div><div class="set-desc">Replies it lasts, counted from when you switch it on. 0 keeps it until you switch it off.</div></div>
                <input type="number" id="focus_plot_end" class="ps-modern-input" value="${Number(p.endAfter) || 0}" min="0" max="500" style="width:90px; text-align:center; background:rgba(0,0,0,0.2);" />
            </div>
            <div id="focus_plot_status" class="set-desc" style="margin-top:10px;">${plotStatus(st)}</div>
        </div>`;
}

function wirePlotPanel(c) {
    const status = () => c.find("#focus_plot_status").html(plotStatus(peekFocusState()));
    c.find("#focus_plot_on").on("change", async function () { await setPlotFocus({ active: $(this).is(":checked") }); status(); });
    c.find("#focus_plot_text").on("change", async function () { await setPlotFocus({ text: String($(this).val() || "") }); status(); });
    c.find("#focus_plot_strength").on("change", async function () { await setPlotFocus({ strength: String($(this).val()) }); });
    c.find("#focus_plot_end").on("change", async function () {
        let v = Math.round(Number($(this).val()));
        if (!Number.isFinite(v) || v < 0) v = 0;
        if (v > 500) v = 500;
        $(this).val(v);
        await setPlotFocus({ endAfter: v });
        status();
    });
}

function pendingPanel(st) {
    const p = st.pending;
    const byId = Object.fromEntries((st.items || []).map(i => [i.id, i]));
    const back = (p.recurring || []).filter(id => byId[id]).map(id => `<div style="margin:3px 0;">${kindBadge(byId[id].kind)}${esc(byId[id].text)} <span style="opacity:.7;">(came back: ${byId[id].times + 1} times now)</span></div>`).join("");
    const found = (p.findings || []).map(f => `<div style="margin:3px 0;">${kindBadge(f.kind)}${esc(f.text)}</div>`).join("");
    return `
        <div class="mtab-panel" style="border-color: rgba(245,158,11,0.35);">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-clipboard-check"></i> Waiting for review</div>
            <div class="set-desc" style="margin-bottom:8px;">Audit of the last ${esc(p.replies)} replies, ${esc(when(p.at))}. Nothing reaches the prompt until you approve it.</div>
            ${back ? `<div style="margin-bottom:8px;"><b style="font-size:0.78rem;">Came back after an earlier correction</b>${back}</div>` : ""}
            ${found ? `<div style="margin-bottom:8px;"><b style="font-size:0.78rem;">New findings</b>${found}</div>` : ""}
            <div class="set-label" style="margin:8px 0 4px;">The correction it wrote (edit before approving if you like)</div>
            <textarea id="focus_pending_note" class="ps-modern-input" rows="6" style="width:100%; background:rgba(0,0,0,0.2);" placeholder="No new correction: approving keeps the current one and records the findings.">${esc(p.note)}</textarea>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button id="focus_approve" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Approve and use</button>
                <button id="focus_discard" class="ps-modern-btn secondary" style="font-size:0.75rem;"><i class="fa-solid fa-xmark"></i> Discard</button>
            </div>
        </div>`;
}

export function renderFocusTab(c) {
    shown = c;
    if (!listening) {
        listening = true;
        onFocusChange(() => { if (shown && shown.closest("body").length && shown.find("#focus_enable").length) renderFocusTab(shown); });
    }
    const rerender = () => renderFocusTab(c);
    c.empty();
    const f = ensureFocusSettings();
    const s = focusSettings();
    const st = peekFocusState();
    const on = s.enabled || plotFocusActive(st);

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #14b8a6, #0f766e);"><i class="fa-solid fa-crosshairs"></i></div>
                <div><h2>Focus</h2><p>Keeps a long story on track: steer it around a plot focus of your choosing, and audit it every few replies for character drift, repeated motifs and slop.</p></div>
            </div>
            <div class="mtab-header-badge" style="color:${on ? "#2dd4bf" : "var(--text-muted)"};"><i class="fa-solid fa-${on ? "circle-check" : "circle-xmark"}" style="font-size:0.6rem;"></i> ${on ? "Enabled" : "Disabled"}</div>
        </div>
        ${plotPanel(st)}
        <div class="mtab-toggle-row ${s.enabled ? "active" : ""}" id="focus_enable" style="margin-bottom:14px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-crosshairs" style="color:#2dd4bf;"></i> Enable drift audits</div>
                <div class="toggle-desc">An audit runs on its own every few replies. Its correction waits here for your approval, then goes with every reply until the next one replaces it.</div>
            </div>
            <div class="ps-switch"></div>
        </div>`);

    wirePlotPanel(c);
    c.find("#focus_enable").on("click", () => { f.enabled = !s.enabled; saveProfileToMemory(); rerender(); });

    if (!s.enabled) {
        c.append(`
            <div class="mtab-callout">
                <i class="fa-solid fa-circle-info"></i>
                <span>Each audit is a call of its own to your model, never cached: on a long chat with Claude Opus, about $0.15 to $0.30 an audit at the default of every 20 replies. The correction itself sits in the per-turn rules after the chat history, so it never breaks the cache.</span>
            </div>`);
        c.append(focusPromptEditor(f));
        return;
    }

    const items = (st && st.items) || [];
    const standing = focusStanding(st);
    const standingIds = new Set(s.standing && st && st.note ? standing.map(i => i.id) : []);
    const standingHtml = s.standing && standing.length ? `
            <div class="set-desc" style="margin-top:8px;">${st && st.note ? "Also sent with it, as repeat offenders:" : "Repeat offenders, sent with the next correction:"}
                ${standing.map(i => `<div style="margin:3px 0 0 6px;">${kindBadge(i.kind)}${esc(i.text)} <span style="opacity:.6;">(flagged ${i.times} times)</span></div>`).join("")}
            </div>` : "";
    const itemRows = items.length
        ? [...items].sort((a, b) => (b.times - a.times) || (b.last - a.last)).map(i => `
            <div style="display:flex; align-items:flex-start; gap:6px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="flex:1; font-size:0.8rem;">${kindBadge(i.kind)}${esc(i.text)} <span style="opacity:.6; font-size:0.72rem;">${esc(i.id)} · flagged ${i.times} ${i.times === 1 ? "time" : "times"}${standingIds.has(i.id) ? " · in the prompt" : ""}</span></div>
                <button class="focus_item_remove" data-id="${esc(i.id)}" title="Forget this finding" style="background:transparent; border:none; color:#ef4444; cursor:pointer; font-size:0.75rem;"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join("")
        : `<div class="set-desc">Nothing yet. Findings from approved audits collect here, and each audit is told which ones keep coming back.</div>`;

    c.append(`
        <div class="mtab-panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-sliders"></i> Audit</div>
            <div class="mtab-setting-row">
                <div class="set-info">
                    <div class="set-label">Audit every</div>
                    <div class="set-desc">Replies between audits. Each audit reads that many of the latest replies (and your messages between them). Fewer replies: more often, each one cheaper.</div>
                </div>
                <input type="number" id="focus_every" class="ps-modern-input" value="${s.every}" min="5" max="100" style="width:90px; text-align:center; background:rgba(0,0,0,0.2);" />
            </div>
            ${Object.entries(FOCUS_CHECKS).map(([k, d]) => `
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">${esc(d.label)}</div><div class="set-desc">${esc(d.desc)}</div></div>
                <input type="checkbox" id="focus_check_${k}" ${s.checks[k] ? "checked" : ""} />
            </div>`).join("")}
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">Keep repeat offenders</div><div class="set-desc">Up to 3 findings that came back after a correction (flagged in 2 or more audits) stay in the prompt alongside every new correction, so what an earlier one fixed does not creep back when the next one leaves it out. A few dozen tokens a reply; never touches the cache.</div></div>
                <input type="checkbox" id="focus_standing" ${s.standing ? "checked" : ""} />
            </div>
            <div id="focus_status" class="set-desc" style="margin-top:12px;">${statusLine(s, st)}</div>
            <div id="focus_estimate" class="set-desc" style="margin-top:4px;">${estimateLine()}</div>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button id="focus_audit_now" class="ps-modern-btn secondary" style="font-size:0.72rem;" ${focusAuditRunning() ? "disabled" : ""}><i class="fa-solid fa-magnifying-glass"></i> Audit now</button>
                <button id="focus_reset" class="ps-modern-btn secondary" style="font-size:0.72rem; color:#ef4444;"><i class="fa-solid fa-trash"></i> Reset this chat's Focus</button>
            </div>
        </div>
        ${st && st.pending ? pendingPanel(st) : ""}
        <div class="mtab-panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-bullseye"></i> Correction in the prompt</div>
            <div class="set-desc" style="margin-bottom:8px;">${st && st.note ? `Goes with every reply, in the per-turn rules after the chat history${st.noteAt ? `, since ${esc(when(st.noteAt))}` : ""}. Edit it here; the change goes out with the next reply.` : "None yet. An approved audit puts its correction here."}</div>
            <textarea id="focus_note" class="ps-modern-input" rows="6" style="width:100%; background:rgba(0,0,0,0.2);" placeholder="No correction in the prompt.">${esc(st && st.note)}</textarea>
            ${standingHtml}
            ${st && st.note ? `<div style="margin-top:8px;"><button id="focus_clear_note" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-eraser"></i> Take it out of the prompt</button></div>` : ""}
        </div>
        <div class="mtab-panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-list-check"></i> What audits have flagged</div>
            ${itemRows}
        </div>`);

    c.find("#focus_every").on("change", function () {
        let v = Math.round(Number($(this).val()));
        if (!Number.isFinite(v) || v < 5) v = 5;
        if (v > 100) v = 100;
        $(this).val(v);
        f.every = v; saveProfileToMemory();
        c.find("#focus_status").html(statusLine(focusSettings(), peekFocusState()));
        c.find("#focus_estimate").html(estimateLine());
    });
    Object.keys(FOCUS_CHECKS).forEach(k => c.find(`#focus_check_${k}`).on("change", function () {
        const next = { ...f.checks, [k]: $(this).is(":checked") };
        if (!Object.values(next).some(Boolean)) {
            $(this).prop("checked", true);
            if (typeof toastr !== "undefined") toastr.info("Keep at least one check on, or switch Focus off.", "VCRP Focus");
            return;
        }
        f.checks = next; saveProfileToMemory();
    }));
    c.find("#focus_standing").on("change", function () { f.standing = $(this).is(":checked"); saveProfileToMemory(); rerender(); });
    c.find("#focus_audit_now").on("click", async function () {
        const btn = $(this);
        btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Auditing…`);
        const r = await runFocusAudit();
        if (typeof toastr !== "undefined") {
            if (r.status === "pending") toastr.info("The audit is ready for review below.", "VCRP Focus");
            else if (r.status === "clean") toastr.success("No drift found.", "VCRP Focus");
            else if (r.status === "busy") toastr.info("Another generation is running. Try again when it finishes.", "VCRP Focus");
            else if (r.status === "idle") toastr.info(`Nothing to audit yet: ${r.reason}.`, "VCRP Focus");
            else toastr.warning(`The audit did not finish: ${r.reason}.`, "VCRP Focus");
        }
        if (c.closest("body").length) rerender();
    });
    c.find("#focus_reset").on("click", async () => {
        if (!confirm("Reset Focus for this chat? The correction, the audit waiting for review and everything audits have flagged are removed. Your settings stay.")) return;
        await resetFocus();
        rerender();
    });
    c.find("#focus_approve").on("click", async () => {
        await approveFocusAudit(String(c.find("#focus_pending_note").val() || ""));
        if (typeof toastr !== "undefined") toastr.success("The correction goes out with the next reply.", "VCRP Focus");
        rerender();
    });
    c.find("#focus_discard").on("click", async () => { await discardFocusAudit(); rerender(); });
    c.find("#focus_note").on("change", async function () { await setFocusNote($(this).val()); });
    c.find("#focus_clear_note").on("click", async () => { await setFocusNote(""); rerender(); });
    c.find(".focus_item_remove").on("click", async function () { await removeFocusItem(String($(this).attr("data-id"))); rerender(); });
    c.append(focusPromptEditor(f));
}

// The wording of the audit, its correction and the plot focus, editable like the Story
// Director's. Edits are shared by every character (as the other prompt editors are) and
// stored as a difference from the built-in text.
function focusPromptEditor(f) {
    const KEEP = "Keep the &lt;recurring&gt;, &lt;findings&gt; and &lt;note&gt; answer format: the audit's answer is read from those tags.";
    return renderPromptEditor({
        id: "focus_prompt_editor",
        title: "Advanced: Edit Prompts",
        defaultData: DEFAULT_PROMPTS.focus,
        currentData: f.customPrompts,
        enabled: !!f.customPromptsEnabled,
        onToggle: (val) => {
            f.customPromptsEnabled = val;
            syncPromptsGlobally("focus", "customPromptsEnabled", val);
            saveProfileToMemory();
        },
        fields: [
            { key: "auditSystem", label: "Audit: system prompt", hint: "Who the auditor is." },
            { key: "auditTask", label: "Audit: task", hint: `Tokens: <code>{{char}}</code>, <code>{{checks}}</code> (the checks below that are on), <code>{{kinds}}</code>, <code>{{plotNote}}</code>. ${KEEP}` },
            { key: "checkDrift", label: "Check: character drift", hint: "Tokens: <code>{{char}}</code>. Start the line with <code>[drift]</code>." },
            { key: "checkMotifs", label: "Check: repeated motifs", hint: "Start the line with <code>[motif]</code>." },
            { key: "checkSlop", label: "Check: slop", hint: "Start the line with <code>[slop]</code>." },
            { key: "checkPlot", label: "Check: plot drift (when a plot focus is on)", hint: "Tokens: <code>{{strength}}</code>. Start the line with <code>[plot]</code>." },
            { key: "plotNote", label: "Audit: extra line for plot drift", hint: "Added to the note's instructions while a plot focus is on." },
            { key: "correctionTemplate", label: "Correction in the prompt", hint: "Tokens: <code>{{note}}</code>, <code>{{standing}}</code> (the repeat offenders, when there are any)." },
            { key: "standingIntro", label: "Repeat offenders: heading", hint: "The line above the repeat offenders." },
            { key: "plotTemplate", label: "Plot focus in the prompt", hint: "Tokens: <code>{{plot}}</code>, <code>{{strength}}</code>, <code>{{user}}</code>. Sent last, after your message." },
            { key: "plotThread", label: "Plot focus: background thread", hint: "What <code>{{strength}}</code> says at this setting." },
            { key: "plotCentral", label: "Plot focus: central", hint: "What <code>{{strength}}</code> says at this setting." },
            { key: "plotDriving", label: "Plot focus: driving", hint: "What <code>{{strength}}</code> says at this setting." },
        ],
        onSave: (val, key) => {
            if (!f.customPrompts) f.customPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS.focus));
            f.customPrompts[key] = val;
            syncPromptsGlobally("focus", "customPrompts", f.customPrompts);
            saveProfileDebounced();
            return f.customPrompts;
        },
        onReset: () => {
            f.customPrompts = null;
            syncPromptsGlobally("focus", "customPrompts", null);
            saveProfileToMemory();
        },
    });
}
