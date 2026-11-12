// ────────────────────────────────────────────────────────────────────────────
// The settings window's tab list and its dock.
//
// This is the one module that knows which renderer draws which tab, so it must
// import all of them. The renderers therefore must not import back: a tab that
// needs to redraw itself fires REFRESH.SWITCH_TAB instead, which is registered
// at the bottom of this file.
// ────────────────────────────────────────────────────────────────────────────

import { localProfile, currentTab, setCurrentTab } from "../core/state.js";
import { registerRefreshHook, REFRESH } from "../core/refreshHooks.js";
import { TAB_SYNC_KEYS, TABS_ALREADY_GLOBAL, meguminGlobalSyncMap, meguminIsTabSynced, applyTabKeysToAllProfiles } from "../core/sync.js";
import { saveSettingsDebounced } from "../st.js";
import { updateLiveTokenCount } from "../core/tokens.js";
import { renderCoreAndCot } from "./tabs/coreAndCot.js";
import { renderGlobalAndBlocks } from "./tabs/globalAndBlocks.js";
import { renderGlobalSettings, hasUnseenSettingsNotice } from "./tabs/globalSettings.js";
import { renderStoryConfig } from "../features/storyconfig/ui.js";
import { renderStoryPlanner } from "../features/storyplan/ui.js";
import { renderBanList } from "../features/banlist/ui.js";
import { renderNpcBank } from "../features/npc/ui.js";
import { renderMemoryTab } from "../vcrp/memory/ui.js";
import { renderBlocksTab } from "../features/blocks/ui.js";
import { renderKnowledgebase } from "../vcrp/knowledgebase.js";
import { renderFocusTab } from "../vcrp/focus/ui.js";
import { renderNotebookTab } from "../vcrp/notebook/ui.js";
import { renderHelperTab } from "../vcrp/helper/ui.js";
import { renderModelSetup } from "../vcrp/modelSetup/ui.js";
import { renderPlotTab } from "../vcrp/plotUi.js";

// The dock's headings (after Megumin Suite's 1 Nov layout: its tabs grouped under "Story",
// "Helpers" and a folded "Legacy"). VCRP groups its own tabs its own way; what Megumin files
// under Legacy is what VCRP's long stories run on, so it has a heading of its own here.
export const DOCK_GROUPS = [
    { id: "story", title: "Story" },
    { id: "long", title: "Long stories" },
    { id: "helpers", title: "Helpers" },
];

// Layout only. `title` is still a tab's key (its sync setting and its place in saved settings
// go by it), so no title changes; `label` is what the dock shows where the title shouts or
// runs long. `group` puts a tab under a heading; `bottom` pins it to the foot of the dock.
// Dock order is array order, and Global Settings stays last (its notice dot goes by that).
export const tabsUI = [
    { title: "Model Setup", sub: "Pick the model you play with, and use the settings tested for it.", icon: "fa-compass", render: renderModelSetup },
    { title: "PRESETS & COT", label: "Presets & CoT", group: "story", sub: "Choose the core preset and COT, and set the standing rules of the story.", icon: "fa-server", render: renderCoreAndCot },
    { title: "Writing Style", group: "story", sub: "Pick the prose voice the story is told in.", icon: "fa-pen-nib", render: renderStoryConfig },
    { title: "Global Toggles & Add Ons", label: "Toggles & Add-ons", group: "story", sub: "Language, pronouns, and the gameplay systems bolted onto the story.", icon: "fa-earth-americas", render: renderGlobalAndBlocks },
    { title: "BLOCKS", label: "Blocks", group: "story", sub: "What goes inside the master block, in what order, and how it looks.", icon: "fa-cubes", render: renderBlocksTab },
    { title: "Notebook", group: "story", sub: "The Author's Notebook: the truths the story keeps hidden, their clues, and what came out.", icon: "fa-book", render: renderNotebookTab },
    { title: "Memory", group: "long", sub: "Story Memory keeps long chats under your budget.", icon: "fa-memory", render: renderMemoryTab },
    { title: "Knowledgebase", group: "long", sub: "Core world rules, lore, and trope guidance the AI always remembers.", icon: "fa-book-open", render: renderKnowledgebase },
    { title: "Focus", group: "long", sub: "Audit the story every few replies for drift, repeated motifs and slop.", icon: "fa-crosshairs", render: renderFocusTab },
    { title: "Plot", group: "long", sub: "The arc the story is in, the beats you line up, and the open ends it has left hanging.", icon: "fa-route", render: renderPlotTab },
    { title: "Helper", group: "helpers", sub: "A second model for the blocks and the background jobs, on its own connection.", icon: "fa-robot", render: renderHelperTab },
    { title: "NPCs Bank", label: "NPC Bank", group: "helpers", sub: "Automatically extract and track significant NPCs in the story.", icon: "fa-address-book", render: renderNpcBank },
    { title: "Dynamic Ban List", label: "Ban List", group: "helpers", sub: "Scan and ban repetitive AI phrases.", icon: "fa-ban", render: renderBanList },
    { title: "Story Director", group: "helpers", sub: "Direct the narrative. Shape what happens next.", icon: "fa-clapperboard", render: renderStoryPlanner },
    { title: "Global Settings", bottom: true, sub: "Extension preferences and about info.", icon: "fa-gear", render: renderGlobalSettings }
];

/** What the dock shows for a tab. */
export const tabLabel = t => (t && (t.label || t.title)) || "";

/**
 * The dock, top to bottom (pure): [{ tab, index } | { heading } | { spacer }]. The tabs with no
 * group first, then each group under its heading, then the pinned ones under the spacer.
 */
export function dockLayout(tabs = tabsUI, groups = DOCK_GROUPS) {
    const out = [];
    tabs.forEach((tab, index) => { if (!tab.group && !tab.bottom) out.push({ tab, index }); });
    for (const g of groups) {
        const own = tabs.map((tab, index) => ({ tab, index })).filter(x => x.tab.group === g.id && !x.tab.bottom);
        if (!own.length) continue;
        out.push({ heading: g.title, group: g.id });
        out.push(...own);
    }
    out.push({ spacer: true });
    tabs.forEach((tab, index) => { if (tab.bottom) out.push({ tab, index }); });
    return out;
}

// The dock is a bottom bar at this width (style.css, "DOCK → floating bottom bar").
const isPhoneDock = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches;

// Only the bar itself moves (never the page behind it, which scrollIntoView may shift).
function centreDockPill(index) {
    try {
        if (!isPhoneDock()) return;
        const dock = document.getElementById("ps_dynamic_dots");
        const dot = document.getElementById(`dot_${index}`);
        if (dock && dot) dock.scrollLeft = Math.max(0, dot.offsetLeft - (dock.clientWidth - dot.offsetWidth) / 2);
    } catch (e) { /* not drawn yet */ }
}

// A heading's essential look is set on the element: a phone or a browser that kept an older
// cached style.css after an update would otherwise draw it as loose text across the rail.
const HEADING_STYLE = "flex-shrink:0; height:20px; margin:6px 0 2px; padding:0 20px; overflow:hidden; white-space:nowrap; font-size:0.6rem; font-weight:800; letter-spacing:0.09em; text-transform:uppercase; color:#71717a;";

// The dock: every tab in the layout's order, each group under its heading. A tab's dot keeps
// its index in tabsUI as its id (the click handler in index.js goes by it) and its title as
// its tooltip (Model Setup finds a tab's dot by that).
function buildDock(dotsContainer) {
    dotsContainer.empty();
    // The phone's way to every tab at once (the bar scrolls sideways through fifteen pills).
    // Not a .sidebar-step: it opens the list, it is not a tab. Hidden on the desktop rail.
    dotsContainer.append(`<div class="dock-icon dock-menu" id="ps_dock_menu" title="All tabs"><i class="fa-solid fa-bars"></i> <span>All tabs</span></div>`);
    for (const e of dockLayout()) {
        if (e.spacer) { dotsContainer.append(`<div style="flex-grow: 1;"></div>`); continue; }
        if (e.heading) { dotsContainer.append(`<div class="dock-group-label" data-group="${e.group}" style="${HEADING_STYLE}"><span>${e.heading}</span></div>`); continue; }
        const t = e.tab;
        dotsContainer.append(`<div class="dock-icon sidebar-step" id="dot_${e.index}" title="${t.title}"${t.bottom ? ` style="margin-bottom: 15px; color: #a1a1aa; transition: 0.2s;"` : ""}>
            <i class="fa-solid ${t.icon}"></i> <span>${tabLabel(t)}</span>
        </div>`);
    }
    dotsContainer.find("#ps_dock_menu").on("click", e => { e.stopPropagation(); openTabMenu(); });
}

// Every tab under its heading, in a dialog (the browser's top layer: a layer drawn in the page
// gets squashed on a phone). It brings its own look, so a stale cached style.css cannot break it.
const MENU_ID = "vcrp_tab_menu";
export function openTabMenu(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
    const old = doc.getElementById(MENU_ID);
    if (old) old.remove();
    const dlg = doc.createElement("dialog");
    dlg.id = MENU_ID;
    dlg.style.cssText = "padding:12px; border:1px solid #27272a; border-radius:14px; background:#18181b; color:#f4f4f5; width:min(92vw, 420px); max-height:84dvh; overflow-y:auto; box-sizing:border-box; font:inherit;";
    const close = () => { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); };
    const item = e => `<button type="button" class="vcrp-tab-menu-item" data-index="${e.index}" style="display:flex; align-items:center; gap:10px; width:100%; margin:0 0 4px; padding:9px 10px; text-align:left; cursor:pointer; font:inherit; border-radius:10px; border:1px solid ${e.index === currentTab ? "rgba(245,158,11,0.5)" : "#27272a"}; background:${e.index === currentTab ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)"}; color:${e.index === currentTab ? "#fbbf24" : "inherit"};">
        <i class="fa-solid ${e.tab.icon}" style="width:20px; text-align:center;"></i>
        <span style="display:flex; flex-direction:column; gap:1px; min-width:0;"><b style="font-size:0.82rem;">${tabLabel(e.tab)}</b><span style="font-size:0.68rem; color:#a1a1aa; font-weight:400; white-space:normal;">${e.tab.sub || ""}</span></span>
    </button>`;
    dlg.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;"><b><i class="fa-solid fa-bars"></i> All tabs</b>
            <button type="button" class="vcrp-tab-menu-close" title="Close" style="background:rgba(255,255,255,0.06); color:inherit; border:1px solid #27272a; border-radius:8px; padding:6px 10px; cursor:pointer; font:inherit; width:auto; margin:0;"><i class="fa-solid fa-xmark"></i></button></div>`
        + dockLayout().map(e => (e.spacer ? "" : e.heading ? `<div style="margin:10px 2px 5px; font-size:0.62rem; font-weight:800; letter-spacing:0.09em; text-transform:uppercase; color:#71717a;">${e.heading}</div>` : item(e))).join("");
    dlg.querySelector(".vcrp-tab-menu-close").addEventListener("click", close);
    dlg.querySelectorAll(".vcrp-tab-menu-item").forEach(b => b.addEventListener("click", () => { close(); switchTab(Number(b.getAttribute("data-index"))); }));
    dlg.addEventListener("click", e => { if (e.target === dlg) close(); });   // a tap on the backdrop
    dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
    doc.body.appendChild(dlg);
    if (typeof dlg.showModal === "function") { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } } else dlg.setAttribute("open", "");
}

export function switchTab(index) {
    $(".dock").show();
    $("#ps_btn_save_close").show();
    $("#btn_apply_tab_all").show(); // Show on all tabs
    // The toggle is per tab, so its label has to follow the tab.
    setTimeout(updateGlobalSyncButton, 0);

    $("#ps_btn_dev_mode").html(`<i class="fa-solid fa-code"></i> Dev`).css("color", "#a855f7");

    let isSameTab = (currentTab === index);
    const container = $("#ps_stage_content");
    let savedScroll = 0;
    if (isSameTab && container.length) {
        savedScroll = container.scrollTop() || 0;
    }

    setCurrentTab(index);
    const tab = tabsUI[index];

    // Generate Icons
    const dotsContainer = $("#ps_dynamic_dots");
    if (dotsContainer.children(".sidebar-step").length < tabsUI.length) buildDock(dotsContainer);

    $(".dock-icon").removeClass("active");
    $(`#dot_${index}`).addClass("active");
    // On the phone the dock is a bar of pills that scrolls sideways: the one for this tab comes into view.
    centreDockPill(index);

    // Re-read every switch rather than only at build time: the dots are drawn once
    // and reused, so a notice spent this session has to be able to go out again.
    $(`#dot_${tabsUI.length - 1}`).toggleClass("has-notice", hasUnseenSettingsNotice());

    container.empty();
    container.off(".devDirty");

    tab.render(container);

    if (isSameTab) {
        container.scrollTop(savedScroll);
    } else {
        container.scrollTop(0);
    }

    updateLiveTokenCount();
}

export function toggleTabGlobalSync() {
    const title = (tabsUI[currentTab] || {}).title;
    if (!title) return;

    if (TABS_ALREADY_GLOBAL.includes(title)) {
        toastr.info(`${title} is stored globally already — it is the same on every character.`, "VCRP");
        return;
    }
    if (!TAB_SYNC_KEYS[title]) {
        toastr.info("This tab has nothing to sync.", "VCRP");
        return;
    }

    const map = meguminGlobalSyncMap();
    const next = !map[title];
    map[title] = next;
    saveSettingsDebounced();

    if (next) {
        const ok = applyTabKeysToAllProfiles(title);
        if (!ok) {
            map[title] = false;
            saveSettingsDebounced();
            toastr.warning("The panel is still showing the previous chat's settings. Reopen it and try again.", "VCRP");
            updateGlobalSyncButton();
            return;
        }
        toastr.success(`${title} now applies to every character. Changes here follow automatically.`, "VCRP");
    } else {
        toastr.info(`${title} is back to per-character.`, "VCRP");
    }

    updateGlobalSyncButton();
}

export function meguminPropagateTabIfSynced() {
    // Only while the settings window is open: a save from a background feature
    // (an NPC banking itself, a summary landing) is not an edit to a tab.
    if (!$("#btn_apply_tab_all").length) return;
    const title = (tabsUI[currentTab] || {}).title;
    if (!meguminIsTabSynced(title)) return;
    applyTabKeysToAllProfiles(title);
}

export function updateGlobalSyncButton() {
    const btn = $("#btn_apply_tab_all");
    if (!btn.length) return;

    const title = (tabsUI[currentTab] || {}).title;
    const alreadyGlobal = TABS_ALREADY_GLOBAL.includes(title);
    const syncable = Boolean(TAB_SYNC_KEYS[title]);
    const on = meguminIsTabSynced(title);

    if (alreadyGlobal || !syncable) {
        btn.html(`<i class="fa-solid fa-earth-americas"></i> Global`)
            .attr("title", alreadyGlobal ? "This tab is stored globally already." : "This tab has nothing to sync.")
            .css({ color: "var(--text-muted)", "border-color": "var(--border-color)", opacity: "0.55" });
        return;
    }

    btn.html(`<i class="fa-solid fa-earth-americas"></i> Global: ${on ? "On" : "Off"}`)
        .attr("title", on
            ? `Every change on the ${title} tab is copied to all characters. Click to stop.`
            : `Changes on the ${title} tab stay with this character. Click to make them global.`)
        .css({
            color: on ? "#10b981" : "var(--gold)",
            "border-color": on ? "rgba(16,185,129,0.45)" : "rgba(245,158,11,0.3)",
            opacity: "1"
        });
}

// ────────────────────────────────────────────────────────────────────────────
// Wiring.
// ────────────────────────────────────────────────────────────────────────────

// With no index: redraw whatever is on screen. With one: navigate to it.
registerRefreshHook(REFRESH.SWITCH_TAB, (index) =>
    switchTab(typeof index === "number" ? index : currentTab));
registerRefreshHook(REFRESH.TAB_PROPAGATE, () => meguminPropagateTabIfSynced());
