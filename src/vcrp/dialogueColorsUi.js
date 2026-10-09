// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Dialogue Colors list (Global Toggles & Add-ons, under the add-on cards, while
// Dialogue Colors is on). This chat's locked colors: who has which, to change one or let
// the model pick again. See dialogueColors.js for how they are learned and kept.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtmlAttr } from "../utils/html.js";
import { lockedColorList, setLockedColor, forgetLockedColor, forgetAllLockedColors } from "./dialogueColors.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
// <input type="color"> takes #rrggbb only.
const sixDigit = c => (/^#[0-9a-f]{3}$/i.test(c) ? `#${c.slice(1).split("").map(x => x + x).join("")}` : c);

/** Draws the list into `container`. `rerender` redraws the tab after a change. */
export function renderDialogueColorsPanel(container, rerender) {
    const list = lockedColorList();
    const redraw = () => { if (typeof rerender === "function") rerender(); };
    const panel = $(`<div class="mtab-panel" id="vcrp_colors_panel" style="margin: -8px 0 24px;"></div>`);
    panel.append(`<div class="mtab-panel-title gold"><i class="fa-solid fa-palette"></i> Dialogue colors in this chat</div>`);
    panel.append(`<div class="set-desc" style="margin-bottom:8px;">Each character keeps the color they first spoke in. Change one and the next replies use it (earlier replies keep theirs); forget one and the model picks again the next time they speak.</div>`);
    if (!list.length) {
        panel.append(`<div class="set-desc" id="vcrp_colors_empty"><i>None yet. They are learned from the replies as characters speak.</i></div>`);
    }
    list.forEach(c => {
        const row = $(`
            <div class="mtab-setting-row vcrp-color-row" data-key="${esc(c.key)}" style="padding:4px 0;">
                <div class="set-info"><div class="set-label" style="color:${esc(c.color)};">${esc(c.name)}</div><div class="set-desc">${esc(c.color)}</div></div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <input type="color" class="vcrp-color-pick" value="${esc(sixDigit(c.color))}" title="Change ${esc(c.name)}'s color" style="width:38px; height:28px; padding:0; border:none; background:transparent; cursor:pointer;" />
                    <button type="button" class="ps-modern-btn secondary vcrp-color-forget" title="Forget: the model picks again"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>`);
        row.find(".vcrp-color-pick").on("change", function () { if (setLockedColor(c.key, String($(this).val() || ""))) redraw(); });
        row.find(".vcrp-color-forget").on("click", () => { if (forgetLockedColor(c.key)) redraw(); });
        panel.append(row);
    });
    if (list.length > 1) {
        const all = $(`<button type="button" class="ps-modern-btn secondary" id="vcrp_colors_forget_all" style="margin-top:8px;"><i class="fa-solid fa-eraser"></i> Forget all</button>`);
        all.on("click", () => { forgetAllLockedColors(); redraw(); });
        panel.append(all);
    }
    container.append(panel);
}
