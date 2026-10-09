// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Tone Rules panel. Drawn in Global Toggles & Add-ons (for every engine) and in
// the Pura Director panel (under the randomisers, by Dead Dove Escalation); both edit the
// same rules, this chat's (see toneRules.js).
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtmlAttr } from "../utils/html.js";
import { toneRules, setToneRules, toneChatOpen, TONE_HEADER } from "./toneRules.js";
import { settingCostLabel } from "./pura/costs.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const EXAMPLE = "e.g. Bleak and unsentimental. Violence lands hard and stays; no rescues, no softening, no last-minute mercy. Humour only ever as gallows humour.";

/**
 * Draws the panel into `container`. `where` keeps the ids apart ("global" | "pura"); in the
 * Pura panel it draws without a frame of its own and says where it sits next to Dead Dove.
 */
export function renderToneRulesPanel(container, { where = "global" } = {}) {
    const id = name => `${where}_tone_${name}`;
    const pura = where === "pura";
    const t = toneRules();
    const cost = () => (t.text.trim() ? settingCostLabel(`${TONE_HEADER}\n\n${t.text.trim()}`, { fresh: true }) : "");
    const box = $(`<div class="${pura ? "" : "mtab-panel "}vcrp-tone-panel" id="${id("panel")}" style="${pura ? "margin-top:14px;" : "margin: 0 0 24px;"}"></div>`);
    box.append(`<div class="mtab-panel-title gold"${pura ? ` style="margin-top:14px;"` : ""}><i class="fa-solid fa-skull"></i> Tone Rules <span style="opacity:.7; font-weight:400;">(this chat)</span></div>`);
    box.append(`<div class="set-desc" style="margin-bottom:8px;">Your own rules for the story's overall tone, saved with this chat. Sent after your newest message on every reply and Continue, with any engine, and they win where Story Config's Narration Tone or the engine's own style disagree.${pura ? " With <b>Dead Dove Escalation</b> rolled this reply they sit right under it; otherwise on their own. The same rules as in Global Toggles &amp; Add-ons." : " With a Pura engine and Pura's <b>Dead Dove Escalation</b> rolled, they sit right under it. Also in the Pura Director panel."}</div>`);
    if (!toneChatOpen()) {
        box.append(`<div class="set-desc" id="${id("closed")}"><i>Open a chat to write its tone rules.</i></div>`);
        container.append(box);
        return;
    }
    box.append(`
        <div class="mtab-setting-row" style="padding:0 0 6px; border:none;">
            <div class="set-info"><div class="set-label">On</div><div class="set-desc">Off keeps the text, sends nothing.</div></div>
            <input type="checkbox" id="${id("on")}" ${t.enabled ? "checked" : ""} />
        </div>
        <textarea id="${id("text")}" class="ps-modern-input" rows="5" style="width:100%; background:rgba(0,0,0,0.2);" placeholder="${esc(EXAMPLE)}">${esc(t.text)}</textarea>
        <div class="pura-cost" id="${id("cost")}" style="font-size:0.66rem; opacity:0.8; margin-top:4px;">${t.text.trim() ? `<i class="fa-solid fa-coins"></i> ${esc(cost())}` : ""}</div>`);
    box.find(`#${id("on")}`).on("change", function () {
        t.enabled = this.checked;
        setToneRules({ enabled: t.enabled });
    });
    box.find(`#${id("text")}`).on("input", function () {
        t.text = String($(this).val() || "");
        setToneRules({ text: t.text }, { soon: true });
        box.find(`#${id("cost")}`).html(t.text.trim() ? `<i class="fa-solid fa-coins"></i> ${esc(cost())}` : "");
    });
    container.append(box);
}
