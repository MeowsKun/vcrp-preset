// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Canon sheet's panel (Memory tab, drawn with Story Memory on or off).
//
// The lines, each editable in place and removable; a box to add one; and, when Story Memory
// has facts, the ones worth offering (canon.js, canonSuggestions), each with its own Add. A
// fact added from the ledger is pinned there too. The sheet sits in the cached part of the
// prompt, so a change is paid for once, on the next request: the panel says so.
// ─────────────────────────────────────────────────────────────────────────────

import { saveMetadata } from "../st.js";
import { escapeHtmlAttr } from "../utils/html.js";
import { canonItems, addCanon, editCanon, removeCanon, canonSuggestions, canonTokens, CANON_SOFT_MAX } from "./canon.js";
import { presetCarriesAlwaysSlot } from "./knowledgebase.js";
import { memoryState, vcrpMemoryEnabled } from "./memory/index.js";
import { continuityOn } from "./continuity.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const save = async () => { try { await saveMetadata(); } catch (e) { console.warn("[VCRP] Canon: could not save the chat's data", e); } };

/** Draws the panel into `$c` (appended); `rerender` redraws the tab after a change. */
export function renderCanonPanel($c, rerender) {
    const items = canonItems();
    const st = vcrpMemoryEnabled() ? memoryState() : null;
    const ledger = (st && st.ledger) || [];
    const offers = canonSuggestions(ledger, items);
    const cached = presetCarriesAlwaysSlot();
    const size = items.length ? ` It takes about ${canonTokens(items).toLocaleString("en-US")} tokens.` : "";
    const where = cached
        ? "It is sent with every reply in the cached part of the prompt, so after the first request a line costs a fraction of its price. A change here is paid for once: the next request writes its prompt in full."
        : "Your preset is from before the cached slot for it, so it is sent after the chat on every reply, at full price (re-import the preset to cache it).";
    $c.append(`<div class="mtab-panel vcrp-canon" style="margin-bottom:14px;"><div class="mtab-panel-title gold"><i class="fa-solid fa-landmark"></i> Canon sheet (${items.length})</div>
        <div style="font-size:0.75rem; line-height:1.55; margin-bottom:8px;">The facts of this story that never change: who people are to one another, what the world allows, what was promised. The story is told nothing in a reply may contradict them. ${where}${size} Kept with this chat.${items.length > CANON_SOFT_MAX ? ` <span style="color:#f59e0b;">More than ${CANON_SOFT_MAX} lines: the more there are, the less each one weighs. Keep what the story stands on.</span>` : ""}</div>
        <div style="font-size:0.72rem; margin-bottom:8px; opacity:.85;"><i class="fa-solid fa-scale-balanced"></i> <b>Continuity check:</b> ${continuityOn() ? "on. The helper model reads each reply against this sheet and the scene before it, and puts a line under a reply that contradicts them, with a one-tap corrected swipe." : "off. It needs the helper model: in the Helper tab, switch the helper on with a connection and keep its Continuity check ticked."}</div>
        <div id="vcanon_list" style="display:flex; flex-direction:column; gap:4px;">
            ${items.map(i => `<div style="display:flex; gap:6px; align-items:center;">
                <input class="ps-modern-input vcanon-line" data-id="${esc(i.id)}" value="${esc(i.text)}" style="flex:1; min-width:0; font-size:0.76rem;"${i.from ? ` title="From Story Memory's fact ${esc(i.from)}, pinned there"` : ""}>
                <button class="ps-modern-btn secondary vcanon-remove" data-id="${esc(i.id)}" style="padding:2px 8px; color:#ef4444;" title="Take this line off the sheet"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join("")}
        </div>
        <div style="display:flex; gap:6px; margin-top:8px;">
            <input id="vcanon_new" class="ps-modern-input" placeholder="A fact that never changes: Mara is Bob's older sister" style="flex:1; min-width:0; font-size:0.76rem;">
            <button id="vcanon_add" class="ps-modern-btn secondary" style="font-size:0.72rem;"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
        ${offers.length ? `<div style="font-size:0.72rem; opacity:.8; margin:10px 0 4px;">From this chat's facts (the pinned ones and those that have stood longest). Added lines are pinned in the fact ledger too, so no summary rewords them without your review.</div>
        <div style="display:flex; flex-direction:column; gap:4px;">
            ${offers.map(f => `<div style="display:flex; gap:6px; align-items:flex-start; font-size:0.74rem;">
                <button class="ps-modern-btn secondary vcanon-offer" data-id="${esc(f.id)}" style="padding:1px 8px; font-size:0.7rem; flex-shrink:0;" title="Add this fact to the sheet"><i class="fa-solid fa-plus"></i></button>
                <span><span style="opacity:.6;">[${esc(f.cat)}]</span> ${esc(f.text)}${f.pinned ? ` <i class="fa-solid fa-thumbtack" style="color:#f59e0b; font-size:0.65rem;"></i>` : ""}</span>
            </div>`).join("")}
        </div>` : ""}
    </div>`);

    const changed = async () => { await save(); rerender(); };
    $c.find("#vcanon_add").on("click", async () => {
        const text = String($c.find("#vcanon_new").val() || "");
        if (!text.trim()) return;
        if (!addCanon(text) && typeof toastr !== "undefined") toastr.info("That line is on the sheet already.", "VCRP Canon");
        await changed();
    });
    $c.find("#vcanon_new").on("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $c.find("#vcanon_add").trigger("click"); } });
    // A line reworded is saved where it stands: redrawing the tab here would empty the box the
    // reader has just moved on to (the next line, the new one) and close the phone's keyboard.
    // Only a line emptied, which takes it off the sheet, redraws.
    $c.find(".vcanon-line").on("change", async function () {
        const text = String($(this).val() || "");
        if (!editCanon(String($(this).attr("data-id")), text)) return;
        if (text.trim()) await save(); else await changed();
    });
    $c.find(".vcanon-remove").on("click", async function () {
        if (removeCanon(String($(this).data("id")))) await changed();
    });
    $c.find(".vcanon-offer").on("click", async function () {
        const id = String($(this).data("id"));
        const stNow = vcrpMemoryEnabled() ? memoryState() : null;
        const fact = stNow && (stNow.ledger || []).find(f => f.id === id);
        if (!fact) return;
        if (addCanon(fact.text, fact.id)) fact.pinned = true;   // the reader's to change from here on
        await changed();
    });
}
