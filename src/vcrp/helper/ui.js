// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Helper tab. The on switch, the connection (a SillyTavern connection profile, or
// the story's own), the Test button, then the jobs: the blocks after every reply (with a
// tick per block), and the occasional jobs. One setup for every character.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, saveSettingsDebounced } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { escapeHtmlAttr as esc } from "../../utils/html.js";
import { meguminActiveBlocks } from "../../features/blocks/registry.js";
import { helperSettings, helperJobWanted, HELPER_JOBS, CURRENT_CONNECTION, routableBlock } from "./settings.js";
import { connectionProfiles, isChatProfile, canSendToProfile, helperTest, helperBusy, stopHelperJobs } from "./index.js";
import { helperWriteBlocks } from "./blocks.js";
import { helperRoutedIdSet } from "./routes.js";
import { getHelperStatus, helperStatusText } from "./status.js";

// The last Test answer, kept across redraws (for the connection it tested).
let lastTest = null;

/** The jobs the helper does now, by title: switched to it, and its feature on. */
function jobsOnNow() {
    return HELPER_JOBS.filter(j => helperJobWanted(j.key) && !featureOff(j.key)).map(j => j.title);
}

/** Is the job's own feature switched on in its tab? null = yes (or nothing to switch). */
function featureOff(key) {
    const p = localProfile || {};
    switch (key) {
        case "blocks": return meguminActiveBlocks().some(routableBlock) ? null : "No block is in the stack (BLOCKS tab)";
        case "memory": return p.vcrpMemory && p.vcrpMemory.enabled ? null : "Story Memory is off (Memory tab)";
        case "focus": return p.focus && p.focus.enabled !== false ? null : "Focus is off (Focus tab)";
        case "director": return p.storyPlan && p.storyPlan.enabled ? null : "The Story Director is off";
        case "npc": return p.npcBank && p.npcBank.enabled ? null : "The NPC Bank is off";
        case "recall": return p.vcrpMemory && p.vcrpMemory.enabled ? null : "Story Memory is off (Memory tab)";
        default: return null;
    }
}

/** What the connection picked means for a job; null = nothing to say. */
function connectionNote(key) {
    if (helperSettings().profileId !== CURRENT_CONNECTION) return null;
    if (key === "recall") return "Needs a connection profile of its own: it is asked while your connection is busy with the reply";
    if (key === "continuity") return "On your current connection this is one more call on the story model with every reply, so it is off until you tick it";
    return null;
}

export function renderHelperTab(c) {
    c.empty();
    const h = helperSettings();
    const redraw = () => renderHelperTab(c);
    const save = () => saveSettingsDebounced();
    const all = connectionProfiles();
    const profiles = all.filter(isChatProfile);
    const onCurrent = h.profileId === CURRENT_CONNECTION;
    const picked = profiles.find(p => p.id === h.profileId);
    const textProfile = all.find(p => p.id === h.profileId && !isChatProfile(p));
    const canSend = canSendToProfile();
    const ready = Boolean(h.enabled && h.profileId && (onCurrent || (picked && canSend)));
    const tested = Boolean(h.profileId) && h.testedProfileId === h.profileId;

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f43f5e, #be123c);"><i class="fa-solid fa-robot"></i></div>
                <div><h2>Helper</h2><p>A second model that does the background jobs on its own connection, so the story model writes only the story.</p></div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(168,85,247,0.12); color: #a855f7; border: 1px solid rgba(168,85,247,0.25);"><i class="fa-solid fa-earth-americas" style="font-size:0.6rem;"></i> Same for every character</div>
        </div>`);

    const $on = $(`<div class="mtab-toggle-row ${h.enabled ? "active" : ""}" id="helper_on">
        <div class="toggle-info"><div class="toggle-label">${h.enabled ? "Helper on" : "Helper off"}</div><div class="toggle-desc">${h.enabled ? (ready ? "Its jobs go to the connection below." : "Pick a connection below, or the jobs stay with the story model.") : "Every job below uses your story model until you switch it on."}</div></div>
        <div class="ps-switch"></div>
    </div>`);
    $on.on("click", () => { h.enabled = !h.enabled; save(); redraw(); });
    c.append($on);

    // ── The connection ──
    const $conn = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-plug"></i> Its connection</div></div>`);
    if (!canSend && !onCurrent && h.profileId) {
        $conn.append(`<div class="mtab-callout red"><i class="fa-solid fa-triangle-exclamation"></i><span>This SillyTavern cannot send a request to a connection profile on its own (it lacks the connection manager's request service). Pick <b>Use my current connection</b>, or update SillyTavern; until then the jobs run on your story model.</span></div>`);
    }
    if (textProfile) {
        $conn.append(`<div class="mtab-callout red"><i class="fa-solid fa-triangle-exclamation"></i><span><b>${esc(textProfile.name)}</b> is a Text Completion profile. The helper works with Chat Completion only: pick another connection.</span></div>`);
    }
    const $sel = $(`<select id="helper_profile" class="ps-modern-input" style="width:100%; max-width:420px;">
        <option value="">Pick a connection…</option>
        <option value="${CURRENT_CONNECTION}" ${onCurrent ? "selected" : ""}>Use my current connection (the story's model, one job at a time)</option>
        ${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === h.profileId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
    </select>`);
    $sel.on("change", function () { h.profileId = String($(this).val() || ""); save(); redraw(); });
    $conn.append($sel);
    $conn.append(`<div class="set-desc" style="margin-top:8px;">${profiles.length
        ? "A connection profile is made in SillyTavern's API Connections panel: connect the helper's model, save a profile named, say, \"Helper\", then connect your story model again. The profile only needs the API and the model; leave its Settings Preset and Regex Preset unticked. Your story connection never changes: each job is sent straight to the profile."
        : "No Chat Completion profiles yet. The helper can use your current connection, or make a profile for it: in SillyTavern's API Connections panel, connect the helper's model, save a connection profile named, say, \"Helper\" (the API and the model only; Settings Preset and Regex Preset unticked), then connect your story model again and pick the profile here."}</div>`);
    $conn.append(`<div class="mtab-callout gold" style="margin-top:8px;"><i class="fa-solid fa-shield-halved"></i><span>The helper gets no jailbreak. A censored model can refuse its jobs on an NSFW story and send back nothing: use an uncensored or less censored model, such as <b>GLM 5.3 Flash</b> or <b>DeepSeek 4.1 Flash</b>. Its calls are not counted in Story Memory's spend estimate.</span></div>`);
    const lastHere = lastTest && lastTest.profileId === h.profileId ? lastTest.html : "";
    const $test = $(`<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <button type="button" id="helper_test" class="ps-modern-btn" ${h.profileId ? "" : "disabled"}><i class="fa-solid fa-vial"></i> Test</button>
        <span id="helper_test_status" class="set-desc">${lastHere || (!h.profileId ? "Pick a connection first." : tested ? `<span style="color:#10b981;"><i class="fa-solid fa-circle-check"></i> Tested: it works.</span>` : "Sends one short question and checks the answer.")}</span>
    </div>`);
    $test.find("#helper_test").on("click", async function () {
        const $btn = $(this);
        const $status = c.find("#helper_test_status");
        $btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Testing…`);
        $status.text("Asking the helper one short question…");
        let html = "", ok = false;
        try {
            const r = await helperTest();
            if (r.kind === "ok") { ok = true; html = `<span style="color:#10b981;"><i class="fa-solid fa-circle-check"></i> It works: the helper answered as asked.</span>`; }
            else if (r.kind === "other") { ok = true; html = `<span style="color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> It answered, but not what it was asked ("${esc(String(r.reply || "").replace(/<think\b[^>]*>[\s\S]*?(<\/think\s*>|$)/gi, "").trim().slice(0, 80))}"). It works, but a model that does not follow a short instruction may write poor blocks.</span>`; }
            else if (r.kind === "failed") html = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-xmark"></i> The test failed: ${esc(String((r.error && r.error.message) || r.error || "no answer"))}</span>`;
            else if (r.kind === "stopped") html = `<span style="color:#f59e0b;">The test was stopped.</span>`;
            else html = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-xmark"></i> The helper sent back nothing. This model may refuse stories with adult content: try a less censored one, or check the connection.</span>`;
        } catch (e) {
            html = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-xmark"></i> The test failed: ${esc(String((e && e.message) || e))}</span>`;
        }
        lastTest = { profileId: h.profileId, html };
        h.testedProfileId = ok ? h.profileId : "";
        save();
        if ($.contains(document, $btn[0])) redraw();
    });
    $conn.append($test);
    c.append($conn);

    // ── The jobs ──
    const jobs = jobsOnNow();
    const perReply = HELPER_JOBS.filter(j => j.perReply);
    const occasional = HELPER_JOBS.filter(j => !j.perReply);
    const calls = perReply.filter(j => jobs.includes(j.title)).map(j => j.title);
    const $every = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-rotate"></i> With every reply</div>
        <div class="set-desc" style="margin-bottom:8px;">${!ready ? "The helper is not ready: the blocks stay with your story model, and the Continuity check and Recall picks do not run." : calls.length ? `Each reply costs one helper call for each of these: ${esc(calls.join(", "))}.` : "No job runs with every reply right now."}</div></div>`);
    perReply.forEach(j => $every.append(jobRow(j, h, save, redraw)));
    $every.append(blockTicks(h, save, redraw));
    const $again = $(`<button type="button" class="ps-modern-btn" style="margin-top:10px;" ${ready && helperWantsBlocksNow() ? "" : "disabled"}><i class="fa-solid fa-pen-to-square"></i> Write the last reply's blocks again</button>`);
    $again.on("click", async function () {
        const chat = ((getContext() || {}).chat) || [];
        let id = chat.length - 1;
        while (id > 0 && (chat[id].is_user || chat[id].is_system)) id--;
        if (id <= 0) { toastr.info("There is no reply to write the blocks for yet.", "VCRP: helper"); return; }
        $(this).prop("disabled", true);
        const r = await helperWriteBlocks(id, { force: true });
        if (r.status === "done") toastr.success("The helper wrote the last reply's blocks again.", "VCRP: helper");
        else if (r.status !== "failed") toastr.info(`Nothing written: ${r.reason || r.status}.`, "VCRP: helper");
        if ($.contains(document, this)) $(this).prop("disabled", false);
    });
    $every.append($again);
    c.append($every);

    const $occ = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-clock"></i> When the job runs</div>
        <div class="set-desc" style="margin-bottom:8px;">Only when that job fires: a summary, an audit, a scan, a new direction.</div></div>`);
    occasional.forEach(j => $occ.append(jobRow(j, h, save, redraw)));
    c.append($occ);

    // ── Now ──
    const s = getHelperStatus();
    const $now = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-circle-info"></i> Now</div>
        <div class="set-desc">${helperBusy() ? `The helper is on ${esc(helperStatusText(s))}` : ready ? `Ready on ${onCurrent ? "your current connection" : esc(picked ? picked.name : "")}. It does: <b>${esc(jobs.join(", ") || "nothing yet")}</b>.` : "Idle."} A pill at the bottom of the screen shows a running job, with Stop; a reply you send while the helper still writes the last reply's blocks waits for it, up to 30 seconds.</div></div>`);
    if (helperBusy()) {
        const $stop = $(`<button type="button" class="ps-modern-btn" style="margin-top:8px;"><i class="fa-solid fa-stop"></i> Stop the helper's jobs</button>`);
        $stop.on("click", () => { stopHelperJobs(); redraw(); });
        $now.append($stop);
    }
    c.append($now);
}

const helperWantsBlocksNow = () => helperRoutedIdSet().size > 0;

function jobRow(j, h, save, redraw) {
    const on = helperJobWanted(j.key);
    const off = featureOff(j.key) || connectionNote(j.key);
    const $row = $(`<div class="mtab-toggle-row ${on ? "active" : ""}" data-job="${j.key}">
        <div class="toggle-info">
            <div class="toggle-label"><i class="fa-solid ${j.icon}" style="color:${j.color}; margin-right:6px;"></i> ${esc(j.title)}${off ? ` <span class="set-desc" style="opacity:.8;">· ${esc(off)}</span>` : ""}</div>
            <div class="toggle-desc">${esc(j.desc)}</div>
        </div>
        <div class="ps-switch"></div>
    </div>`);
    $row.on("click", () => { h.jobs[j.key] = !on; save(); redraw(); });
    return $row;
}

// Which blocks the helper writes, one tick each: the blocks in the stack it can write.
function blockTicks(h, save, redraw) {
    const blocks = meguminActiveBlocks().filter(routableBlock);
    const $box = $(`<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;"></div>`);
    if (!blocks.length) {
        $box.append(`<span class="set-desc">No block is in the stack (BLOCKS tab), so there is nothing to write.</span>`);
        return $box;
    }
    const routes = helperJobWanted("blocks");
    blocks.forEach(b => {
        const on = routes && h.blockRoutes[b.id] !== false;
        const $chip = $(`<label class="vcrp-helper-chip ${on ? "on" : ""}" title="${routes ? "Tick: the helper writes it; untick: the story model keeps it." : "Switch Blocks on first."}">
            <input type="checkbox" ${on ? "checked" : ""} ${routes ? "" : "disabled"}/> ${esc(b.emoji || "")} ${esc(b.label || b.tag)}
        </label>`);
        $chip.find("input").on("change", function () { h.blockRoutes[b.id] = this.checked; save(); redraw(); });
        $box.append($chip);
    });
    $box.append(`<span class="set-desc" style="width:100%;">The scene list (who is in the scene) goes to the helper with World State, Bonds and NPC Inner Chatter; while the story model keeps one of those, it keeps the scene list too. The Author's Notebook and Pura's state-carrying trackers always stay with the story model.</span>`);
    return $box;
}
