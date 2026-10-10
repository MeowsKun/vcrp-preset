// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: the Memory tab panel.
//
// Settings (budget, cache lifetime, ceilings, review), a meter that says what a request
// costs warm and cold, the review queue, the chapters, and the fact ledger (editable).
// Ledger edits and approvals reach the prompt at the next cut: the memory text sits in the
// cached part of the prompt, so changing it mid-session would cost a full-price request.
// "Update the prompt now" does exactly that, on purpose.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced, saveMetadata } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { localProfile } from "../../core/state.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import { vcrpActiveModel } from "../generation.js";
import { BUDGET_DEFAULTS, priceForModel, costEstimate } from "./budget.js";
import {
    vcrpMemoryEnabled, memoryState, memoryBudgetSettings, currentMemoryBudget, resolveAnchor, refreshShownMemory, estimateTokens,
    forceCut, undoForceCut, previewRecall, vcrpMemoryUpdateVisuals, resetSpend, measuredOutputTokens,
} from "./index.js";
import { storyChat, approvePending, discardPending, nextSpan, memorySummaryRunning, unsummarizedTokens, autoSummaryHold, catchUp, catchUpEstimate } from "./summarize.js";
import { FACT_CATEGORIES, formatFactChanges, applyFactChanges } from "./ledger.js";
import { vcrpCacheCheckReport, vcrpCacheCheckSummary } from "../cacheCheck.js";
import { storyConfigFields } from "../../features/storyconfig/config.js";
import { activeEngine } from "../../engine/meguminOriginal.js";
import { isPuraEngine, puraVariant } from "../../core/engines.js";
import { puraSettings } from "../pura/index.js";
import { costBadgesOn, setCostBadges } from "../replyCost.js";
import { replyBudget } from "../replyLength.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);

// The cache check, in the Testing panel: did the last prompt keep the one before it?
function cacheCheckHtml(s) {
    const c = vcrpCacheCheckSummary(vcrpCacheCheckReport(), s.ttl === "5m" ? 5 : 60);
    if (!c) return `<div style="margin-top:10px; font-size:0.75rem; opacity:.75;"><b>Cache check:</b> send two messages within the cache lifetime, and this shows how much of the prompt the second one kept from the first.</div>`;
    return `<div style="margin-top:10px; font-size:0.75rem; line-height:1.5;${c.level === "warn" ? " color:#f59e0b;" : ""}"><b>${c.level === "warn" ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : ""}${esc(c.title)}.</b> ${esc(c.detail)}</div>`;
}

// The running spend estimate, as one line of the meter. Empty until a request has been counted.
function spendLine(st) {
    const s = st && st.spend;
    if (!s || !(s.replies || s.tasks || s.bgCalls)) return "";
    const total = s.replyCost + s.taskCost + (s.bgCost || 0);
    const avg = s.replies ? s.replyCost / s.replies : 0;
    const last = s.last ? ` Last reply: about ${money(s.last.cost)}${s.last.cold ? " (cache cold)" : ""}.` : "";
    const bg = s.bgCalls ? ` · ${s.bgCalls} VCRP task${s.bgCalls === 1 ? "" : "s"} such as the Story Director and NPC scans (${money(s.bgCost || 0)})` : "";
    return `<div style="margin-top:4px;"><b>Spent in this chat (estimate):</b> about ${money(total)} · ${s.replies} ${s.replies === 1 ? "reply" : "replies"} (${money(avg)} each)${s.tasks ? ` · ${s.tasks} background call${s.tasks === 1 ? "" : "s"} such as memory summaries (${money(s.taskCost)})` : ""}${bg}.${last}
        <span style="opacity:.7;">From VCRP's own token counts; hidden reasoning SillyTavern never sees is not included.</span></div>`;
}
const money = n => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const k = n => `${Math.round(n / 100) / 10}k`;

function saveSetting(key, value) {
    const g = extension_settings[extensionName].globalSettings || (extension_settings[extensionName].globalSettings = {});
    g.memoryBudget = { ...(g.memoryBudget || {}), [key]: value };
    saveSettingsDebounced();
}

let catchingUp = false;   // "Summarize now" is working through its batch

/** Catch up in standalone calls, with progress, then redraw the panel. */
async function runCatchUp($c, max) {
    if (memorySummaryRunning() || catchingUp) return;
    catchingUp = true;
    let r = { done: 0, last: null };
    try {
        r = await catchUp({ max, onChapter: n => { if (typeof toastr !== "undefined") toastr.info(`Chapter ${n} written…`, "VCRP Memory", { timeOut: 2000 }); } });
    } finally {
        catchingUp = false;
    }
    if (typeof toastr !== "undefined") {
        if (r.done) toastr.success(`${r.done} chapter${r.done > 1 ? "s" : ""} written${memoryBudgetSettings().review ? ", waiting for review" : ""}.`, "VCRP Memory");
        else toastr.warning(`Nothing written${r.last && r.last.reason ? `: ${r.last.reason}` : ""}.`, "VCRP Memory");
    }
    if ($c.closest("body").length) renderVcrpMemoryPanel($c);
}

// ── Reply length ──
// The two things that really set a reply's length, gathered here: the story's length
// (Story Config's own field, the same setting) and the thinking's (Thinking Effort). The
// cap only stops a runaway reply; set below a normal one, it cuts replies off. Drawn with
// Story Memory on or off: length is most of what a reply costs either way.
function renderReplyLength($c, s, budget, st, rerender) {
    const on = vcrpMemoryEnabled();
    const lengthField = storyConfigFields.find(f => f.key === "length");
    const lengthOpts = (lengthField && lengthField.options || []).map(o => typeof o === "string" ? { label: o, value: o } : o);
    const cfg = localProfile.storyConfig || {};
    const curLength = String(cfg.length || "");
    const customLength = curLength && !lengthOpts.some(o => o.value === curLength);
    const effort = String(localProfile.thinkEffort || "unspecified");
    const measured = measuredOutputTokens();
    const measuredCount = ((st && st.spend && st.spend.recentOut) || []).length;
    const avgCost = measured && budget ? measured * budget.price.output / 1e6 : null;
    const cap = Number(s.replyCap) || 0;
    // VCRP: Pura Original sets its length in Pura's own Formatting rules, and no Pura engine
    // uses VCRP's thinking steps.
    const engine = activeEngine();
    const pura = isPuraEngine(engine);
    const puraOriginal = puraVariant(engine) === "original";
    const ps = puraSettings();
    const puraLengthLive = puraOriginal && ps.formatting && ps.main !== "simplified";
    const storyLengthRow = puraOriginal
        ? `<div class="mtab-setting-row"><div class="set-info"><div class="set-label">Story length</div><div class="set-desc">${puraLengthLive ? "Pura Director · Original's own length setting, sent with Pura's Formatting rules. The same setting as in the Pura Director panel." : "Pura's Formatting rules are off (or the Simplified prompt is on), so no length rule is sent. Turn Formatting on in the Pura Director panel to use this."}</div></div>
            <select id="vmem_len_pura" class="ps-modern-input" style="width:170px;" ${puraLengthLive ? "" : "disabled"}>
                ${[["flexible", "Flexible"], ["short", "Short (3-5 paragraphs)"], ["medium", "Medium (8-13 paragraphs)"], ["long", "Long (13+ paragraphs)"]].map(([v, l]) => `<option value="${v}" ${ps.length === v ? "selected" : ""}>${l}</option>`).join("")}
            </select></div>`
        : null;
    $c.append(`<div class="mtab-panel" style="margin-bottom:14px;"><div class="mtab-panel-title blue"><i class="fa-solid fa-ruler-horizontal"></i> Reply length</div>
        <div style="font-size:0.75rem; line-height:1.55; margin-bottom:6px;">${measured
            ? `Your ${measuredCount ? `last ${measuredCount}` : "recent"} replies averaged about <b>${k(measured)} output tokens</b>${avgCost !== null ? ` (about ${money(avgCost)} each in output alone)` : ""}.${on ? " Story Memory's budget plans for that." : ""}`
            : (on ? `<span style="opacity:.75;">After a few replies, their measured length shows here, and Story Memory's budget plans for it.</span>` : `<span style="opacity:.75;">With Story Memory on, your replies' measured length shows here.</span>`)}
            <span style="opacity:.7;">Hidden reasoning SillyTavern never sees is not counted.</span></div>
        ${storyLengthRow || `<div class="mtab-setting-row"><div class="set-info"><div class="set-label">Story length</div><div class="set-desc">How long the story part of each reply runs. The same setting as Story Config's Length.</div></div>
            <select id="vmem_len" class="ps-modern-input" style="width:170px;">
                <option value="" ${!curLength ? "selected" : ""}>Default (no length rule)</option>
                ${lengthOpts.map(o => `<option value="${esc(o.value)}" ${o.value === curLength ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
                ${customLength ? `<option value="${esc(curLength)}" selected>Custom (set in Story Config)</option>` : ""}
            </select></div>`}
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Thinking length</div><div class="set-desc">${pura ? "The most words the Pura engine's &lt;think&gt; block may take before the story starts (it has no thinking steps of its own). The same setting as Thinking Effort." : "The most words VCRP's visible thinking may take before the story starts. The same setting as Thinking Effort."}</div></div>
            <select id="vmem_think" class="ps-modern-input" style="width:170px;">
                ${[["unspecified", "No limit"], ["100", "100 words"], ["250", "250 words"], ["450", "450 words"]].map(([v, l]) => `<option value="${v}" ${effort === v ? "selected" : ""}>${l}</option>`).join("")}
                ${effort === "custom" ? `<option value="custom" selected>Custom: ${esc(localProfile.customThinkEffort || "")} words</option>` : ""}
            </select></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Safety cap (tokens)</div><div class="set-desc">A hard limit on each reply, thinking and blocks included: it can never go over. While it is set, the model is told its room and the story's share of it in words, so it plans to finish inside it. A reply that still reaches it ends on its last full sentence (Continue writes the rest), and the next reply carries the last complete blocks. A cap close to your normal reply${measured ? ` (about ${k(measured)})` : ""} gets reached more often. 0 = off; SillyTavern's Max Response Length still applies.${(() => {
                const b = replyBudget();
                if (!b) return "";
                const split = [`the story about ${b.storyWords} words`, b.thinkingWords ? `the thinking about ${b.thinkingWords} words` : "", b.blocks ? `the blocks about ${b.blocks} tokens` : ""].filter(Boolean);
                return `<br><span style="opacity:.85;">At ${b.cap.toLocaleString("en-US")}: ${split.join(", ")}.</span>`;
            })()}</div></div>
            <input id="vmem_cap_reply" type="number" min="0" max="64000" step="500" class="ps-modern-input" style="width:90px;" value="${cap}"></div>
        ${cap && measured && cap < measured * 1.3 ? `<div style="font-size:0.72rem; color:#f59e0b; margin-top:4px;"><i class="fa-solid fa-triangle-exclamation"></i> The cap is close to your average reply: many replies will be cut off.</div>` : ""}
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Show each reply's cost</div><div class="set-desc">A small estimate under each reply's avatar (green: the cache was warm; amber: cold, the prompt written in full). Tap it for the breakdown: read from the cache, written to it, sent fresh, written by the model. Works with Story Memory on or off.</div></div>
            <input type="checkbox" id="vmem_cost_badges" ${costBadgesOn() ? "checked" : ""} /></div>
        </div>`);
    $c.find("#vmem_cost_badges").on("change", function () { setCostBadges(this.checked); saveSettingsDebounced(); });
    $c.find("#vmem_len").on("change", function () {
        if (!localProfile.storyConfig) localProfile.storyConfig = {};
        localProfile.storyConfig.length = String($(this).val());
        saveProfileToMemory();
    });
    $c.find("#vmem_len_pura").on("change", function () {
        if (!localProfile.pura || typeof localProfile.pura !== "object") localProfile.pura = {};
        localProfile.pura.length = String($(this).val());
        saveProfileToMemory();
    });
    $c.find("#vmem_think").on("change", function () {
        localProfile.thinkEffort = String($(this).val());
        saveProfileToMemory();
    });
    $c.find("#vmem_cap_reply").on("change", function () {
        const v = Math.round(Number($(this).val()));
        saveSetting("replyCap", Number.isFinite(v) && v > 0 ? Math.min(64000, v) : 0);
        rerender();
    });

}

export function renderVcrpMemoryPanel($c) {
    const rerender = () => renderVcrpMemoryPanel($c);
    $c.empty();
    const on = vcrpMemoryEnabled();
    const s = memoryBudgetSettings();
    const budget = currentMemoryBudget();
    const model = vcrpActiveModel().model;

    $c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #6366f1, #4338ca);"><i class="fa-solid fa-scale-balanced"></i></div>
                <div><h2>Story Memory</h2><p>Long chats on a budget: every request stays under your target, however long the story runs.</p></div>
            </div>
            <div class="mtab-header-badge" style="color:${on ? "#818cf8" : "var(--text-muted)"};"><i class="fa-solid fa-${on ? "circle-check" : "circle-xmark"}" style="font-size:0.6rem;"></i> ${on ? "Enabled" : "Disabled"}</div>
        </div>
        <div class="mtab-toggle-row ${on ? "active" : ""}" id="vmem_enable" style="margin-bottom:14px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-scale-balanced" style="color:#818cf8;"></i> Enable Story Memory</div>
                <div class="toggle-desc">While you play, nothing is dropped and every turn reads from cache. After a break, older messages leave in one cut, covered by chapters and a fact ledger.</div>
            </div>
            <div class="ps-switch"></div>
        </div>`);

    $c.find("#vmem_enable").on("click", async () => {
        localProfile.vcrpMemory.enabled = !on;
        saveProfileToMemory();
        rerender();
        if (on) return;
        // Switched on in a long chat nobody has summarized: offer to catch up now, before a
        // break turns the whole backlog into one full-price request.
        const b = currentMemoryBudget();
        const stNow = memoryState();
        const backlog = b && stNow ? unsummarizedTokens(storyChat(), stNow, b) : 0;
        if (!b || backlog <= b.coldTokens) return;
        const est = catchUpEstimate(backlog, b);
        const review = memoryBudgetSettings().review;
        if (!confirm(`This chat has about ${k(backlog)} tokens nobody has summarized. Until they are, the first request after a break can't be cut and costs far more than your target.\n\nCatch up now? About ${est.chapters} chapter${est.chapters > 1 ? "s" : ""}, roughly ${money(est.cost)}, around ${est.minutes} minute${est.minutes > 1 ? "s" : ""} in the background. Please don't send messages until it finishes.${review ? "\n\nReview is on: the chapters will wait for your approval, and only approved chapters can be cut, so approve them before your next break (there's an Approve all button). Switch review off first if you'd rather they save directly." : ""}`)) return;
        await runCatchUp($c, Infinity);
    });
    if (!on) {
        renderReplyLength($c, s, budget, null, rerender);
        return;
    }
    const st = memoryState();

    $c.append(`
        <div class="mtab-callout gold" style="margin-bottom:14px;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span><strong>This needs prompt caching.</strong> Either set it in SillyTavern's <code>config.yaml</code> under <code>claude:</code>
            (<code>cachingAtDepth: 0</code>, <code>extendedTTL: true</code>), or on OpenRouter tick "Mark the cache from VCRP" below.
            Also set Context Size to the maximum. VCRP can't read config.yaml; Global Settings → Setup Check covers the rest.</span>
        </div>`);

    // ── Meter ──
    const plan = st && st.lastPlan;
    const chat = storyChat();
    const cutAt = st ? Math.max(0, resolveAnchor(chat, st.cut)) : 0;
    const covered = st ? Math.max(0, resolveAnchor(chat, st.summarized)) : 0;
    const pending = (st && st.pending) || [];
    let meter;
    if (!budget) {
        meter = `<div style="color:#f59e0b;"><i class="fa-solid fa-circle-question"></i> No price known for <b>${esc(model || "this model")}</b>. Set a custom price below to use the budget.</div>`;
    } else {
        const est = plan && plan.promptTokens ? costEstimate(budget, plan.promptTokens) : null;
        meter = `
            <div><b>${esc(budget.price.label)}</b> · $${budget.price.input}/M in, $${budget.price.output}/M out, $${budget.price.read}/M cached · ${budget.ttl === "5m" ? "5-minute" : "1-hour"} cache</div>
            <div>After a break, the prompt is cut to about <b>${k(budget.coldTokens)} tokens</b>, so even a full-price request stays near ${money(s.targetCost)}. While you play it may grow to ${k(budget.warmTokens)}.</div>
            ${est ? `<div>Last request: about <b>${k(plan.promptTokens)} tokens</b>, roughly ${money(est.warm)} with the cache warm, ${money(est.cold)} if it had gone cold. <span style="opacity:.7;">(${esc(plan.reason)})</span></div>`
                : plan ? `<div style="color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> Last request: ${esc(plan.reason)}.</div>`
                : `<div style="opacity:.7;">No request sent yet with Story Memory on.</div>`}
            <div>${covered ? `Chapters cover messages 1–${covered} of ${chat.length}.` : `No chapters yet (${chat.length} messages).`} The prompt carries from message ${cutAt + 1}.${pending.length ? ` <b style="color:#f59e0b;">${pending.length} chapter${pending.length > 1 ? "s" : ""} waiting for review.</b>` : ""}</div>
            ${st && st.shown ? `<div style="opacity:.75;">Memory text in the prompt: about ${k(estimateTokens(st.shown))} tokens${(st.hiddenFacts || []).length ? `, ${st.hiddenFacts.length} older facts kept for recall only` : ""}.</div>` : ""}
            ${st && (st.lastRecall || []).length ? `<div style="opacity:.75;">Recalled for the last request: ${esc(st.lastRecall.join(", "))}.</div>` : ""}
            ${spendLine(st)}`;
        const hold = autoSummaryHold(st);
        if (hold) meter += `<div style="color:#f59e0b;"><i class="fa-solid fa-circle-pause"></i> Automatic summaries are ${hold === "waiting for review" ? "holding until you review the waiting chapters" : "paused after two failed summaries; Summarize now retries"}.</div>`;
        // A long chat nobody has summarized: a break would end in a full-price request on all of it.
        const backlog = unsummarizedTokens(chat, st, budget);
        if (backlog > budget.coldTokens) {
            const missCost = costEstimate(budget, (st.fixedTokens || 12000) + backlog + budget.minVerbatim).cold;
            const est = catchUpEstimate(backlog, budget);
            meter += `<div style="color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> About ${k(backlog)} tokens of this chat aren't summarized yet. Until they are, a request after a break can't be cut and would cost about ${money(missCost)}. <b>Summarize now</b> catches up in small standalone calls: about ${est.chapters} chapter${est.chapters > 1 ? "s" : ""}, roughly ${money(est.cost)}, 10 per click.</div>`;
        }
        if (plan && plan.behind) meter += `<div style="color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> The last cut could not reach the budget (${esc(plan.limit)}).${plan.limit === "summaries" ? " Approve waiting chapters, or use Summarize now." : " The recent text kept word for word is more than this budget allows; raise the target or lower the floor."}</div>`;
    }
    $c.append(`<div class="mtab-panel" style="margin-bottom:14px;"><div class="mtab-panel-title green"><i class="fa-solid fa-gauge"></i> What a request costs</div>
        <div style="font-size:0.78rem; line-height:1.55; display:flex; flex-direction:column; gap:4px;">${meter}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
            <button id="vmem_summarize" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-feather"></i> Summarize now</button>
            <button id="vmem_refresh_shown" class="ps-modern-btn secondary" style="font-size:0.72rem;" title="Puts edited chapters and facts into the prompt now. The next request then costs full price once."><i class="fa-solid fa-arrows-rotate"></i> Update the prompt now</button>
            <button id="vmem_reset" class="ps-modern-btn secondary" style="font-size:0.72rem; color:#ef4444;"><i class="fa-solid fa-trash"></i> Reset this chat's memory</button>
            ${st && st.spend && (st.spend.replies || st.spend.tasks || st.spend.bgCalls) ? `<button id="vmem_spend_reset" class="ps-modern-btn secondary" style="font-size:0.72rem;" title="Starts the spend estimate over. The memory itself is not touched."><i class="fa-solid fa-coins"></i> Reset spend estimate</button>` : ""}
        </div></div>`);
    $c.find("#vmem_spend_reset").on("click", async () => {
        const stNow = memoryState();
        if (!stNow) return;
        resetSpend(stNow);
        await saveMetadata();
        rerender();
    });

    $c.find("#vmem_summarize").on("click", async () => {
        const stNow = memoryState();
        const span = stNow && nextSpan(storyChat(), stNow, currentMemoryBudget(), { catchUp: true });
        if (!span) { if (typeof toastr !== "undefined") toastr.info("Nothing to summarize yet: the recent messages stay word for word.", "VCRP Memory"); return; }
        await runCatchUp($c, 10);
    });
    $c.find("#vmem_refresh_shown").on("click", async () => {
        const stNow = memoryState();
        const chatNow = storyChat();
        refreshShownMemory(stNow, chatNow, Math.max(0, resolveAnchor(chatNow, stNow.cut)));
        await saveMetadata();
        if (typeof toastr !== "undefined") toastr.info("The prompt carries the current memory from the next request (one full-price request).", "VCRP Memory");
        rerender();
    });
    $c.find("#vmem_reset").on("click", async () => {
        if (!confirm("Delete every chapter, fact and waiting review for this chat? The whole chat goes back into the prompt.")) return;
        const stNow = memoryState();
        Object.assign(stNow, { cut: null, summarized: null, shown: "", chapters: [], arcs: [], ledger: [], retired: [], pending: [], nextFactId: 1, chapterSeq: 0, hiddenFacts: [], lastRecall: [], summaryFailures: 0 });
        delete stNow.qaPrevCut;
        await saveMetadata();
        rerender();
    });

    // ── Testing ──
    // Lets the player see gists, facts and recall at work without waiting an hour for the
    // cache to go cold. "Cut now" is a real cut, so the next reply is a real test.
    const canUndo = !!st && Object.prototype.hasOwnProperty.call(st, "qaPrevCut");
    $c.append(`<div class="mtab-panel" style="margin-bottom:14px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-flask"></i> Testing</div>
        <div style="font-size:0.75rem; line-height:1.55; opacity:.85;"><b>Cut now</b> takes everything the approved chapters cover out of the prompt (the last 4 messages always stay), so the next reply runs on gists, facts and recall, the way it will after a break. That reply costs full price once. <b>Undo cut</b> puts the previous cut back. <b>Preview recall</b> shows what your last messages, plus whatever is in the message box, would bring back.</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            <button id="vmem_qa_cut" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-scissors"></i> Cut now</button>
            <button id="vmem_qa_undo" class="ps-modern-btn secondary" style="font-size:0.72rem;" ${canUndo ? "" : "disabled"}><i class="fa-solid fa-rotate-left"></i> Undo cut</button>
            <button id="vmem_qa_recall" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-magnifying-glass"></i> Preview recall</button>
        </div>
        <details style="margin-top:10px; font-size:0.75rem;"><summary style="cursor:pointer;">Memory text the prompt carries${st && st.shown ? ` (about ${k(estimateTokens(st.shown))} tokens)` : ""}</summary>
            <pre style="white-space:pre-wrap; font-size:0.72rem; max-height:260px; overflow:auto; margin-top:6px;">${esc((st && st.shown) || "(empty: nothing has been cut yet, so the whole chat is still in the prompt word for word)")}</pre>
        </details>
        <div id="vmem_qa_out" style="margin-top:8px; font-size:0.75rem;"></div>
        ${cacheCheckHtml(s)}</div>`);

    $c.find("#vmem_qa_cut").on("click", async () => {
        const stNow = memoryState();
        const chatNow = storyChat();
        if (!stNow) return;
        if (!confirm("Cut now?\n\nEverything the approved chapters cover leaves the prompt (the last 4 messages stay). The next reply runs on the memory instead and costs full price once.")) return;
        const r = forceCut(stNow, chatNow);
        if (r.result === "no chapters") {
            if (typeof toastr !== "undefined") toastr.warning("No approved chapters yet. Use Summarize now and approve the chapters first (on a short chat, lower \"Always kept word for word\" so there is something to summarize).", "VCRP Memory");
            return;
        }
        if (r.result === "already") {
            if (typeof toastr !== "undefined") toastr.info(`The prompt already starts at message ${r.cutAt + 1}, and the approved chapters reach no further than that.`, "VCRP Memory");
            return;
        }
        await saveMetadata();
        vcrpMemoryUpdateVisuals();
        if (typeof toastr !== "undefined") toastr.success(`Cut at message ${r.cutAt + 1}. The next reply carries the gists and facts instead of messages 1–${r.cutAt}.`, "VCRP Memory");
        rerender();
    });
    $c.find("#vmem_qa_undo").on("click", async () => {
        const stNow = memoryState();
        if (!stNow || !undoForceCut(stNow, storyChat())) return;
        await saveMetadata();
        vcrpMemoryUpdateVisuals();
        if (typeof toastr !== "undefined") toastr.info("The previous cut is back. The next reply costs full price once.", "VCRP Memory");
        rerender();
    });
    $c.find("#vmem_qa_recall").on("click", () => {
        const draft = String($("#send_textarea").val() || "");
        const r = previewRecall(draft);
        const out = $c.find("#vmem_qa_out");
        if (!r.cut) {
            out.html(`<div style="opacity:.8;">Nothing is cut yet, so there is nothing to recall: every message is still in the prompt word for word.</div>`);
        } else if (!r.text) {
            out.html(`<div style="opacity:.8;">Nothing would come back. No chapter before message ${r.cut + 1} shares at least two distinctive words (a name, a place, an object) with the last messages${draft.trim() ? " and the message box" : ""}.</div>`);
        } else {
            out.html(`<div style="margin-bottom:4px;">Would come back: <b>${esc(r.ids.join(", "))}</b></div><pre style="white-space:pre-wrap; font-size:0.72rem; max-height:260px; overflow:auto;">${esc(r.text)}</pre>`);
        }
    });

    // ── Review ──
    if (pending.length) {
        const e = pending[0];
        const pinnedIds = new Set((st.ledger || []).filter(f => f.pinned).map(f => f.id));
        const pinnedTouched = [...new Set((e.ops || []).filter(o => o.op !== "+" && pinnedIds.has(o.id)).map(o => o.id))];
        const badge = e.checked === "ok" ? `<span style="color:#10b981;">checked: accurate</span>` : e.checked === "corrected" ? `<span style="color:#f59e0b;">checked: corrected</span>` : `<span style="color:#ef4444;">check unreadable</span>`;
        $c.append(`<div class="mtab-panel" style="margin-bottom:14px; border-color: rgba(245,158,11,0.35);">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-clipboard-check"></i> Review: messages ${e.from + 1}–${e.to + 1} · ${badge}${pending.length > 1 ? ` · ${pending.length - 1} more after this` : ""}</div>
            <label style="font-size:0.72rem; opacity:.8;">One-line gist</label>
            <input id="vmem_rev_gist" class="ps-modern-input" style="width:100%; margin-bottom:8px;" value="${esc(e.gist)}">
            <label style="font-size:0.72rem; opacity:.8;">Chapter</label>
            <textarea id="vmem_rev_chapter" class="ps-modern-input" style="width:100%; height:130px; resize:vertical; margin-bottom:8px;">${esc(e.chapter)}</textarea>
            <label style="font-size:0.72rem; opacity:.8;">Fact changes (+ category | fact, ~ F3 | new wording, - F7 | reason)</label>
            <textarea id="vmem_rev_changes" class="ps-modern-input" style="width:100%; height:90px; resize:vertical; font-family:monospace; font-size:0.72rem;">${esc(formatFactChanges(e.ops))}</textarea>
            ${e.arc ? `<div style="font-size:0.72rem; margin-top:6px; opacity:.8;">Also folds ${e.foldIds.length} older gists into: <i>${esc(e.arc)}</i></div>` : ""}
            ${pinnedTouched.length ? `<div style="font-size:0.72rem; margin-top:6px; color:#f59e0b;"><i class="fa-solid fa-thumbtack"></i> Changes ${pinnedTouched.length === 1 ? "a pinned fact" : "pinned facts"}: ${esc(pinnedTouched.join(", "))}. Check ${pinnedTouched.length === 1 ? "it" : "them"} before approving.</div>` : ""}
            <div style="display:flex; gap:8px; margin-top:10px;">
                <button id="vmem_rev_approve" class="ps-modern-btn" style="font-size:0.72rem;"><i class="fa-solid fa-check"></i> Approve</button>
                <button id="vmem_rev_discard" class="ps-modern-btn secondary" style="font-size:0.72rem; color:#ef4444;" title="Throws this away (and anything queued after it). It is written again after a later reply."><i class="fa-solid fa-xmark"></i> Discard</button>
                ${pending.length > 1 ? `<button id="vmem_rev_approve_all" class="ps-modern-btn secondary" style="font-size:0.72rem;" title="Approves this one with your edits, then every chapter after it as written."><i class="fa-solid fa-check-double"></i> Approve all ${pending.length}</button>` : ""}
            </div></div>`);
        $c.find("#vmem_rev_approve_all").on("click", async () => {
            const stNow = memoryState();
            const chatNow = storyChat();
            approvePending(stNow, chatNow, { gist: $c.find("#vmem_rev_gist").val(), chapter: $c.find("#vmem_rev_chapter").val(), changes: $c.find("#vmem_rev_changes").val() });
            while ((stNow.pending || []).length) approvePending(stNow, chatNow);
            await saveMetadata();
            rerender();
        });
        $c.find("#vmem_rev_approve").on("click", async () => {
            approvePending(memoryState(), storyChat(), { gist: $c.find("#vmem_rev_gist").val(), chapter: $c.find("#vmem_rev_chapter").val(), changes: $c.find("#vmem_rev_changes").val() });
            await saveMetadata();
            rerender();
        });
        $c.find("#vmem_rev_discard").on("click", async () => {
            discardPending(memoryState(), 0);
            await saveMetadata();
            rerender();
        });
    }

    renderReplyLength($c, s, budget, st, rerender);

    // ── Settings ──
    const cp = s.customPrice || {};
    $c.append(`<div class="mtab-panel" style="margin-bottom:14px;"><div class="mtab-panel-title gold"><i class="fa-solid fa-sliders"></i> Budget</div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Target per request</div><div class="set-desc">The most one request should cost, in dollars. Breaks are what make a request expensive, so this sets how much story survives one.</div></div>
            <input id="vmem_target" type="number" min="0.05" max="5" step="0.01" class="ps-modern-input" style="width:90px;" value="${s.targetCost}"></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Cache lifetime</div><div class="set-desc">Must match SillyTavern: extendedTTL true is 1 hour, otherwise 5 minutes.</div></div>
            <select id="vmem_ttl" class="ps-modern-input" style="width:130px;"><option value="1h" ${s.ttl !== "5m" ? "selected" : ""}>1 hour</option><option value="5m" ${s.ttl === "5m" ? "selected" : ""}>5 minutes</option></select></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Most the prompt may carry while you play</div><div class="set-desc">Thousands of tokens. Reads from cache are cheap, so this mostly guards against slow replies on very long sessions.</div></div>
            <input id="vmem_warm" type="number" min="20" max="900" step="10" class="ps-modern-input" style="width:90px;" value="${Math.round(s.warmCeiling / 1000)}"></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Always kept word for word</div><div class="set-desc">Thousands of tokens of the most recent messages, never cut, whatever the budget.</div></div>
            <input id="vmem_floor" type="number" min="2" max="60" step="1" class="ps-modern-input" style="width:90px;" value="${Math.round(s.minVerbatim / 1000)}"></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Recall per request</div><div class="set-desc">Tokens of old chapters brought back when the scene touches them. It sits after the chat and is re-cached every turn, so it stays small. 0 turns recall off.</div></div>
            <input id="vmem_recall" type="number" min="0" max="5000" step="100" class="ps-modern-input" style="width:90px;" value="${s.recallTokens}"></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Memory text cap</div><div class="set-desc">Tokens the always-carried memory may take. Past it, the facts that changed longest ago move to recall only. Every token here comes out of what survives a break.</div></div>
            <input id="vmem_cap" type="number" min="500" max="20000" step="250" class="ps-modern-input" style="width:90px;" value="${s.memoryCap}"></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Mark the cache from VCRP</div><div class="set-desc">On by default (OpenRouter + Claude). VCRP marks your last two replies, which line up from one turn to the next on every provider, Bedrock included; SillyTavern's own markers do not, with VCRP's rules sitting before your newest message. <b>Needs <code>cachingAtDepth: -1</code> in config.yaml</b>, so SillyTavern adds none of its own: with both on, a request can carry more cache markers than Claude accepts and fail with a 400 error. If you can't change config.yaml, untick this instead. VCRP's markers carry the cache lifetime set above.</div></div>
            <input id="vmem_markcache" type="checkbox" ${s.markCache ? "checked" : ""}></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Review chapters before they count</div><div class="set-desc">New chapters and fact changes wait for your approval. Until approved, nothing new can be cut.</div></div>
            <input id="vmem_review" type="checkbox" ${s.review ? "checked" : ""}></div>
        <div class="mtab-setting-row"><div class="set-info"><div class="set-label">Custom price ($ per million tokens)</div><div class="set-desc">Only for models VCRP doesn't know${priceForModel(model) ? "" : " (needed for the current one)"}. Input, output, cached read.</div></div>
            <div style="display:flex; gap:4px;">
                <input id="vmem_price_in" type="number" min="0" step="0.01" class="ps-modern-input" style="width:64px;" placeholder="in" value="${cp.input ?? ""}">
                <input id="vmem_price_out" type="number" min="0" step="0.01" class="ps-modern-input" style="width:64px;" placeholder="out" value="${cp.output ?? ""}">
                <input id="vmem_price_read" type="number" min="0" step="0.01" class="ps-modern-input" style="width:64px;" placeholder="read" value="${cp.read ?? ""}">
            </div></div>
        </div>`);
    const num = (sel, scale, dflt) => { const v = parseFloat($c.find(sel).val()); return Number.isFinite(v) && v > 0 ? v * scale : dflt; };
    $c.find("#vmem_target").on("change", () => { saveSetting("targetCost", num("#vmem_target", 1, BUDGET_DEFAULTS.targetCost)); rerender(); });
    $c.find("#vmem_ttl").on("change", () => { saveSetting("ttl", $c.find("#vmem_ttl").val() === "5m" ? "5m" : "1h"); rerender(); });
    $c.find("#vmem_warm").on("change", () => { saveSetting("warmCeiling", num("#vmem_warm", 1000, BUDGET_DEFAULTS.warmCeiling)); rerender(); });
    $c.find("#vmem_floor").on("change", () => { saveSetting("minVerbatim", num("#vmem_floor", 1000, BUDGET_DEFAULTS.minVerbatim)); rerender(); });
    $c.find("#vmem_recall").on("change", () => { const v = parseFloat($c.find("#vmem_recall").val()); saveSetting("recallTokens", Number.isFinite(v) && v >= 0 ? Math.round(v) : BUDGET_DEFAULTS.recallTokens); rerender(); });
    $c.find("#vmem_cap").on("change", () => { saveSetting("memoryCap", num("#vmem_cap", 1, BUDGET_DEFAULTS.memoryCap)); rerender(); });
    $c.find("#vmem_markcache").on("change", () => { saveSetting("markCache", $c.find("#vmem_markcache").is(":checked")); rerender(); });
    $c.find("#vmem_review").on("change", () => { saveSetting("review", $c.find("#vmem_review").is(":checked")); rerender(); });
    $c.find("#vmem_price_in, #vmem_price_out, #vmem_price_read").on("change", () => {
        const p = { input: num("#vmem_price_in", 1, 0), output: num("#vmem_price_out", 1, 0), read: num("#vmem_price_read", 1, 0) };
        saveSetting("customPrice", p.input > 0 && p.output > 0 ? p : null);
        rerender();
    });

    if (!st) return;

    // ── Fact ledger ──
    const ledger = st.ledger || [];
    $c.append(`<div class="mtab-panel" style="margin-bottom:14px;"><div class="mtab-panel-title green"><i class="fa-solid fa-list-check"></i> Facts (${ledger.length})</div>
        <div style="font-size:0.72rem; opacity:.75; margin-bottom:8px;">Durable facts the story has established. <i class="fa-solid fa-thumbtack"></i> Pinned facts always stay in the memory text, whatever the size cap; summaries can still update or retire them as the story changes. Edits and pins reach the prompt at the next cut, or with "Update the prompt now".</div>
        <div id="vmem_facts" style="display:flex; flex-direction:column; gap:4px;">
            ${ledger.map(f => `<div style="display:flex; gap:6px; align-items:center;">
                <button class="ps-modern-btn secondary vmem-fact-pin" data-id="${esc(f.id)}" style="padding:2px 7px;${f.pinned ? " color:#f59e0b; border-color:rgba(245,158,11,0.5);" : " opacity:.5;"}" title="${f.pinned ? "Pinned: always in the memory text. Click to unpin." : "Pin: always keep this fact in the memory text."}"><i class="fa-solid fa-thumbtack"></i></button>
                <span style="font-size:0.65rem; opacity:.7; min-width:86px;" title="${(st.hiddenFacts || []).includes(f.id) ? "Over the memory cap: comes back only when the scene touches it" : ""}">${esc(f.id)} · ${esc(f.cat)}${(st.hiddenFacts || []).includes(f.id) ? " · recall" : ""}</span>
                <input class="ps-modern-input vmem-fact" data-id="${esc(f.id)}" style="flex:1;" value="${esc(f.text)}">
                <button class="ps-modern-btn secondary vmem-fact-del" data-id="${esc(f.id)}" style="padding:2px 8px; color:#ef4444;" title="Retire this fact"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join("")}
        </div>
        <div style="display:flex; gap:6px; margin-top:8px;">
            <select id="vmem_new_cat" class="ps-modern-input" style="width:120px;">${FACT_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}</select>
            <input id="vmem_new_fact" class="ps-modern-input" style="flex:1;" placeholder="Add a fact the story has established">
            <button id="vmem_add_fact" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-plus"></i> Add</button>
        </div></div>`);
    const edit = async ops => {
        const stNow = memoryState();
        const r = applyFactChanges({ ledger: stNow.ledger || [], retired: stNow.retired || [], nextId: stNow.nextFactId || 1 }, ops, "edit");
        stNow.ledger = r.ledger; stNow.retired = r.retired; stNow.nextFactId = r.nextId;
        await saveMetadata();
    };
    $c.find(".vmem-fact").on("change", async function () { await edit([{ op: "~", id: $(this).data("id"), text: String($(this).val()).trim() }]); });
    $c.find(".vmem-fact-del").on("click", async function () { await edit([{ op: "-", id: $(this).data("id"), reason: "removed by the reader" }]); rerender(); });
    $c.find(".vmem-fact-pin").on("click", async function () {
        const stNow = memoryState();
        const f = (stNow.ledger || []).find(x => x.id === String($(this).data("id")));
        if (!f) return;
        f.pinned = !f.pinned;
        await saveMetadata();
        rerender();
    });
    $c.find("#vmem_add_fact").on("click", async () => {
        const text = String($c.find("#vmem_new_fact").val() || "").trim();
        if (!text) return;
        await edit([{ op: "+", cat: $c.find("#vmem_new_cat").val(), text }]);
        rerender();
    });

    // ── Chapters ──
    const chapters = st.chapters || [];
    const arcs = st.arcs || [];
    $c.append(`<div class="mtab-panel"><div class="mtab-panel-title blue"><i class="fa-solid fa-book"></i> Chapters (${chapters.length})</div>
        ${arcs.length ? `<div style="font-size:0.75rem; margin-bottom:8px;">${arcs.map(a => `<div>• <i>${esc(a.text)}</i></div>`).join("")}</div>` : ""}
        ${chapters.length ? `<div style="font-size:0.72rem; opacity:.75; margin-bottom:8px;"><i class="fa-solid fa-thumbtack"></i> A pinned chapter keeps its gist line in the memory text: never trimmed by the size cap, never folded into an arc. It reaches the prompt at the next cut, or with "Update the prompt now".</div>` : ""}
        ${chapters.length ? [...chapters].reverse().map(c => `<details style="margin-bottom:4px;${c.folded && !c.pinned ? " opacity:.6;" : ""}">
            <summary style="cursor:pointer; font-size:0.78rem;"><button class="ps-modern-btn secondary vmem-ch-pin" data-id="${esc(c.id)}" style="padding:1px 6px; margin-right:4px;${c.pinned ? " color:#f59e0b; border-color:rgba(245,158,11,0.5);" : " opacity:.5;"}" title="${c.pinned ? "Pinned. Click to unpin." : "Pin this chapter's gist"}"><i class="fa-solid fa-thumbtack"></i></button><b>${esc(c.id)}</b> · messages ${c.from + 1}–${c.to + 1}${c.folded ? (c.pinned ? " · folded, kept by its pin" : " · folded into an arc") : ""} · ${esc(c.gist)}</summary>
            <div style="font-size:0.75rem; white-space:pre-wrap; padding:6px 10px; opacity:.85;">${esc(c.chapter)}</div></details>`).join("")
        : `<div style="font-size:0.75rem; opacity:.7;">No chapters yet. They are written after replies, once the chat is long enough to need them.</div>`}
        </div>`);
    $c.find(".vmem-ch-pin").on("click", async function (e) {
        e.preventDefault();   // inside <summary>: do not also open or close the chapter
        e.stopPropagation();
        const stNow = memoryState();
        const ch = (stNow.chapters || []).find(x => x.id === String($(this).data("id")));
        if (!ch) return;
        ch.pinned = !ch.pinned;
        await saveMetadata();
        rerender();
    });
}

/** The Memory tab. */
export function renderMemoryTab(c) {
    renderVcrpMemoryPanel(c);
}
