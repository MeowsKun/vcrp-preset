// ────────────────────────────────────────────────────────────────────────────
// Global Toggles & Blocks — add-ons, language, and block membership.
// ────────────────────────────────────────────────────────────────────────────

import { Popup, POPUP_TYPE } from "../../st.js";
import { localProfile, currentTab } from "../../core/state.js";
import { extension_settings } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { saveProfileToMemory, saveProfileDebounced } from "../../core/profile.js";
import { fireRefreshHook, REFRESH } from "../../core/refreshHooks.js";
import { hardcodedLogic } from "../../../data/database.js";
import { meguminSlotByTrigger } from "../../../data/slots.js";
import { hasSharedFragment } from "../../core/sharedFragments.js";

// "You have rewritten this one in Dev Mode."
//
// An add-on card said only whether the add-on was ON. It could not say that the
// text behind it was no longer the shipped text, so a reader who reworded the
// ban list six weeks ago had no way to be reminded of it from the screen where
// they switch it on -- and when the output looked wrong, the edit they had
// forgotten was invisible.
//
// The link between a card and its slot is the trigger both already carry
// ([[Direct]], [[html]], [[MVU]] ...), so this needs no lookup table to fall out
// of date. Two dice add-ons share [[dice]] and both light up, which is right:
// the one edit applies to whichever variant is switched on.
function customBadge(triggerOwner) {
    const slot = meguminSlotByTrigger(triggerOwner && triggerOwner.trigger);
    if (!slot || !slot.key || !hasSharedFragment(slot.key)) return "";
    return `<span class="ecard-badge custom" title="You edited this in Dev Mode. It no longer uses the built-in text."><i class="fa-solid fa-pen"></i> Custom</span>`;
}

export function renderGlobalAndBlocks(c) {
    c.empty();

    const addonDescriptions = {
        "color": "Each character's dialogue is color-coded for easy visual parsing.",
        "dn": "Forces dialogue and narration to be wrapped in their respective XML tags. Useful for specific Models for better narration style adherence. <b>Not recommended on V10</b> — the tags fight that engine's own prose rules.",
        "html": "When a character reads something — a phone screen, a letter, a sign — the AI draws the thing itself as HTML instead of describing it. Rare by design: one per reply at most, and most replies have none.",
        "bold_npcs": "NPCs chase their own goals, never hover or act halfway, and never bend just to please you. Can clash with the V10 engines' subtler rules and with Enhanced Dialogue, so try it before keeping it on."
    };

    // Only MVU is left in this tab's Output Formats section, so only MVU needs a line
    // here. The tracker blocks' descriptions moved onto MEGUMIN_BLOCK_REGISTRY as `desc`
    // when they moved to the BLOCKS tab -- they were sitting here unreachable, because
    // the section below filters to mvu and nothing else ever reached this map.
    const activeMode = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])].find(m => m.id === localProfile.mode);
    // Asked for by behaviour, not by generation: the Lean/Full split is the one thing
    // V10 does not inherit from V9, and naming it that way keeps the next generation
    // from having to be excluded here by hand.

    // ── UNIFIED HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #3b82f6, #10b981);">
                    <i class="fa-solid fa-earth-americas"></i>
                </div>
                <div>
                    <h2>Global Toggles & Blocks</h2>
                    <p>Configure global parameters, gameplay add-ons, and UI tracker blocks.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(59,130,246,0.12); color: #3b82f6; border: 1px solid rgba(59,130,246,0.25);">
                <i class="fa-solid fa-gears" style="font-size:0.6rem;"></i> ${localProfile.addons.length + localProfile.blocks.length} Active Modules
            </div>
        </div>
    `);

    // ── HINT ──
    c.append(`
        <div class="mtab-callout blue" style="margin-bottom: 20px;">
            <i class="fa-solid fa-circle-info"></i>
            <span><strong>Did you know?</strong> Global Preferences set the language and pronouns every engine reads. Gameplay Add-ons bolt extra systems onto the story — Bold NPCs, HTML props, dialogue colours. The tracker blocks live in the <b>BLOCKS</b> tab, not here.</span>
        </div>
    `);

    // ==========================================
    // ── 1. GLOBAL PREFERENCES ──
    // ==========================================
    c.append(`<div class="wstyle-section-head blue"><i class="fa-solid fa-sliders"></i> Global Preferences</div>`);
    
    const extraPanel = $(`
        <div class="mtab-panel" style="margin-bottom: 24px;">
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Language Output</div><div class="set-desc">Leave empty for default (English)</div></div>
                <input type="text" id="ps_input_language" class="ps-modern-input" style="width: 180px;" placeholder="e.g. Arabic, French…" value="${localProfile.userLanguage || ''}" />
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">User Gender</div><div class="set-desc">Ensure the AI addresses you correctly</div></div>
                <select id="ps_select_pronouns" class="ps-modern-input" style="width: 180px; cursor: pointer;">
                    <option value="off" ${localProfile.userPronouns === 'off' ? 'selected' : ''}>Off</option>
                    <option value="male" ${localProfile.userPronouns === 'male' ? 'selected' : ''}>Male (Him/He)</option>
                    <option value="female" ${localProfile.userPronouns === 'female' ? 'selected' : ''}>Female (Her/She)</option>
                </select>
            </div>
        </div>
    `);
    c.append(extraPanel);

    $("#ps_input_language").on("input", function () { localProfile.userLanguage = $(this).val(); saveProfileDebounced(); });
    $("#ps_select_pronouns").on("change", function () { localProfile.userPronouns = $(this).val(); saveProfileToMemory(); });

    // ==========================================
    // ── 2. GAMEPLAY ADD-ONS ──
    // ==========================================
    c.append(`<div class="wstyle-section-head blue"><i class="fa-solid fa-puzzle-piece"></i> Gameplay Add-ons</div>`);
    c.append(`
        <div class="mtab-callout gold" style="margin-bottom: 16px;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>Pick the three or four you actually want, not all of them. Every add-on is another
            system the model has to hold in mind while it writes, and past a handful the prose
            thins out as the attention goes into bookkeeping. Fewer, chosen on purpose, reads better.</span>
        </div>
    `);
    const addonGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 24px;"></div>`);

    hardcodedLogic.addons.forEach(a => {
        const isSel = localProfile.addons.includes(a.id);
        let badges = '';
        if (a.recommended) badges += `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;
        badges += customBadge(a);

        let extraClass = '';
        let v6BadgeHtml = '';

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''} ${extraClass}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${a.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> On</span>` : ''}
                    </div>
                    <p class="ecard-desc">${addonDescriptions[a.id] || ""}</p>
                    ${badges || v6BadgeHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${badges}${v6BadgeHtml}</div>` : ''}
                </div>
            </div>
        `);

        card.on("click", () => {
            if (isSel) {
                localProfile.addons = localProfile.addons.filter(i => i !== a.id);
            } else {
                // Two add-ons in the same `exclusive` group write to the same
                // prompt anchor, so switching to one has to switch the other
                // off — otherwise whichever the loop reached last would win and
                // the toggles would disagree with what was actually sent.
                if (a.exclusive) {
                    const rivals = hardcodedLogic.addons
                        .filter(o => o.id !== a.id && o.exclusive === a.exclusive)
                        .map(o => o.id);
                    localProfile.addons = localProfile.addons.filter(i => !rivals.includes(i));
                }
                localProfile.addons.push(a.id);
            }
            saveProfileToMemory(); fireRefreshHook(REFRESH.SWITCH_TAB);
        }); 
        addonGrid.append(card);
    });

    if (!localProfile.onomatopoeia) localProfile.onomatopoeia = { enabled: false, useStyling: false };
    const isOno = localProfile.onomatopoeia.enabled;
    const isOnoStyle = localProfile.onomatopoeia.useStyling;

    const onoCard = $(`
        <div class="mtab-eng-card ${isOno ? 'active' : ''}">
            <div class="ecard-accent"></div>
            <div class="ecard-body">
                <div class="ecard-title">
                    <span>Cinematic Sounds</span>
                    ${isOno ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> On</span>` : ''}
                    ${customBadge({ trigger: "[[onomato]]" })}
                </div>
                <p class="ecard-desc">Force the AI to use precise phonetic sound words (e.g., click, thud) instead of abstract descriptions.</p>
                <div style="display: ${isOno ? 'flex' : 'none'}; margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--border-color); justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight:700; font-size: 0.75rem; color: var(--text-main);">Animate Sounds</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Wrap in HTML tags. For capable AI only.</div>
                    </div>
                    <div class="ps-toggle-card ${isOnoStyle ? 'active' : ''}" id="ono_inner_toggle" style="padding: 4px; min-width: 44px; justify-content: center; background: transparent; border-color: ${isOnoStyle ? '#10b981' : 'var(--border-color)'};">
                        <div class="ps-switch" style="transform: scale(0.75); ${isOnoStyle ? 'background: #10b981;' : ''}"></div>
                    </div>
                </div>
            </div>
        </div>
    `);
    onoCard.on("click", (e) => {
        if ($(e.target).closest("#ono_inner_toggle").length) {
            localProfile.onomatopoeia.useStyling = !localProfile.onomatopoeia.useStyling;
            saveProfileToMemory(); fireRefreshHook(REFRESH.SWITCH_TAB); return;
        }
        localProfile.onomatopoeia.enabled = !localProfile.onomatopoeia.enabled;
        saveProfileToMemory(); fireRefreshHook(REFRESH.SWITCH_TAB);
    });
    addonGrid.append(onoCard);
    c.append(addonGrid);

    // Custom Engine Settings (Addons)
    if (activeMode && activeMode.customToggles) {
        const customSettings = activeMode.customToggles.filter(t => t.location === "settings");
        if (customSettings.length > 0) {
            const toggleList = $(`<div class="mtab-card-list" style="margin-bottom: 24px;"></div>`);
            customSettings.forEach(cs => {
                const isSel = !!localProfile.toggles[cs.id];
                const tCard = $(`
                    <div class="mtab-toggle-row ${isSel ? 'active' : ''}" style="${isSel ? 'border-color:#10b981;' : ''}">
                        <div class="toggle-info">
                            <div class="toggle-label" style="${isSel ? 'color:#10b981;' : ''}">${cs.name}</div>
                            <div class="toggle-desc">Custom Module → [[${cs.attachPoint}]]</div>
                        </div>
                        <div class="ps-switch" style="${isSel ? 'background:#10b981;' : ''}"></div>
                    </div>
                `);
                tCard.on("click", () => { localProfile.toggles[cs.id] = !localProfile.toggles[cs.id]; saveProfileToMemory(); fireRefreshHook(REFRESH.SWITCH_TAB); });
                toggleList.append(tCard);
            });
            c.append(toggleList);
        }
    }

}
