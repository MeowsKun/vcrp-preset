// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Model Setup tab (Megumin Suite V11's, in VCRP's terms). Pick the model you play
// with, see the settings tested for it, and "Use this loadout" sets them, on every character
// unless you keep it to this one. A popup lists what it changes before anything is written.
// A loadout not in use shows its own settings; a change there only changes what Use this
// loadout will set. The loadout in use shows the real settings, so changing one here is
// changing it in its tab. The rows stored once for every character (the prefill, the Safety
// cap, the helper) are the same whichever way.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced, Popup, POPUP_TYPE } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { localProfile, _loadedProfileKey } from "../../core/state.js";
import { getCharacterKey } from "../../core/keys.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { meguminIsTabSynced, applyTabKeysToAllProfiles } from "../../core/sync.js";
import { fireRefreshHook, REFRESH } from "../../core/refreshHooks.js";
import { hardcodedLogic } from "../../../data/database.js";
import { storyConfigFields } from "../../features/storyconfig/config.js";
import { escapeHtmlAttr as esc } from "../../utils/html.js";
import { helperSettings } from "../helper/settings.js";
import { LOADOUTS, ENGINE_CHOICES, loadoutById, settingFor, applyLoadout, changedFromLoadout, loadoutChanges, loadoutWrites } from "./loadouts.js";

const GOOD_HABITS = [
    "<b>Turn on only what your story needs.</b> Every block, tracker and helper adds to what the model reads each turn. Start with a loadout and two or three blocks, and add more when you miss them.",
    "<b>Let Story Memory run</b> (Memory tab): it keeps long chats within your target per request, and the cache does the rest.",
    "<b>Sending jobs to the helper?</b> The blocks cost one helper call per reply; the occasional jobs only when they fire.",
];

// Page state, kept while SillyTavern is open.
let picked = null;
let onlyThisCharacter = false;
// A loadout's settings as changed on the page before using it, by loadout id.
const drafts = {};

const lengthField = () => storyConfigFields.find(f => f.key === "length");

// Story Config keeps the sentence the model reads; a row shows its label. The global rows
// read and write the global settings.
function makeCtx() {
    const gs = () => { const s = extension_settings[extensionName] || (extension_settings[extensionName] = {}); return s.globalSettings || (s.globalSettings = {}); };
    return {
        lengthLabel(v) {
            const value = String(v || "").trim();
            if (!value) return "";
            // A stored value, or one of an option's older wordings (config.js keeps them as legacy).
            const o = lengthField().options.find(x => x.value === value || (Array.isArray(x.legacy) && x.legacy.includes(value)));
            return o ? o.label : "custom";
        },
        lengthValue(label) {
            const o = lengthField().options.find(x => x.label === label);
            return o ? o.value : label;
        },
        global: {
            prefill: () => gs().cotPrefillMode || "auto",
            setPrefill: v => { gs().cotPrefillMode = ["auto", "on", "off"].includes(v) ? v : "auto"; },
            replyCap: () => { const n = Math.round(Number((gs().memoryBudget || {}).replyCap) || 0); return n > 0 ? n : 0; },
            setReplyCap: v => { const g = gs(); g.memoryBudget = g.memoryBudget || {}; g.memoryBudget.replyCap = Math.max(0, Math.round(Number(v) || 0)); },
            helperBlocks: () => { const h = helperSettings(); return Boolean(h.enabled && (typeof h.jobs.blocks === "boolean" ? h.jobs.blocks : true)); },
            setHelperBlocks: on => { const h = helperSettings(); h.jobs.blocks = Boolean(on); if (on) h.enabled = true; },
        },
    };
}

const helperReady = () => { const h = helperSettings(); return Boolean(h.enabled && h.profileId); };

// Opens a tab by its title (the dock knows the index).
function openTab(title) {
    const dot = typeof document !== "undefined" ? document.querySelector(`#ps_dynamic_dots .dock-icon[title="${title.replace(/"/g, "")}"]`) : null;
    const m = dot && String(dot.id || "").match(/^dot_(\d+)$/);
    if (m) fireRefreshHook(REFRESH.SWITCH_TAB, Number(m[1]));
    else if (typeof toastr !== "undefined") toastr.info(`Open the ${title} tab from the dock.`, "VCRP");
}

// A change on the page saves like the same change in its tab, "every character" included.
// Returns the titles of the tabs it sent to every character.
function saveFor(...tabs) {
    saveProfileToMemory();
    const sent = tabs.filter(id => meguminIsTabSynced(id) && applyTabKeysToAllProfiles(id));
    fireRefreshHook(REFRESH.TOKEN_COUNT);
    return sent;
}

// The tabs a change of these settings touches. An engine that brings its own style changes Writing Style too.
function tabsOf(keys, styleBefore) {
    const tabs = new Set(keys.map(k => settingFor(k)).filter(s => s && !s.global).map(s => s.tab));
    if (localProfile.activeStyleId !== styleBefore) tabs.add("Writing Style");
    return [...tabs];
}

const listNames = names => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function renderModelSetup(c) {
    c.empty();
    const rerender = () => renderModelSetup(c);
    if (!picked || !loadoutById(picked)) picked = loadoutById(localProfile.loadout) ? localProfile.loadout : LOADOUTS[0].id;

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #0ea5e9, #a855f7);"><i class="fa-solid fa-compass"></i></div>
                <div><h2>Model Setup</h2><p>Pick the model you play with, and use the settings tested for it.</p></div>
            </div>
        </div>
        <div class="mtab-callout green" style="margin-bottom:12px;"><i class="fa-solid fa-circle-info"></i><span><b>This page is optional.</b> A loadout is the settings Megumin's author tested for that model, in VCRP's terms. Skipping it, or using a model that is not listed, breaks nothing: pick any engine and set everything yourself in the other tabs.</span></div>
    `);

    const $pick = $(`<div class="mtab-panel"><div class="mtab-panel-title purple"><i class="fa-solid fa-hand-pointer"></i> Pick your model</div><div class="set-desc" style="margin-bottom:8px;">Tapping a model shows its settings. Nothing changes until you press Use this loadout.</div></div>`);
    const $grid = $(`<div class="vcrp-msx-grid"></div>`);
    LOADOUTS.forEach(l => {
        const inUse = localProfile.loadout === l.id;
        const $card = $(`<button type="button" class="vcrp-msx-model ${l.id === picked ? "active" : ""}">
            <span class="vcrp-msx-model-title"><i class="fa-solid ${l.icon}"></i> ${esc(l.name)}${inUse ? ` <span class="vcrp-msx-inuse"><i class="fa-solid fa-check"></i> In use</span>` : ""}</span>
            <span class="vcrp-msx-model-models">${esc(l.models)}</span>
        </button>`);
        $card.on("click", () => { if (picked !== l.id) { picked = l.id; rerender(); } });
        $grid.append($card);
    });
    $pick.append($grid);
    c.append($pick);

    c.append(loadoutCard(loadoutById(picked), rerender));
    c.append(helpCard());
}

// ── The picked loadout ───────────────────────────────────────────────────────

function loadoutCard(l, rerender) {
    const ctx = makeCtx();
    const $card = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid ${l.icon}"></i> ${esc(l.name)}</div><div class="set-desc" style="margin-bottom:8px;">${esc(l.why)}</div></div>`);
    // Not in use: the rows show the loadout's own settings, as a draft.
    const draft = localProfile.loadout === l.id ? null : (drafts[l.id] = drafts[l.id] || { ...l.settings });
    const changed = draft
        ? Object.keys(l.settings).filter(k => draft[k] !== l.settings[k])
        : changedFromLoadout(localProfile, l, ctx);

    l.notes.forEach(n => {
        const $n = $(`<div class="mtab-callout ${n.tone === "red" ? "red" : "gold"}" style="margin:6px 0;"><i class="fa-solid ${n.tone === "red" ? "fa-triangle-exclamation" : "fa-lightbulb"}"></i><span>${n.text}</span></div>`);
        if (n.helper && !helperReady()) {
            const $b = $(`<button type="button" class="ps-modern-btn" style="font-size:0.72rem; margin-left:8px;">Set up the helper <i class="fa-solid fa-arrow-right"></i></button>`);
            $b.on("click", () => openTab("Helper"));
            $n.find("span").append(" The helper is not set up yet.").after($b);
        }
        $card.append($n);
    });
    if (draft) $card.append(`<div class="mtab-callout" style="margin:6px 0;"><i class="fa-solid fa-eye"></i><span><b>Not in use yet.</b> These are the settings Use this loadout will set. Change any of them first if you like.</span></div>`);

    const $rows = $(`<div class="vcrp-msx-rows"></div>`);
    Object.keys(loadoutWrites(l.settings)).filter(k => k in l.settings || settingFor(k).offElsewhere).forEach(key => {
        if (!(key in l.settings) && !(draft ? draft[key] !== undefined : settingFor(key).read(localProfile, ctx))) return;   // an offElsewhere row already off: nothing to show
        $rows.append(settingRow(settingFor(key), l, changed.includes(key), draft, ctx, rerender));
    });
    $card.append($rows);

    const $foot = $(`<div class="vcrp-msx-foot"></div>`);
    const $scope = $(`<div class="vcrp-msx-scope">
        <label><input type="radio" name="vcrp_msx_scope" value="every" ${onlyThisCharacter ? "" : "checked"}/> Every character</label>
        <label><input type="radio" name="vcrp_msx_scope" value="one" ${onlyThisCharacter ? "checked" : ""}/> This character only</label>
        <span class="set-desc">${onlyThisCharacter ? "The prefill, the Safety cap and the helper, and any tab set to \"every character\", still go to every character." : "Every character gets these settings."}</span>
    </div>`);
    $scope.find("input").on("change", function () { onlyThisCharacter = $(this).val() === "one"; rerender(); });
    $foot.append($scope);
    const $use = $(`<button type="button" class="ps-modern-btn primary"><i class="fa-solid fa-check"></i> Use this loadout</button>`);
    $use.on("click", () => useLoadout(l, draft, ctx, rerender));
    $foot.append($use);
    $card.append($foot);
    return $card;
}

function settingRow(s, l, isChanged, draft, ctx, rerender) {
    const value = draft ? draft[s.key] : s.read(localProfile, ctx);
    const $row = $(`<div class="vcrp-msx-row">
        <div class="vcrp-msx-row-label">${esc(s.label)}${draft ? ` <span class="vcrp-msx-tag" title="This loadout is not in use yet. A change here only changes what Use this loadout will set.">Preview</span>` : ""}${isChanged ? ` <span class="vcrp-msx-tag changed" title="The loadout sets ${esc(describe(s.key, l.settings[s.key]))}.">Changed from the loadout</span>` : ""}${s.desc ? `<div class="set-desc">${esc(s.desc)}</div>` : ""}</div>
        <div class="vcrp-msx-row-control"></div>
        <button type="button" class="ps-modern-btn vcrp-msx-open" title="Open ${esc(s.tab)}"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${esc(s.tab)}</button>
    </div>`);
    $row.find(".vcrp-msx-open").on("click", () => openTab(s.tab));
    const set = draft
        ? v => { draft[s.key] = v; rerender(); }
        : v => {
            const styleBefore = localProfile.activeStyleId;
            s.write(localProfile, v, ctx);
            if (s.global) saveSettingsDebounced();
            saveFor(...tabsOf([s.key], styleBefore));
            rerender();
        };
    const $ctl = $row.find(".vcrp-msx-row-control");
    if (s.key === "mode") {
        const ids = ENGINE_CHOICES.includes(value) ? ENGINE_CHOICES : [...ENGINE_CHOICES, value];
        const $sel = $(`<select class="ps-modern-input"></select>`);
        ids.forEach(id => $sel.append(`<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(engineLabel(id))}</option>`));
        $sel.on("change", () => set($sel.val()));
        $ctl.append($sel);
    } else if (s.key === "length") {
        const $sel = $(`<select class="ps-modern-input"></select>`);
        if (value === "custom" || value === "") $sel.append(`<option value="" selected>${value === "custom" ? "Your own" : "Not set"}</option>`);
        lengthField().options.forEach(o => $sel.append(`<option value="${esc(o.label)}" ${o.label === value ? "selected" : ""}>${esc(o.label)}</option>`));
        $sel.on("change", () => { if ($sel.val()) set($sel.val()); });
        $ctl.append($sel);
    } else if (s.key === "prefill") {
        $ctl.append(segmented([["auto", "Auto"], ["on", "Always on"], ["off", "Always off"]], value, set));
    } else if (s.key === "replyCap") {
        const $in = $(`<input type="number" min="0" step="100" class="ps-modern-input" style="width:110px;" value="${esc(String(value || 0))}" />`);
        $in.on("change", () => set(Math.max(0, Math.round(Number($in.val()) || 0))));
        $ctl.append($in);
    } else {
        $ctl.append(segmented([[true, "On"], [false, "Off"]], Boolean(value), v => set(v)));
    }
    return $row;
}

function segmented(choices, value, onPick) {
    const $box = $(`<div class="vcrp-msx-seg"></div>`);
    choices.forEach(([v, label]) => {
        const $b = $(`<button type="button" class="${v === value ? "on" : ""}">${esc(label)}</button>`);
        $b.on("click", () => { if (v !== value) onPick(v); });
        $box.append($b);
    });
    return $box;
}

function engineLabel(id) {
    const all = [...(hardcodedLogic.modes || []), ...((extension_settings[extensionName] || {}).customModes || [])];
    const m = all.find(x => x.id === id);
    return m ? m.label : id;
}

// How a loadout value reads in the tooltip and the popup.
function describe(key, v) {
    if (key === "mode") return engineLabel(v);
    if (key === "length") return v === "custom" ? "your own" : (v || "not set");
    if (key === "prefill") return { auto: "Auto", on: "always on", off: "always off" }[v] || String(v);
    if (key === "replyCap") return Number(v) > 0 ? `${Number(v).toLocaleString("en-US")} tokens` : "off";
    if (key === "style") return styleName(v);
    return v ? "on" : "off";
}

function styleName(id) {
    if (!id) return "no style";
    const s = (hardcodedLogic.directStyles || []).find(x => x.id === id) || (localProfile.customStyles || []).find(x => x.id === id);
    return s ? s.name : id;
}

// Before anything is written: what changes, and for whom. Resolves true on Use.
async function confirmLoadout(l, settings, ctx) {
    const changes = loadoutChanges(localProfile, l, ctx, settings);
    const list = changes.length
        ? `<ul style="margin:6px 0 0 18px; padding:0;">${changes.map(ch => `<li><b>${esc(ch.label)}:</b> ${esc(describe(ch.key, ch.from))} → ${esc(describe(ch.key, ch.to))}</li>`).join("")}</ul>`
        : `<p>This character already has every one of these settings.</p>`;
    const who = !onlyThisCharacter
        ? `<p><b>For every character.</b> The list is what changes on this one; every other character gets the same settings.</p>`
        : `<p><b>For this character only.</b> The prefill, the Safety cap and the helper are the same for every character either way.</p>`;
    const $body = $(`<div style="text-align:left;"><h3 style="margin-top:0;">Use the ${esc(l.name)} loadout?</h3>${who}${list}</div>`);
    return Boolean(await new Popup($body, POPUP_TYPE.CONFIRM, "", { okButton: "Use this loadout", cancelButton: "Cancel" }).show());
}

async function useLoadout(l, draft, ctx, rerender) {
    const settings = draft || l.settings;
    if (!(await confirmLoadout(l, settings, ctx))) return;
    // Same guard as Global sync: the page must belong to the chat that is open.
    const liveKey = getCharacterKey() || "default";
    if (_loadedProfileKey && liveKey !== _loadedProfileKey) {
        toastr.warning("The window is still showing the previous chat's settings. Reopen it and try again.", "VCRP");
        return;
    }
    if (!onlyThisCharacter) {
        // The global rows are written once, through the profile on screen.
        Object.values((extension_settings[extensionName] || {}).profiles || {}).forEach(p => applyLoadout(p, l, ctx, settings, { skipGlobal: true }));
    }
    const styleBefore = localProfile.activeStyleId;
    applyLoadout(localProfile, l, ctx, settings);
    saveSettingsDebounced();
    delete drafts[l.id];
    if (!onlyThisCharacter) {
        saveProfileToMemory();
        fireRefreshHook(REFRESH.TOKEN_COUNT);
        toastr.success(`${l.name} is in use on every character.`, "VCRP");
    } else {
        const sent = saveFor(...tabsOf(Object.keys(loadoutWrites(settings)), styleBefore));
        const also = sent.length ? ` ${listNames(sent)} ${sent.length > 1 ? "are" : "is"} set to "every character", so ${sent.length > 1 ? "their" : "its"} settings went to every character.` : "";
        toastr.success(`${l.name} is in use on this character.${also}`, "VCRP");
    }
    rerender();
}

function helpCard() {
    const $card = $(`<div class="mtab-panel" style="margin-top:12px;"><div class="mtab-panel-title purple"><i class="fa-solid fa-seedling"></i> Good habits</div></div>`);
    $card.append(`<ul class="vcrp-msx-habits">${GOOD_HABITS.map(p => `<li>${p}</li>`).join("")}</ul>`);
    return $card;
}
