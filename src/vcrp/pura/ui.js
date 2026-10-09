// ─────────────────────────────────────────────────────────────────────────────
// The Pura panel (PRESETS & COT → Pura Director): every Pura setting in one place,
// shown while a Pura engine is selected. The Original engine shows all of Pura's own
// controls; the Adapted engine hides the ones Story Config and VCRP's rules took over.
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { saveProfileToMemory, saveProfileDebounced } from "../../core/profile.js";
import { fireRefreshHook, REFRESH } from "../../core/refreshHooks.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import { PURA_VARS, PURA_DIRECTOR_EXAMPLE, PURA_TOGGLES, PURA_RANDOMISERS, PURA_VOICES } from "../../../data/pura.js";
import {
    puraSettings, puraIsVolatile, puraFormatting, PURA_VOICE_LABELS, PURA_RANDOMISER_LABELS, PURA_MAX_RANDOMISERS,
} from "./index.js";
import { settingCostLabel, puraEngineCostLabel } from "./costs.js";
import { renderToneRulesPanel } from "../toneRulesUi.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);

const ROW = (id, label, desc, control) => `
    <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
        <div class="set-info"><div class="set-label">${label}</div><div class="set-desc">${desc}</div></div>
        ${control}
    </div>`;
// What a setting costs when it is on (vcrp/pura/costs.js).
const COST = (text, fresh, id = "") => `<div class="pura-cost"${id ? ` id="${id}"` : ""} style="font-size:0.66rem; opacity:0.8; margin-top:2px;"><i class="fa-solid fa-coins"></i> ${esc(settingCostLabel(text, { fresh }))}</div>`;
// The selected voice: a fixed one is cached with the main prompt; Randomised is rolled fresh every reply.
const voiceCost = voice => (voice === "random" ? COST(PURA_VOICES.random, true, "pura_cost_voice")
    : voice && PURA_VOICES[voice] ? COST(PURA_VOICES[voice], false, "pura_cost_voice") : `<div class="pura-cost" id="pura_cost_voice"></div>`);
const CHECK = (id, on) => `<input type="checkbox" id="${id}" ${on ? "checked" : ""} />`;
const SELECT = (id, options, value) => `<select id="${id}" class="ps-modern-input" style="width:220px; cursor:pointer;">${Object.entries(options).map(([k, v]) => `<option value="${esc(k)}" ${k === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;

function save(changes) {
    if (!localProfile.pura || typeof localProfile.pura !== "object") localProfile.pura = {};
    Object.assign(localProfile.pura, changes);
    saveProfileToMemory();
    fireRefreshHook(REFRESH.TOKEN_COUNT);
}

/** The panel for `variant` ("original" | "adapted"). `rerender` redraws the tab. */
export function renderPuraPanel(sec, variant, rerender) {
    const s = puraSettings();
    const original = variant === "original";
    const genreDefault = String(PURA_VARS.genre).replace(/^\s*## Genre\s*/, "").trim();
    const example = String(PURA_DIRECTOR_EXAMPLE).replace(/^\s*### Director Instructions\s*/, "").trim();
    const randomCount = s.randomisers.length;
    const cut = s.randomisers.includes("directorsCut");

    sec.append(`
        <h3 style="margin-top:0; color:#ec4899; font-size:1.1rem; border-bottom:1px solid var(--border-color); padding-bottom:10px;"><i class="fa-solid fa-clapperboard"></i> Pura Director · ${original ? "Original" : "Adapted"}</h3>
        <div class="mtab-callout" style="margin-bottom:16px;">
            <i class="fa-solid fa-circle-info"></i>
            <span>Pura's Director Preset 16.0, by Pura (<a href="https://platberlitz.github.io" target="_blank" rel="noopener">platberlitz.github.io</a>). ${original
                ? "<b>Original</b> sends Pura's writing text word for word, with Pura's own formatting, length, user-control and genre settings below; Story Config and the writing style stand aside."
                : "<b>Adapted</b> keeps Pura's writing core but hands genre, tone, POV, tense, pace, length, friction and explicitness to <b>Story Config</b> (tense left on default stays Pura's present tense), and user control to VCRP's own rule."}
            Pura has no CoT script: it thinks in its own &lt;think&gt; block, drawn in the Thinking box. Pura's trackers are in the <b>BLOCKS</b> tab, in the Pura group, and work with every engine.</span>
        </div>`);

    sec.append(`<div class="mtab-callout" id="pura_cost_total" style="margin-bottom:16px;"><i class="fa-solid fa-coins"></i><span>${esc(puraEngineCostLabel(variant))}</span></div>`);

    const panel = $(`<div class="mtab-panel" id="pura_panel"></div>`);
    if (original) {
        panel.append(`<div class="mtab-panel-title gold"><i class="fa-solid fa-scroll"></i> Pura's own controls</div>`);
        panel.append(ROW("", "Main prompt", "The full Director Main Prompt, or Pura's Simplified one for smaller models (it carries none of the settings below except the extras).",
            SELECT("pura_main", { full: "Full (recommended)", simplified: "Simplified (small models)" }, s.main)));
        panel.append(ROW("", "{{user}} control", "Pura's user-control mode, sent with the Formatting rules.",
            SELECT("pura_user", { dont: "Don't write for {{user}}", write: "Write for {{user}} too", director: "{{user}} is only the director" }, s.userControl)));
        panel.append(ROW("", "Formatting rules", "Present tense, third person omniscient, quotes for dialogue, the language and the length below. Sent last, after your message." + COST(puraFormatting(s), true), CHECK("pura_formatting", s.formatting)));
        panel.append(ROW("", "Length", "Pura's length setting (inside the Formatting rules).",
            SELECT("pura_length", { flexible: "Flexible", short: "Short (3-5 paragraphs)", medium: "Medium (8-13 paragraphs)", long: "Long (13+ paragraphs)" }, s.length)));
        panel.append(ROW("", "Genre", "Pura's genre line. Leave the box empty for Pura's own.", CHECK("pura_genre_on", s.genreOn)));
        panel.append(`<textarea id="pura_genre" class="ps-modern-input" rows="2" style="width:100%; background:rgba(0,0,0,0.2); margin-top:6px;" placeholder="${esc(genreDefault)}">${esc(s.genre)}</textarea>`);
    }

    panel.append(`<div class="mtab-panel-title gold" style="margin-top:14px;"><i class="fa-solid fa-feather"></i> Voice and modes</div>`);
    panel.append(ROW("", "Narration voice", "Pura's author voices. Randomised picks one per reply; that one is sent after your message so the cache is untouched." + voiceCost(s.voice),
        SELECT("pura_voice", PURA_VOICE_LABELS, s.voice)));
    if (original) {
        panel.append(ROW("", "Friction Mode", "Skeptical, guarded characters; every agreement hard-won." + COST(PURA_VARS.friction, false), CHECK("pura_friction", s.friction)));
        panel.append(ROW("", "NSFW Mode", "Blunt, explicit physical detail once intimacy begins." + COST(PURA_VARS.nsfw, false), CHECK("pura_nsfw", s.nsfw)));
    }
    panel.append(ROW("", "Gooner Mode", "Absurd hentai-logic pornography as the genre. Exactly what it sounds like." + COST(PURA_VARS.gooner, false), CHECK("pura_gooner", s.gooner)));
    panel.append(ROW("", "Nightmare Difficulty", "A predatory world: crushing prices, swift consequences, bleak catharsis." + COST(PURA_VARS.nightmare, false), CHECK("pura_nightmare", s.nightmare)));

    panel.append(`<div class="mtab-panel-title gold" style="margin-top:14px;"><i class="fa-solid fa-bullhorn"></i> Director Instructions</div>
        <div class="set-desc" style="margin-bottom:6px;">Your own instructions; Pura treats them as the source of truth over anything that contradicts them. With a {{random}} or {{roll}} in them they are sent after your message instead, so the cache stays whole.</div>
        <textarea id="pura_director" class="ps-modern-input" rows="3" style="width:100%; background:rgba(0,0,0,0.2);" placeholder="e.g. ${esc(example)}">${esc(s.director)}</textarea>
        <div id="pura_director_note" class="set-desc" style="margin-top:4px;">${puraIsVolatile(s.director) ? "Carries a per-reply macro: sent after your message." : ""}</div>`);

    panel.append(`<div class="mtab-panel-title gold" style="margin-top:14px;"><i class="fa-solid fa-puzzle-piece"></i> Extras</div>`);
    panel.append(ROW("", "Grounded Prose Rules", "Pura's anti-slop list, sent after your message. Pura advises it off for small models." + COST(PURA_TOGGLES.groundedProse, true), CHECK("pura_grounded", s.groundedProse)));
    const vcrpHtml = Array.isArray(localProfile.addons) && localProfile.addons.includes("html");
    panel.append(ROW("", "HTML objects", `In-world signs, letters, screens and the like drawn as inline HTML.${vcrpHtml ? ` <span id="pura_html_overlap" style="color:#f59e0b;"><i class="fa-solid fa-clone"></i> VCRP's Immersive HTML add-on is on too (Global Toggles &amp; Add Ons): both are sent. Keep one.</span>` : ""}` + COST(PURA_TOGGLES.html, false), CHECK("pura_html", s.html)));
    panel.append(ROW("", "Diegetic Stats Mode", "Floating in-world status displays characters can read and react to." + COST(PURA_TOGGLES.diegeticStats, false), CHECK("pura_stats", s.diegeticStats)));
    panel.append(ROW("", "Name Randomiser", "Random starting letters for new NPC names, and Pura's banned-names list. Sent after your message." + COST(PURA_TOGGLES.nameRandomiser, true), CHECK("pura_names", s.nameRandomiser)));

    panel.append(`<div class="mtab-panel-title gold" style="margin-top:14px;"><i class="fa-solid fa-shuffle"></i> Scene randomisers <span style="opacity:.7; font-weight:400;">(two at most)</span></div>
        <div class="set-desc" style="margin-bottom:6px;">A fresh roll each reply, sent after your message. The Director's Cut combines the first five; pick it alone.</div>`);
    Object.entries(PURA_RANDOMISER_LABELS).forEach(([k, label]) => {
        const on = s.randomisers.includes(k);
        const blocked = !on && (cut || (k === "directorsCut" && randomCount > 0) || randomCount >= PURA_MAX_RANDOMISERS);
        panel.append(`<label style="display:flex; align-items:center; gap:8px; margin:4px 0; font-size:0.8rem; opacity:${blocked ? 0.5 : 1};"><input type="checkbox" class="pura_rand" data-key="${k}" ${on ? "checked" : ""} ${blocked ? "disabled" : ""} /> ${esc(label)} <span class="pura-cost" style="font-size:0.66rem; opacity:0.75;">(${esc(settingCostLabel(PURA_RANDOMISERS[k], { fresh: true }))})</span></label>`);
    });
    // VCRP: what each reply rolled (rolls.js).
    panel.append(ROW("", "Show each reply's rolls", "What the randomisers, the random voice and the Name Randomiser rolled, in the reply's Notes tab. Never sent back to the model.", CHECK("pura_show_rolls", s.showRolls)));
    panel.append(ROW("", "Swipes keep the rolls", "A swipe or regenerate of the latest reply writes it again with the same rolls instead of rolling new ones. A Continue always keeps the reply's voice.", CHECK("pura_keep_rolls", s.keepRolls)));

    // VCRP: this chat's Tone Rules, under the randomisers (they follow Dead Dove Escalation).
    renderToneRulesPanel(panel, { where: "pura" });

    panel.append(`<div class="mtab-panel-title gold" style="margin-top:14px;"><i class="fa-solid fa-brain"></i> Thinking</div>`);
    panel.append(ROW("", "Reasoning help", "Pura has no CoT script: it thinks in its own &lt;think&gt; block. These are Pura's optional nudges for that thinking, sent after your message." + `<div class="pura-cost" style="font-size:0.66rem; opacity:0.8; margin-top:2px;"><i class="fa-solid fa-coins"></i> Reasoning Procedure ${esc(settingCostLabel(PURA_TOGGLES.reasoningProcedure, { fresh: true }))}; Anti-Overthinking ${esc(settingCostLabel(PURA_TOGGLES.antiOverthinking, { fresh: true }))}</div>`,
        SELECT("pura_reasoning", { "": "None", procedure: "Reasoning Procedure", antiOverthinking: "Anti-Overthinking" }, s.reasoning)));

    sec.append(panel);

    const refreshCosts = () => {
        sec.find("#pura_cost_total span").text(puraEngineCostLabel(variant));
        panel.find("#pura_cost_voice").replaceWith(voiceCost(puraSettings().voice));
    };
    const val = (id, v) => panel.find(`#${id}`).on("change", function () { save({ [v]: this.type === "checkbox" ? this.checked : $(this).val() }); refreshCosts(); });
    val("pura_main", "main"); val("pura_user", "userControl"); val("pura_formatting", "formatting"); val("pura_length", "length");
    val("pura_genre_on", "genreOn"); val("pura_voice", "voice"); val("pura_friction", "friction"); val("pura_nsfw", "nsfw");
    val("pura_gooner", "gooner"); val("pura_nightmare", "nightmare"); val("pura_grounded", "groundedProse"); val("pura_html", "html");
    val("pura_stats", "diegeticStats"); val("pura_names", "nameRandomiser"); val("pura_reasoning", "reasoning");
    val("pura_show_rolls", "showRolls"); val("pura_keep_rolls", "keepRolls");
    panel.find("#pura_genre").on("change", function () { save({ genre: String($(this).val() || "") }); refreshCosts(); });
    panel.find("#pura_director").on("input", function () {
        if (!localProfile.pura) localProfile.pura = {};
        localProfile.pura.director = String($(this).val() || "");
        saveProfileDebounced();
        panel.find("#pura_director_note").text(puraIsVolatile(localProfile.pura.director) ? "Carries a per-reply macro: sent after your message." : "");
        refreshCosts();
    });
    panel.find(".pura_rand").on("change", function () {
        const k = String($(this).attr("data-key"));
        let next = puraSettings().randomisers.filter(x => x !== k);
        if (this.checked) next = k === "directorsCut" ? ["directorsCut"] : [...next.filter(x => x !== "directorsCut"), k].slice(-PURA_MAX_RANDOMISERS);
        save({ randomisers: next });
        if (typeof rerender === "function") rerender();
    });
}
