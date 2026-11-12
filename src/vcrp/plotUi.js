// ─────────────────────────────────────────────────────────────────────────────
// The Plot tab: where the story is going, in the reader's hands.
//   - Arc (arc.js): the arc that is running, and starting a new one, by hand or from three
//     pitches; Story Memory closing the one that ends.
//   - Beats (beats.js): plot points lined up ahead, fired on a tap or after some replies.
//   - Open ends (threads.js): the threads, seeds and timers the story has left hanging, with
//     their real ages, and the ones that left the list.
// Everything here is the chat's own, except the reminders' switch (the profile's).
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../core/state.js";
import { saveProfileToMemory } from "../core/profile.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { SD_GENRES } from "../features/storyplan/ui.js";
import { arcs, startArc, editArc, endArc, pitchArcs, clearPitches, arcPitchEstimate, arcPitchRunning } from "./arc.js";
import { beatQueue, addBeat, editBeat, removeBeat, moveBeat, fireBeat, requeueBeat } from "./beats.js";
import { threadLedger, threadNudgesOn, setThreadIgnored, threadsDue, STALE_AFTER, SEED_STALE, NUDGE_EVERY } from "./threads.js";
import { vcrpMemoryEnabled, memoryState } from "./memory/index.js";
import { closeStoryArc } from "./memory/summarize.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const CUSTOM = "custom";
const count = (n, word) => `${n} ${n === 1 ? word : (word === "reply" ? "replies" : `${word}s`)}`;
const say = (kind, text) => { if (typeof toastr !== "undefined") toastr[kind](text, "VCRP: plot"); };

// What the reader has typed into the new-arc form, kept across redraws of the tab.
const form = { genre: "", custom: "", tone: "", wish: "", title: "", premise: "", opens: "", close: true, closeName: "" };

// ── Arc ──────────────────────────────────────────────────────────────────────

// Story Memory's chapters that closing an arc would fold (not folded yet, not pinned).
function foldable() {
    if (!vcrpMemoryEnabled()) return 0;
    const st = memoryState();
    return ((st && st.chapters) || []).filter(c => !c.folded && !c.pinned).length;
}

function arcPanel() {
    const a = arcs();
    const cur = a.current;
    const genreLabel = form.genre === CUSTOM ? form.custom : (SD_GENRES[form.genre] ? SD_GENRES[form.genre].label : "");
    let estimate = "";
    try { estimate = arcPitchEstimate({ genre: genreLabel, tone: form.tone, wish: form.wish }).text; } catch (e) { estimate = ""; }
    const n = foldable();
    const closeName = form.closeName || (cur ? cur.title : "The story so far");
    const pitches = a.pitches.map((p, i) => `
        <div class="plot-pitch" style="border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px; margin-top:6px;">
            <b style="font-size:0.82rem;">${esc(p.title)}</b>
            <div class="set-desc" style="margin:4px 0;">${esc(p.premise)}</div>
            ${p.opens ? `<div class="set-desc" style="opacity:.8;"><i class="fa-solid fa-play" style="font-size:0.6rem;"></i> Opens with: ${esc(p.opens)}</div>` : ""}
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
                <button class="ps-modern-btn primary plot-pitch-start" data-i="${i}" style="font-size:0.72rem;"><i class="fa-solid fa-flag"></i> Start this arc</button>
                <button class="ps-modern-btn secondary plot-pitch-edit" data-i="${i}" style="font-size:0.72rem;" title="Puts it in the boxes below, to change before starting"><i class="fa-solid fa-pen"></i> Edit first</button>
            </div>
        </div>`).join("");
    return `
        <div class="mtab-panel" id="plot_arc_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-flag"></i> Arc</div>
            <div class="set-desc" style="margin-bottom:8px;">A stretch of the story with its own genre, tone and premise. Everyone in it stays who they are; the arc is what the story is about now. It goes with every reply as the last thing the model reads (never cached, a few dozen tokens). Kept with this chat.</div>
            ${cur ? `
            <div id="plot_arc_current" style="border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:10px; margin-bottom:10px;">
                <div class="set-label" style="margin-bottom:6px;">Running now, for ${count(cur.replies, "reply")}</div>
                <input id="plot_arc_title" class="ps-modern-input" value="${esc(cur.title)}" placeholder="Its name" style="width:100%; margin-bottom:6px; font-size:0.8rem;">
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                    <input id="plot_arc_genre" class="ps-modern-input" value="${esc(cur.genre)}" placeholder="Genre" style="flex:1; min-width:120px; font-size:0.78rem;">
                    <input id="plot_arc_tone" class="ps-modern-input" value="${esc(cur.tone)}" placeholder="Tone" style="flex:1; min-width:120px; font-size:0.78rem;">
                </div>
                <textarea id="plot_arc_premise" class="ps-modern-input" rows="4" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.78rem;">${esc(cur.premise)}</textarea>
                <div style="margin-top:6px;"><button id="plot_arc_end" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-flag-checkered"></i> End this arc</button></div>
            </div>` : `<div class="set-desc" style="margin-bottom:10px;"><i class="fa-solid fa-circle-info"></i> No arc is running: nothing is sent for one.</div>`}
            <details id="plot_arc_new" ${cur ? "" : "open"}>
                <summary class="set-label" style="cursor:pointer;">${cur ? "Start a new arc (this one ends)" : "Start an arc"}</summary>
                <div style="margin-top:8px;">
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                        <select id="plot_new_genre" class="ps-modern-input" style="flex:1; min-width:140px; cursor:pointer; font-size:0.78rem;">
                            <option value="" ${form.genre === "" ? "selected" : ""}>Any genre</option>
                            ${Object.entries(SD_GENRES).map(([id, g]) => `<option value="${id}" ${form.genre === id ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
                            <option value="${CUSTOM}" ${form.genre === CUSTOM ? "selected" : ""}>Custom…</option>
                        </select>
                        <input id="plot_new_custom" class="ps-modern-input" value="${esc(form.custom)}" placeholder="e.g. courtroom drama" style="flex:1; min-width:140px; font-size:0.78rem; display:${form.genre === CUSTOM ? "block" : "none"};">
                        <input id="plot_new_tone" class="ps-modern-input" value="${esc(form.tone)}" placeholder="Tone: e.g. tense, dry humour" style="flex:1; min-width:140px; font-size:0.78rem;">
                    </div>
                    <div class="set-label" style="margin:8px 0 4px;">Let the model pitch it</div>
                    <textarea id="plot_new_wish" class="ps-modern-input" rows="2" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.78rem;" placeholder="Optional: what you want from it. &quot;Something with Jonah's debts. Less romance for a while.&quot;">${esc(form.wish)}</textarea>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px;">
                        <button id="plot_pitch" class="ps-modern-btn secondary" style="font-size:0.75rem; color:#fbbf24; border-color:rgba(245,158,11,0.45);" ${arcPitchRunning() ? "disabled" : ""}><i class="fa-solid fa-lightbulb"></i> ${a.pitches.length ? "Pitch three more" : "Pitch three arcs"}</button>
                        <span id="plot_pitch_cost" class="set-desc">${esc(estimate)} A one-off background call: no ceiling applies to it.</span>
                    </div>
                    <div id="plot_pitches">${pitches}${a.pitches.length ? `<div style="margin-top:6px;"><button id="plot_pitch_clear" class="ps-modern-btn secondary" style="font-size:0.7rem;">Throw these away</button></div>` : ""}</div>
                    <div class="set-label" style="margin:12px 0 4px;">Or write it yourself</div>
                    <input id="plot_new_title" class="ps-modern-input" value="${esc(form.title)}" placeholder="Its name (optional)" style="width:100%; margin-bottom:6px; font-size:0.78rem;">
                    <textarea id="plot_new_premise" class="ps-modern-input" rows="3" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.78rem;" placeholder="The premise: what the story is about from here. &quot;The harbour freezes over and the town turns on its smugglers. Jonah has to choose who he owes more.&quot;">${esc(form.premise)}</textarea>
                    <input id="plot_new_opens" class="ps-modern-input" value="${esc(form.opens)}" placeholder="Its opening move (optional): goes with your next message as a beat" style="width:100%; margin-top:6px; font-size:0.78rem;">
                    ${n >= 2 ? `
                    <label style="display:flex; gap:8px; align-items:flex-start; margin-top:10px; cursor:pointer;">
                        <input type="checkbox" id="plot_new_close" ${form.close ? "checked" : ""} style="margin-top:3px;">
                        <span class="set-desc">Close what came before in <b>Story Memory</b>: its ${n} chapters fold into one entry under the name below, so the memory text reads arc by arc. The chapters stay and are recalled as before. One short background call. Messages not summarized yet join the new arc's first chapter.</span>
                    </label>
                    <input id="plot_new_close_name" class="ps-modern-input" value="${esc(closeName)}" placeholder="The name of what ends" style="width:100%; margin-top:6px; font-size:0.78rem;">` : ""}
                    <div style="margin-top:10px;"><button id="plot_new_start" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-flag"></i> Start this arc</button></div>
                </div>
            </details>
            ${a.past.length ? `<details style="margin-top:10px;"><summary class="set-desc" style="cursor:pointer;">Earlier arcs (${a.past.length})</summary>
                ${a.past.map(p => `<div class="set-desc" style="margin:6px 0 0 6px;"><b>${esc(p.title)}</b>${p.genre ? ` · ${esc(p.genre)}` : ""} · ${count(Math.max(0, (p.endedReply || 0) - (p.startedReply || 0)), "reply")}<br>${esc(p.premise)}</div>`).join("")}
            </details>` : ""}
        </div>`;
}

// ── Beats ────────────────────────────────────────────────────────────────────

function beatPanel() {
    const q = beatQueue();
    const rows = q.waiting.map((b, i) => `
        <div class="plot-beat" data-id="${esc(b.id)}" style="border-top:1px solid rgba(255,255,255,0.06); padding:6px 0;">
            <input class="ps-modern-input plot-beat-text" data-id="${esc(b.id)}" value="${esc(b.text)}" style="width:100%; font-size:0.78rem;">
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px;">
                <span class="set-desc" style="flex:1; min-width:120px;">${b.in === null ? "Waits for a tap" : b.in === 0 ? "Due: goes with your next message once the box is free" : `Fires by itself in ${count(b.in, "reply")}`}</span>
                <button class="ps-modern-btn secondary plot-beat-fire" data-id="${esc(b.id)}" style="font-size:0.7rem; color:#fbbf24; border-color:rgba(245,158,11,0.45);" title="Puts it in VCRP Quick's Next reply only box"><i class="fa-solid fa-play"></i> With the next reply</button>
                <button class="ps-modern-btn secondary plot-beat-up" data-id="${esc(b.id)}" style="padding:2px 8px;" ${i === 0 ? "disabled" : ""} title="Earlier"><i class="fa-solid fa-arrow-up"></i></button>
                <button class="ps-modern-btn secondary plot-beat-down" data-id="${esc(b.id)}" style="padding:2px 8px;" ${i === q.waiting.length - 1 ? "disabled" : ""} title="Later"><i class="fa-solid fa-arrow-down"></i></button>
                <button class="ps-modern-btn secondary plot-beat-drop" data-id="${esc(b.id)}" style="padding:2px 8px; color:#ef4444;" title="Take it out of the queue"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`).join("");
    return `
        <div class="mtab-panel" id="plot_beat_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-list-ol"></i> Beats</div>
            <div class="set-desc" style="margin-bottom:8px;">Plot points you line up ahead of time. A beat goes out with one reply, as a direction for that reply only (it lands in VCRP Quick's <i>Next reply only</i> box, where you can still change it or take it out), and is never written into the chat. It fires on a tap, or by itself after the number of replies you give it.</div>
            ${q.next ? `<div class="mtab-callout" style="margin-bottom:8px;"><i class="fa-solid fa-play"></i><span>Going with your next message: <b>${esc(q.next.text)}</b> <button class="ps-modern-btn secondary plot-beat-drop" data-id="${esc(q.next.id)}" style="padding:1px 8px; font-size:0.68rem; margin-left:6px;">Take it back out</button></span></div>` : ""}
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <input id="plot_beat_new" class="ps-modern-input" placeholder="e.g. The landlord finds the letter." style="flex:1; min-width:160px; font-size:0.78rem;">
                <input id="plot_beat_after" type="number" class="ps-modern-input" value="0" min="0" max="500" title="Replies from now until it fires by itself. 0: only on a tap." style="width:70px; text-align:center; font-size:0.78rem;">
                <button id="plot_beat_add" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-plus"></i> Queue</button>
            </div>
            <div class="set-desc" style="margin:4px 0 8px;">The number: replies from now until it fires by itself. 0 keeps it for a tap.</div>
            <div id="plot_beat_list">${rows || `<div class="set-desc">Nothing queued.</div>`}</div>
            ${q.fired.length ? `<details style="margin-top:8px;"><summary class="set-desc" style="cursor:pointer;">Fired (${q.fired.length})</summary>
                ${q.fired.map(b => `<div style="display:flex; gap:6px; align-items:flex-start; margin-top:4px;"><span class="set-desc" style="flex:1;">${esc(b.text)} <span style="opacity:.6;">(reply ${esc(b.firedAt)})</span></span><button class="ps-modern-btn secondary plot-beat-again" data-id="${esc(b.id)}" style="padding:1px 8px; font-size:0.68rem;">Queue again</button></div>`).join("")}
            </details>` : ""}
        </div>`;
}

// ── Open ends ────────────────────────────────────────────────────────────────

const KIND = { threads: { label: "Open threads", icon: "fa-fire" }, seeds: { label: "Planted seeds", icon: "fa-seedling" }, timers: { label: "Consequence timers", icon: "fa-hourglass-half" } };

function ageOf(i) {
    if (i.kind === "threads") return `open ${count(i.age, "reply")}${i.still !== i.age ? `, unmoved for ${i.still}` : ""}`;
    if (i.kind === "seeds") return `planted ${count(i.age, "reply")} ago`;
    if (i.overdue === null) return `set ${count(i.age, "reply")} ago, no count given`;
    return i.overdue >= 0 ? (i.overdue === 0 ? "due now" : `overdue by ${count(i.overdue, "reply")}`) : `due in ${count(-i.overdue, "reply")}`;
}

function threadPanel() {
    let l = null, due = [];
    try { l = threadLedger(); due = threadsDue(); } catch (e) { console.warn("[VCRP] Plot tab: the thread ledger could not be read:", e); }
    const on = threadNudgesOn();
    const dueKeys = new Set(due.map(i => i.key));
    const any = l && (l.open.length || l.closed.length);
    const section = kind => {
        const items = l.open.filter(i => i.kind === kind).sort((a, b) => (b.stale - a.stale) || (b.still - a.still) || (b.age - a.age));
        if (!items.length) return "";
        return `<div class="set-label" style="margin:10px 0 2px;"><i class="fa-solid ${KIND[kind].icon}"></i> ${KIND[kind].label} (${items.length})${l.current[kind] ? "" : ` <span class="set-desc" style="font-weight:400;">· not listed for ${count(l.replies - l.listed[kind], "reply")}: out of date, no reminders</span>`}</div>
            ${items.map(i => `
            <div class="plot-thread" style="border-top:1px solid rgba(255,255,255,0.06); padding:5px 0;${i.ignored ? " opacity:.55;" : ""}">
                <div style="font-size:0.8rem;">${esc(i.text)}</div>
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:3px;">
                    <span class="set-desc" style="flex:1; min-width:120px;${i.stale && !i.ignored ? " color:#f59e0b;" : ""}">${esc(ageOf(i))}${i.stale ? (i.ignored ? " · stale, not reminded" : dueKeys.has(i.key) ? " · named to the model with the next reply" : " · stale") : ""}</span>
                    <button class="ps-modern-btn secondary plot-thread-beat" data-kind="${esc(i.kind)}" data-text="${esc(i.text)}" style="padding:1px 8px; font-size:0.68rem;" title="Queues a beat that brings it forward, at the head of the queue">Make it a beat</button>
                    <button class="ps-modern-btn secondary plot-thread-ignore" data-key="${esc(i.key)}" data-on="${i.ignored ? 0 : 1}" style="padding:1px 8px; font-size:0.68rem;">${i.ignored ? "Remind again" : "Never remind"}</button>
                </div>
            </div>`).join("")}`;
    };
    return `
        <div class="mtab-panel" id="plot_thread_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-diagram-project"></i> Open ends</div>
            <div class="set-desc" style="margin-bottom:6px;">What the story has left hanging, read from the World State block's Unresolved Threads, Planted Seeds and Consequence Timers on every reply. The model keeps that list and loses count; VCRP keeps the ages itself, with no call of its own.</div>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">Remind the model of stale ones</div><div class="set-desc">A thread unmoved for ${STALE_AFTER} replies, a seed unpaid for ${SEED_STALE}, a timer past its own count: named to the model with one reply, then every ${NUDGE_EVERY} replies while it waits, two at a time at most, with a line to bring it forward if the scene allows or settle it. In the per-turn rules after the chat (never cached; about 60 tokens on the replies it goes out).</div></div>
                <input type="checkbox" id="plot_thread_nudge" ${on ? "checked" : ""} />
            </div>
            ${!any ? `<div class="mtab-callout" style="margin-top:8px;"><i class="fa-solid fa-circle-info"></i><span>Nothing to read yet. The ledger needs the <b>World State</b> block (BLOCKS tab) with its Unresolved Threads, Planted Seeds or Consequence Timers lines; the compact World State leaves them out on most replies, and the Author's Notebook takes over the seeds unless you keep them.</span></div>` : `
            ${KINDS_ORDER.map(section).join("")}
            ${l.closed.length ? `<details style="margin-top:10px;"><summary class="set-desc" style="cursor:pointer;">Left the list (${l.closed.length}): settled, or dropped</summary>
                ${l.closed.map(i => `<div style="display:flex; gap:6px; align-items:flex-start; margin-top:5px;"><span class="set-desc" style="flex:1;">${esc(i.text)} <span style="opacity:.6;">(${count(i.ago, "reply")} ago, after ${i.age})</span></span><button class="ps-modern-btn secondary plot-thread-back" data-text="${esc(i.text)}" style="padding:1px 8px; font-size:0.68rem;" title="It was dropped, not settled: queues a beat that picks it back up">Pick it back up</button></div>`).join("")}
            </details>` : ""}`}
        </div>`;
}
const KINDS_ORDER = ["threads", "timers", "seeds"];

// ── The tab ──────────────────────────────────────────────────────────────────

export function renderPlotTab(c) {
    const rerender = () => renderPlotTab(c);
    c.empty();
    const a = arcs();
    const q = beatQueue();
    const on = !!a.current || q.waiting.length > 0 || !!q.next;
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #b45309);"><i class="fa-solid fa-route"></i></div>
                <div><h2>Plot</h2><p>Where the story goes next, in your hands: the arc it is in, the beats you line up, and the open ends it has left hanging.</p></div>
            </div>
            <div class="mtab-header-badge" style="color:${on ? "#f59e0b" : "var(--text-muted)"};"><i class="fa-solid fa-${on ? "circle-check" : "circle-xmark"}" style="font-size:0.6rem;"></i> ${on ? (a.current ? esc(a.current.title).slice(0, 28) : "Beats queued") : "Nothing set"}</div>
        </div>
        ${arcPanel()}
        ${beatPanel()}
        ${threadPanel()}`);

    // ── Arc ──
    const keep = (id, key) => c.find(id).on("input change", function () { form[key] = $(this).is(":checkbox") ? $(this).is(":checked") : String($(this).val() || ""); });
    keep("#plot_new_custom", "custom"); keep("#plot_new_tone", "tone"); keep("#plot_new_wish", "wish"); keep("#plot_new_title", "title");
    keep("#plot_new_premise", "premise"); keep("#plot_new_opens", "opens"); keep("#plot_new_close", "close"); keep("#plot_new_close_name", "closeName");
    c.find("#plot_new_genre").on("change", function () { form.genre = String($(this).val() || ""); c.find("#plot_new_custom").toggle(form.genre === CUSTOM); });
    const genreNow = () => (form.genre === CUSTOM ? form.custom.trim() : (SD_GENRES[form.genre] ? SD_GENRES[form.genre].label : ""));
    c.find("#plot_arc_title").on("change", async function () { await editArc({ title: $(this).val() }); rerender(); });
    c.find("#plot_arc_genre").on("change", async function () { await editArc({ genre: $(this).val() }); });
    c.find("#plot_arc_tone").on("change", async function () { await editArc({ tone: $(this).val() }); });
    c.find("#plot_arc_premise").on("change", async function () { await editArc({ premise: $(this).val() }); if (!String($(this).val() || "").trim()) rerender(); });
    c.find("#plot_arc_end").on("click", async () => { await endArc(); say("info", "The arc has ended. Nothing is sent for it any more."); rerender(); });

    const start = async ({ title, premise, opens }) => {
        if (!String(premise || "").trim()) { say("info", "Write a premise first, or take one of the pitches."); return; }
        const before = arcs().current;
        const wantClose = form.close && foldable() >= 2;
        const closeName = (form.closeName || (before ? before.title : "The story so far")).trim();
        const r = await startArc({ title, genre: genreNow(), tone: form.tone, premise, opens });
        if (!r) return;
        say("success", `The arc "${r.arc.title}" has begun.${r.beat ? (r.beat.fired === "next" ? " Its opening move goes with your next message (VCRP Quick shows it)." : " Its opening move is first in the beat queue.") : ""}`);
        Object.assign(form, { title: "", premise: "", opens: "", wish: "", closeName: "" });
        rerender();
        if (!wantClose) return;
        const res = await closeStoryArc(closeName);
        if (res.status === "folded") say("success", `Story Memory closed "${closeName}": ${res.chapters} chapters folded into one entry.`);
        else if (res.status === "busy") say("info", "Story Memory is busy with another call, so the old arc was not closed in it. The arc itself has started.");
        else if (res.status !== "idle") say("warning", `Story Memory could not close the old arc (${res.reason || res.status}). The arc itself has started; nothing in the memory changed.`);
        if (c.closest("body").length) rerender();
    };
    c.find("#plot_new_start").on("click", () => start({ title: form.title, premise: form.premise, opens: form.opens }));
    c.find(".plot-pitch-start").on("click", function () { const p = arcs().pitches[Number($(this).attr("data-i"))]; if (p) start({ title: p.title, premise: p.premise, opens: p.opens }); });
    c.find(".plot-pitch-edit").on("click", function () {
        const p = arcs().pitches[Number($(this).attr("data-i"))];
        if (!p) return;
        Object.assign(form, { title: p.title, premise: p.premise, opens: p.opens });
        rerender();
        c.find("#plot_arc_new").attr("open", "");
    });
    c.find("#plot_pitch_clear").on("click", async () => { await clearPitches(); rerender(); });
    c.find("#plot_pitch").on("click", async function () {
        const btn = $(this);
        btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Pitching…`);
        const r = await pitchArcs({ genre: genreNow(), tone: form.tone, wish: form.wish });
        if (r.status === "empty") say("info", "There is not enough story yet to pitch from.");
        else if (r.status === "failed") say("warning", "The pitch call did not come back. Nothing was changed; try again.");
        else if (r.status === "format") say("warning", "The model answered, but not as three pitches. Try again, or write the premise yourself.");
        else if (r.status === "aborted") say("info", "The chat changed while the pitches were being written. They were thrown away.");
        if (c.closest("body").length) { rerender(); c.find("#plot_arc_new").attr("open", ""); }
    });

    // ── Beats ──
    const addNew = async () => {
        const text = String(c.find("#plot_beat_new").val() || "");
        if (!text.trim()) return;
        await addBeat(text, { after: Number(c.find("#plot_beat_after").val()) || 0 });
        rerender();
    };
    c.find("#plot_beat_add").on("click", addNew);
    c.find("#plot_beat_new").on("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addNew(); } });
    c.find(".plot-beat-text").on("change", async function () { await editBeat(String($(this).attr("data-id")), { text: String($(this).val() || "") }); rerender(); });
    c.find(".plot-beat-fire").on("click", async function () {
        const r = await fireBeat(String($(this).attr("data-id")));
        if (r === "next") say("success", "It goes with your next message. VCRP Quick → Next reply only shows it.");
        else if (r === "held") say("info", "The Next reply only box already holds something, so this beat goes as soon as that is used or cleared.");
        rerender();
    });
    c.find(".plot-beat-up").on("click", async function () { await moveBeat(String($(this).attr("data-id")), -1); rerender(); });
    c.find(".plot-beat-down").on("click", async function () { await moveBeat(String($(this).attr("data-id")), 1); rerender(); });
    c.find(".plot-beat-drop").on("click", async function () { await removeBeat(String($(this).attr("data-id"))); rerender(); });
    c.find(".plot-beat-again").on("click", async function () { await requeueBeat(String($(this).attr("data-id"))); rerender(); });

    // ── Open ends ──
    c.find("#plot_thread_nudge").on("change", function () {
        if (!localProfile.plot || typeof localProfile.plot !== "object") localProfile.plot = {};
        localProfile.plot.threadNudges = $(this).is(":checked");
        saveProfileToMemory();
        rerender();
    });
    c.find(".plot-thread-ignore").on("click", async function () { await setThreadIgnored(String($(this).attr("data-key")), $(this).attr("data-on") === "1"); rerender(); });
    const BRING = { threads: "Bring this open thread forward", seeds: "Pay off what this set up", timers: "Let this consequence land" };
    c.find(".plot-thread-beat").on("click", async function () {
        await addBeat(`${BRING[String($(this).attr("data-kind"))] || BRING.threads}: ${String($(this).attr("data-text"))}`, { first: true });
        say("success", "Queued as the first beat. Fire it from Beats above, or from VCRP Quick.");
        rerender();
    });
    c.find(".plot-thread-back").on("click", async function () {
        await addBeat(`Pick this dropped thread back up: ${String($(this).attr("data-text"))}`, { first: true });
        say("success", "Queued as the first beat. Fire it from Beats above, or from VCRP Quick.");
        rerender();
    });
}
