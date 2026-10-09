// ────────────────────────────────────────────────────────────────────────────
// Presets & COT — engine choice, chain-of-thought, thinking effort.
// ────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced, Popup, POPUP_TYPE } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { localProfile, currentTab } from "../../core/state.js";
import { lockedStyleIdFor, isV10Engine, isPuraEngine, puraVariant } from "../../core/engines.js";
import { renderPuraPanel } from "../../vcrp/pura/ui.js";
import { saveProfileToMemory, saveProfileDebounced } from "../../core/profile.js";
import { fireRefreshHook, REFRESH } from "../../core/refreshHooks.js";
import { hardcodedLogic } from "../../../data/database.js";
import { renderDevMode } from "../devmode.js";
import { meguminCotForMode } from "../../../data/cot/index.js";
import { buildStoryConfigSection } from "../../features/storyconfig/ui.js";
import { countActiveConfigFields } from "../../features/storyconfig/config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Dialogue — the switch drawn inside an engine card.
//
// It lives on the card rather than in the tab's own toggle strip because it
// belongs to the engine: it replaces that engine's <dialogue> section and means
// nothing for any other generation. V10 only, because no other generation writes
// that tag and the switch would be inert.
//
// Two grids draw engine cards — the official list and the custom clones — and a
// Dev Mode clone of a V10 engine is still flagged isV10, so the switch has to
// appear on both. Written once here rather than twice inline: the first version
// of this was in the official card only, and the feature disappeared the moment
// anybody cloned an engine to edit it.
// ─────────────────────────────────────────────────────────────────────────────

function enhancedDialogueOn(m) {
    return Boolean(m && localProfile.enhancedDialogue && localProfile.enhancedDialogue[m.id]);
}

function enhancedDialogueMarkup(m, isLocked) {
    if (!isV10Engine(m) || isLocked) return "";
    const on = enhancedDialogueOn(m);
    return `
        <div class="ecard-opt ${on ? "on" : ""}" title="Swap this engine's dialogue rules for the stricter, prescriptive set: named categories, orthographic cues for emotion, and an explicit ban list. For models that read the shipped section as a suggestion.">
            <div class="ecard-opt-text">
                <span class="ecard-opt-label"><i class="fa-solid fa-comment-dots"></i> Enhanced Dialogue</span>
                <span class="ecard-opt-state">${on ? "On" : "Off"}</span>
            </div>
            <div class="ecard-opt-switch"></div>
        </div>`;
}

function wireEnhancedDialogue(card, m, rerender) {
    card.find(".ecard-opt").on("click", function (ev) {
        // Without this the click also selects the engine. Flipping a setting and
        // switching engine are separate intentions and the card must not conflate
        // them — the switch sits inside the card's own click target.
        ev.stopPropagation();
        if (!localProfile.enhancedDialogue) localProfile.enhancedDialogue = {};
        // Deleted rather than set false, so the map only ever holds engines that
        // are actually on and an untouched profile stays empty.
        if (localProfile.enhancedDialogue[m.id]) delete localProfile.enhancedDialogue[m.id];
        else localProfile.enhancedDialogue[m.id] = true;
        saveProfileToMemory();
        // The counter reads the engine's prompt through buildBaseDict, and the
        // two dialogue sections are different lengths.
        fireRefreshHook(REFRESH.TOKEN_COUNT);
        if (typeof rerender === "function") rerender();
    });
}

export function renderCoreAndCot(c) {
    // Preserve active sub-tab and filter before wiping the container
    let activeSubTab = c.find('.ws-nav-btn.active').attr('data-target') || 'sec-official';
    let activeFilter = c.find('.wstyle-filter-pill.active').attr('data-filter') || 'all';

    c.empty();
    const root = $(`<div style="display: flex; flex-direction: column; height: 100%;"></div>`);

    const descriptions = {
        "v10-core": "The storyteller. Ukiyo is the looser of the two — a teller with a temperament, spinning the world and its history, following whatever in the scene is most alive. It trades a little polish for invention: the prose wanders, reaches for an image, and occasionally overreaches. Pick it for atmosphere, momentum and a world that feels told rather than composed. Neither V10 is a downgrade of the other — run a few scenes on each and keep the one that sounds like the story you want to read.",
        "v10-shura": "The writer. Shura is the stricter of the two — no slop, no AI tells, no line that exists to manage the scene. Every character is the protagonist of their own story, acting from their own values, and none of them is a villain in their own eyes; there is no objective right or wrong for the narration to take sides on. Pick it for prose that reads like a book and a cast that drives the story itself. Neither V10 is a downgrade of the other — run a few scenes on each and keep the one that sounds like the story you want to read.",
        "v10-ukiyo-megumin": "Megumin Suite's own V10 Ukiyo, word for word, for RP that reads exactly the way it did on Megumin. Its engine text, thinking steps and Enhanced Dialogue are the originals, and so is the wording of your writing style, add-ons and Story Config while it is selected. The dash cleaner pauses. Pair it with the \"VCRP V10 Megumin Original\" preset. Story Memory works the same as on every VCRP engine.",
        "pura-original": "Pura's Director Preset 16.0 (by Pura), word for word: grounded, character-driven co-writing where {{user}} directs the scene. Pura's own formatting, length, user-control, genre and modes, set in the Pura Director panel; Story Config and the writing style stand aside. Thinks in its own &lt;think&gt; block, without a CoT script. Works with Story Memory, Focus, the NPC Bank and every block, Pura's trackers among them.",
        "pura-adapted": "Pura's Director core, reworded only where VCRP's modules take over: Story Config sets genre, tone, POV, tense, pace, length, friction and explicitness, and VCRP's rule keeps {{user}} yours. Pura's voices, randomisers, extras and modes stay in the Pura Director panel. Thinks in its own &lt;think&gt; block, without a CoT script. Works with Story Memory, Focus, the NPC Bank and every block, Pura's trackers among them.",
        "v10-shura-megumin": "Megumin Suite's own V10 Shura, word for word, for RP that reads exactly the way it did on Megumin. Its engine text, thinking steps and Enhanced Dialogue are the originals, and so is the wording of your writing style, add-ons and Story Config while it is selected. The dash cleaner pauses. Pair it with the \"VCRP V10 Megumin Original\" preset. Story Memory works the same as on every VCRP engine.",
    };

    const activeEng = hardcodedLogic.modes.find(m => m.id === localProfile.mode);
    const activeLabel = activeEng ? activeEng.label : localProfile.mode;

    const totalCount = hardcodedLogic.modes.length;
    const customCount = (extension_settings[extensionName].customModes || []).length;

    // ── UNIFIED HEADER ──
    root.append(`
        <div class="wstyle-header">
            <div class="wstyle-header-left">
                <div class="wstyle-header-icon" style="background: linear-gradient(135deg, #f59e0b, #a855f7);">
                    <i class="fa-solid fa-server"></i>
                </div>
                <div>
                    <h2>PRESETS & COT</h2>
                    <p>Choose the core preset, and COT.</p>
                </div>
            </div>
            <div class="wstyle-active-badge">
                <i class="fa-solid fa-circle-check"></i>
                ${activeLabel}
            </div>
        </div>
    `);

    // ── TWO COLUMN LAYOUT ──
    const layout = $(`<div class="ws-layout"></div>`);
    const sidebar = $(`<div class="ws-sidebar"></div>`);
    const mainArea = $(`<div class="ws-main"></div>`);

    // --- BUILD SIDEBAR ---
    sidebar.append(`<div class="ws-sidebar-title">Configuration</div>`);
    
    const btnOfficial = $(`<button class="ws-nav-btn active" data-target="sec-official"><span style="display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-server"></i> Official Engines</span> <span class="ws-badge">${totalCount}</span></button>`);
    const btnCustom = $(`<button class="ws-nav-btn" data-target="sec-custom"><span style="display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-microchip"></i> Custom Engines</span> <span class="ws-badge">${customCount}</span></button>`);
    
    sidebar.append(btnOfficial).append(btnCustom);
    sidebar.append(`<div style="height: 1px; background: var(--border-color); margin: 8px 0;"></div>`);
    
    const cfgCount = countActiveConfigFields(localProfile.storyConfig);
    const btnConfig = $(`<button class="ws-nav-btn" data-target="sec-config"><span style="display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-sliders" style="color: var(--gold);"></i> Story Config</span> <span style="display:flex; align-items:center; gap:6px;"><span class="ws-new-pill">✨ New</span>${cfgCount > 0 ? `<span class="ws-badge">${cfgCount}</span>` : ''}</span></button>`);
    sidebar.append(btnConfig);

    // VCRP: the Pura Director panel, while a Pura engine is selected.
    const puraOn = isPuraEngine(activeEng);
    const btnPura = $(`<button class="ws-nav-btn" data-target="sec-pura" style="${puraOn ? "" : "display:none;"}"><span style="display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-clapperboard" style="color:#ec4899;"></i> Pura Director</span></button>`);
    sidebar.append(btnPura);

    const btnCot = $(`<button class="ws-nav-btn" data-target="sec-cot"><span style="display:flex; align-items:center; gap:10px; color: ${localProfile.cotEnabled ? 'var(--text-main)' : 'var(--text-muted)'};"><i class="fa-solid fa-brain" style="color: ${localProfile.cotEnabled ? '#a855f7' : ''};"></i> Reasoning (CoT)</span> <span style="font-size: 0.6rem; font-weight: bold; color: ${localProfile.cotEnabled ? '#10b981' : '#ef4444'};">${localProfile.cotEnabled ? 'ON' : 'OFF'}</span></button>`);
    sidebar.append(btnCot);

    layout.append(sidebar);

    // --- BUILD MAIN CONTENT SECTIONS ---
    const secOfficial = $(`<div class="ws-section" id="sec-official"></div>`);
    const secCustom = $(`<div class="ws-section" id="sec-custom" style="display:none;"></div>`);
    const secCot = $(`<div class="ws-section" id="sec-cot" style="display:none;"></div>`);
    const secPura = $(`<div class="ws-section" id="sec-pura" style="display:none;"></div>`);
    const secConfig = buildStoryConfigSection().hide();

    // ==========================================
    // ── A. OFFICIAL ENGINES ──
    // ==========================================
    secOfficial.append(`<h3 style="margin-top: 0; color: var(--gold); font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;"><i class="fa-solid fa-server"></i> Built-in Engines</h3>`);
    secOfficial.append(`
        <div class="mtab-callout gold" style="margin-bottom: 20px;">
            <i class="fa-solid fa-lightbulb"></i>
            <span><strong>Pro Tip:</strong> The Engine defines the "laws of physics" and pacing of your story. The Reasoning acts as the AI's internal scratchpad. Picking an engine also picks its matching CoT (Ukiyo: Writer's Mind, Shura: Seven Rules); you can change it under Reasoning.</span>
        </div>
    `);


    const coreGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 20px;"></div>`);

    hardcodedLogic.modes.forEach(m => {
        let version = "all";
        if (m.label.includes("V4")) version = "V4";
        else if (m.label.includes("V5")) version = "V5";
        else if (m.id.includes("v6")) version = "V6";
        else if (m.id.includes("v7")) version = "V7";
        else if (m.id.includes("v8")) version = "V8";
        // Before the v9 test purely so the two lists stay in the same order.
        else if (m.id.includes("v10")) version = "V10";
        else if (m.id.includes("v9")) version = "V9";

        const isLocked = m.locked === true;
        const isSel = localProfile.mode === m.id;

        let badges = '';
        if (m.recommended) badges += `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;
        if (m.isNew && !isLocked) badges += `<span class="ecard-badge new">New</span>`;
        if (isLocked) badges += `<span class="ecard-badge locked"><i class="fa-solid fa-lock"></i> Coming Soon</span>`;

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''} ${isLocked ? 'locked-card' : ''}" data-version="${version}" style="${(activeFilter !== 'all' && activeFilter !== version) ? 'display:none;' : ''}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${m.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                    </div>
                    <p class="ecard-desc">${descriptions[m.id] || ""}</p>
                    ${badges ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${badges}</div>` : ''}
                    ${enhancedDialogueMarkup(m, isLocked)}
                </div>
            </div>
        `);

        wireEnhancedDialogue(card, m, () => renderCoreAndCot(c));

        if (!isLocked) {
            card.on("click", () => {
                localProfile.mode = m.id;

                // Same mapping the Writing Style tab uses when it finds a locked
                // engine with no style set. One list, so the two cannot disagree.
                const lockedStyle = lockedStyleIdFor(m);
                if (lockedStyle) {
                    localProfile.activeStyleId = lockedStyle;
                    const ds = hardcodedLogic.directStyles.find(x => x.id === lockedStyle);
                    if (ds) localProfile.aiRule = ds.rule;
                }

                // The engine→CoT mapping lives in data/cot/index.js now, so Dev
                // Mode can fill a clone's reasoning script from the same source.
                const targetCot = meguminCotForMode(m.id);
                if (targetCot) localProfile.model = targetCot;
                saveProfileToMemory();
                renderCoreAndCot(c);
            });
        }
        coreGrid.append(card);
    });

    secOfficial.append(coreGrid);


    // ==========================================
    // ── B. CUSTOM ENGINES ──
    // ==========================================
    secCustom.append(`<h3 style="margin-top: 0; color: #10b981; font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;"><i class="fa-solid fa-microchip"></i> Your Custom Engines</h3>`);
    const customModes = extension_settings[extensionName].customModes || [];

    if (customModes.length === 0) {
        secCustom.append(`<div style="padding: 30px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 14px;">No custom engines yet. Go to Dev Mode to create or import one!</div>`);
    } else {
        const customGrid = $(`<div class="mtab-card-grid"></div>`);
        customModes.forEach(m => {
            const isSel = localProfile.mode === m.id;
            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body">
                        <div class="ecard-title">
                            <span>${m.label}</span>
                            <button class="ps-modern-btn secondary btn-quick-edit" style="padding:4px 10px;font-size:0.7rem;color:var(--gold);border-color:rgba(245,158,11,0.3);background:transparent;">
                                <i class="fa-solid fa-pen"></i> Edit
                            </button>
                        </div>
                        <p class="ecard-desc">Custom Engine Flow</p>
                        ${enhancedDialogueMarkup(m, false)}
                    </div>
                </div>
            `);
            card.on("click", (e) => {
                if ($(e.target).closest('.btn-quick-edit').length) return;
                if ($(e.target).closest('.ecard-opt').length) return;
                localProfile.mode = m.id; saveProfileToMemory(); renderCoreAndCot(c);
            });
            wireEnhancedDialogue(card, m, () => renderCoreAndCot(c));
            card.find(".btn-quick-edit").on("click", () => renderDevMode("editor", m.id, null, "tab"));
            customGrid.append(card);
        });
        secCustom.append(customGrid);
    }

    // ==========================================
    // ── C. CHAIN OF THOUGHT (REASONING) ──
    // ==========================================
    secCot.append(`<h3 style="margin-top: 0; color: #a855f7; font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;"><i class="fa-solid fa-brain"></i> Chain of Thought (Reasoning)</h3>`);

    if (localProfile.cotEnabled === undefined) localProfile.cotEnabled = true;

    if (isPuraEngine(activeEng)) {
        secCot.append(`
            <div class="mtab-callout" style="margin-bottom:20px; border-color:rgba(236,72,153,0.4);">
                <i class="fa-solid fa-clapperboard" style="color:#ec4899;"></i>
                <span><strong>Pura has no CoT script.</strong> While a Pura engine is selected, it opens each reply with its own &lt;think&gt; block (drawn in the Thinking box, kept out of the history) and none of the scripts below are sent; Pura's optional nudges for that thinking are in the Pura Director panel. The switch just below still turns its thinking on or off, and the Thinking length (Memory tab) still caps it. Your script choices come back when you switch engine.</span>
            </div>
        `);
    }

    const cotToggle = $(`
        <div class="mtab-toggle-row ${localProfile.cotEnabled ? 'active' : ''}" style="margin-bottom: 20px; border-color: ${localProfile.cotEnabled ? '#a855f7' : 'var(--border-color)'}; cursor: pointer;">
            <div class="toggle-info">
                <div class="toggle-label" style="color: ${localProfile.cotEnabled ? '#a855f7' : 'var(--text-main)'};"><i class="fa-solid fa-power-off"></i> Enable Chain of Thought</div>
                <div class="toggle-desc">Toggle the entire AI reasoning system. When off, the AI generates responses directly.</div>
            </div>
            <div class="ps-switch" style="${localProfile.cotEnabled ? 'background:#a855f7;' : ''}"></div>
        </div>
    `);
    cotToggle.on("click", function() {
        localProfile.cotEnabled = !localProfile.cotEnabled;
        saveProfileToMemory();
        renderCoreAndCot(c);
    });
    secCot.append(cotToggle);

    if (localProfile.cotEnabled) {
        if (activeEng && activeEng.cot && activeEng.cot.trim() !== "") {
            secCot.append(`
                <div class="mtab-callout green" style="margin-bottom:20px;">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span><strong>Custom Engine Logic Active</strong> — This Engine provides its own [[COT]] and [[prefill]]. Selections below will be overridden by the Engine's code.</span>
                </div>
            `);
        }


        if (localProfile.model === "cot-off") {
            localProfile.cotEnabled = false;
            localProfile.model = meguminCotForMode(localProfile.mode) || "cot-v10-ukiyo-english";
            saveProfileToMemory();
        }

        let currentType = "off";
        // The Megumin Original set first: none of its ids share a prefix with VCRP's,
        // but its capped ids do share one with its own uncapped ids.
        const model = localProfile.model || "";
        if (model.startsWith("cot-meg-ukiyo-cap-")) currentType = "meg-ukiyo-cap";
        else if (model.startsWith("cot-meg-shura-cap-")) currentType = "meg-shura-cap";
        else if (model.startsWith("cot-meg-ukiyo-")) currentType = "meg-ukiyo";
        else if (model.startsWith("cot-meg-shura-")) currentType = "meg-shura";
        // The two specific V10 sets are tested before the general one, exactly as
        // v9-lite and v9-director are below: "cot-v10-shura-english" starts with
        // "cot-v10-" too, so a bare test would swallow it.
        // Longest prefix first: "cot-v10-shura-cap-" also starts with
        // "cot-v10-shura-", so the capped ids have to be tested ahead of the plain
        // ones or every cap reads back as its uncapped sibling.
        if (localProfile.model && localProfile.model.startsWith("cot-v10-ukiyo-cap-")) { currentType = "v10-ukiyo-cap"; }
        else if (localProfile.model && localProfile.model.startsWith("cot-v10-shura-cap-")) { currentType = "v10-shura-cap"; }
        else if (localProfile.model && localProfile.model.startsWith("cot-v10-ukiyo-")) { currentType = "v10-ukiyo"; }
        else if (localProfile.model && localProfile.model.startsWith("cot-v10-shura-")) { currentType = "v10-shura"; }

        let allowedCotTypes = null;
        if (localProfile.mode.includes("megumin")) allowedCotTypes = ["meg-ukiyo", "meg-ukiyo-cap", "meg-shura", "meg-shura-cap"];
        else if (localProfile.mode.includes("v10")) allowedCotTypes = ["v10-ukiyo", "v10-ukiyo-cap", "v10-shura", "v10-shura-cap"];

        // Thinking Frameworks
        secCot.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-diagram-project"></i> Select Framework</div>`);
        const typeGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 24px;"></div>`);
        const types = [
            { id: "v10-ukiyo", label: "CoT V10 Ukiyo", desc: "The long-form reasoning built for Ukiyo. Thinks like a novelist muttering before a draft \u2014 present tense, a little messy, never a plan. No phases, no checklists, no audits.", isNew: true },
            { id: "v10-ukiyo-cap", label: "CoT V10 Ukiyo \u2014 Thinking Cap", desc: "The same writer's mind with a hard ceiling on the thinking phase. For models that over-think.", isNew: true },
            { id: "v10-shura", label: "CoT V10 Shura", desc: "Seven rules carried into the writing rather than a plan made before it. Built for V10 Shura, and the lightest of the four.", isNew: true },
            { id: "v10-shura-cap", label: "CoT V10 Shura \u2014 Thinking Cap", desc: "The same seven rules with a hard ceiling on the thinking phase. For models that over-think.", isNew: true },
            { id: "meg-ukiyo", label: "CoT V10 Ukiyo \u00b7 Megumin Original", desc: "Megumin Suite's own Writer's Mind, word for word. Built for the Megumin Original Ukiyo.", isNew: true },
            { id: "meg-ukiyo-cap", label: "CoT V10 Ukiyo \u00b7 Megumin Original \u2014 Thinking Cap", desc: "Megumin Suite's own capped Writer's Mind, word for word.", isNew: true },
            { id: "meg-shura", label: "CoT V10 Shura \u00b7 Megumin Original", desc: "Megumin Suite's own seven rules, word for word. Built for the Megumin Original Shura.", isNew: true },
            { id: "meg-shura-cap", label: "CoT V10 Shura \u00b7 Megumin Original \u2014 Thinking Cap", desc: "Megumin Suite's own capped seven rules, word for word.", isNew: true },
        ];
        types.forEach(t => {
            const isSel = currentType === t.id;
            const isWarned = allowedCotTypes !== null && !allowedCotTypes.includes(t.id);
            
            let badges = '';
            if (isWarned) badges = `<span class="ecard-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> May be Incompatible</span>`;
            else if (t.isNew) badges = `<span class="ecard-badge new">New</span>`;

            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body">
                        <div class="ecard-title">
                            <span>${t.label}</span>
                            ${isSel ? `<span class="ecard-badge" style="background:rgba(168,85,247,0.15);color:#a855f7;"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                        </div>
                        <p class="ecard-desc">${t.desc}</p>
                        ${badges ? `<div style="margin-top:4px;">${badges}</div>` : ''}
                    </div>
                </div>
            `);
            
            card.on("click", () => {
                if (t.id.startsWith("v10") || t.id.startsWith("meg")) localProfile.model = `cot-${t.id}-english`;
                saveProfileToMemory(); renderCoreAndCot(c);
            }); 
            typeGrid.append(card);
        });
        secCot.append(typeGrid);

        // Thinking Effort
        if (!localProfile.thinkEffort) localProfile.thinkEffort = "unspecified";
        if (!localProfile.customThinkEffort) localProfile.customThinkEffort = "100";

        secCot.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-gauge-high"></i> Thinking Effort</div>`);
        const effortGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 24px; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));"></div>`);
        const efforts = [
            { id: "100", label: "100 Words" },
            { id: "250", label: "250 Words" },
            { id: "450", label: "450 Words" },
            { id: "custom", label: "Custom" },
            { id: "unspecified", label: "Unspecified" }
        ];
        efforts.forEach(e => {
            const isSel = localProfile.thinkEffort === e.id;
            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}" style="text-align:center;">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body" style="padding:12px 10px; align-items:center;">
                        <span style="font-weight:700; font-size:0.85rem; color:${isSel ? '#a855f7' : 'var(--text-main)'};">${e.label}</span>
                    </div>
                </div>
            `);
            card.on("click", () => { localProfile.thinkEffort = e.id; saveProfileToMemory(); renderCoreAndCot(c); });
            effortGrid.append(card);
        });
        secCot.append(effortGrid);

        if (localProfile.thinkEffort === "custom") {
            const customBlock = $(`
                <div class="mtab-panel" style="margin-top:-14px; margin-bottom:24px;">
                    <div class="mtab-setting-row">
                        <div class="set-info"><div class="set-label">Custom Word Count</div></div>
                        <input type="number" id="ps_input_custom_effort" class="ps-modern-input" style="width: 150px;" value="${localProfile.customThinkEffort}" min="1" />
                    </div>
                </div>
            `);
            customBlock.find("#ps_input_custom_effort").on("change input", function () {
                localProfile.customThinkEffort = $(this).val(); saveProfileToMemory();
            });
            secCot.append(customBlock);
        }

        // Gemini Toggle
        if (localProfile.thinkingV2 === undefined) localProfile.thinkingV2 = false;
        const v2Card = $(`
            <div class="mtab-toggle-row ${localProfile.thinkingV2 ? 'active' : ''}" style="margin-bottom: 24px; cursor: pointer;">
                <div class="toggle-info">
                    <div class="toggle-label"><i class="fa-solid fa-sparkles" style="color:#a855f7;"></i> Gemini Thinking Override</div>
                    <div class="toggle-desc">Enable ONLY for Gemini models to inject specific XML tags.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
        `);
        v2Card.on("click", function () { localProfile.thinkingV2 = !localProfile.thinkingV2; saveProfileToMemory(); renderCoreAndCot(c); });
        secCot.append(v2Card);

    }

    // --- ASSEMBLE ---
    if (puraOn) renderPuraPanel(secPura, puraVariant(activeEng), () => renderCoreAndCot(c));
    mainArea.append(secOfficial).append(secCustom).append(secCot).append(secConfig).append(secPura);
    layout.append(mainArea);
    root.append(layout);
    c.append(root);

    // ── NAVIGATION LOGIC ──
    const navButtons = [btnOfficial, btnCustom, btnCot, btnConfig, btnPura];
    const sections = [secOfficial, secCustom, secCot, secConfig, secPura];

    const switchSection = (targetId) => {
        navButtons.forEach(btn => {
            if (btn.attr('data-target') === targetId) btn.addClass('active');
            else btn.removeClass('active');
        });
        sections.forEach(sec => {
            if (sec.attr('id') === targetId) sec.show();
            else sec.hide();
        });
    };

    btnOfficial.on('click', () => switchSection('sec-official'));
    btnCustom.on('click', () => switchSection('sec-custom'));
    btnCot.on('click', () => switchSection('sec-cot'));
    btnConfig.on('click', () => switchSection('sec-config'));
    btnPura.on('click', () => switchSection('sec-pura'));

    // Trigger initial state (the Pura panel only while a Pura engine is selected)
    switchSection(activeSubTab === "sec-pura" && !puraOn ? "sec-official" : activeSubTab);
}
