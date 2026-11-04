// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Notebook tab, as Megumin Suite V11 has it, on VCRP's chat-derived notebook. The
// switch (always on for an engine that keeps one, V11), where the story stands, how many
// truths it keeps, whether World State keeps Secrets and Seeds too, and the notebook itself:
//
//   Active — the live truths, each hidden until shown (it spoils the story); an open truth can
//            be edited (saved as soon as you leave a box), marked revealed or deleted, and a
//            clue removed. "Add a truth" adds an empty one to write yourself, open at once;
//            it is not given to the story until the Truth box is filled in.
//   Past   — the truths that came out, as a timeline: when each was written, every clue with
//            its message, how and when it came out; each can be made live again, or deleted.
//
// Every change here is the reader's own, kept with the chat (notebook/index.js) and applied
// after the message that was newest when it was made.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, Popup, POPUP_TYPE } from "../../st.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { splitNames, isFilled, filledLiveTruths, peekNextId } from "./model.js";
import {
    notebookOn, notebookForced, setNotebookOn, notebookFromChat, liveTruths, pastTruths, MAX_LIVE_CAP, truthCountWords,
    notebookLiveCap, setNotebookLiveCap, keepWorldSecrets, setKeepWorldSecrets,
    editTruth, forgetTruth, revealTruth, restoreTruth, addTruth, turnLabel,
} from "./index.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);

// Truths the reader chose to open, by chat and id, so a redraw keeps them open; another
// chat's stay hidden until asked for.
const opened = new Set();
const chatKey = () => { try { return String((getContext() || {}).chatId || ""); } catch (e) { return ""; } };
const keyOf = id => `${chatKey()}|${id}`;

const HOW = {
    out: "came out to everyone it was hidden from",
    learned: "the last person it was hidden from found out",
    user: "you marked it revealed",
};

const FIELDS = [
    { key: "truth", label: "Truth", rows: 3 },
    { key: "hiddenFrom", label: "Hidden from", rows: 0, hint: "names, separated by commas; add \"the reader\" if the page hasn't shown it" },
    { key: "when", label: "Comes out when", rows: 2 },
    { key: "changes", label: "What it changes", rows: 2 },
    { key: "clueIdeas", label: "Clue ideas", rows: 2 },
];

// "written in #15", or "added by you" for a truth made in the tab.
const whereWritten = t => (t.createdBy === "user" ? "added by you" : `written in ${turnLabel(t.createdSeq)}`);

function clueList(t, { removable = false } = {}) {
    const clues = t.clues || [];
    if (!clues.length) return `<div class="set-desc">No clues planted yet.</div>`;
    return `<ul class="vcrp-nbt-clues">${clues.map((c, i) => `
        <li>
            <span class="vcrp-nbt-turn">${esc(turnLabel(c.seq))}</span>
            <span>🔎 ${esc(c.text)}${c.found === false ? ` <span style="color:#f59e0b;" title="The clue's words were not found in the story of its reply">(not found in the reply)</span>` : ""}</span>
            ${removable ? `<button type="button" class="ws-btn-small nb_clue_del" data-id="${esc(t.id)}" data-i="${i}" title="Remove this clue"><i class="fa-solid fa-xmark"></i></button>` : ""}
        </li>`).join("")}</ul>`;
}

function liveCard(t, isOpen) {
    const value = f => (f.key === "hiddenFrom" ? (t.hiddenFrom || []).join(", ") : (t[f.key] || ""));
    const field = f => `
        <div class="set-label" style="margin:6px 0 2px; font-size:0.72rem;">${f.label}</div>
        ${f.rows
            ? `<textarea class="ps-modern-input nb_field" data-id="${esc(t.id)}" data-key="${f.key}" rows="${f.rows}" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.75rem;">${esc(value(f))}</textarea>`
            : `<input type="text" class="ps-modern-input nb_field" data-id="${esc(t.id)}" data-key="${f.key}" value="${esc(value(f))}" placeholder="${esc(f.hint || "")}" style="width:100%; background:rgba(0,0,0,0.2); font-size:0.75rem;" />`}`;
    const clues = (t.clues || []).length;
    return `
        <div class="vcrp-nbt-truth" data-id="${esc(t.id)}">
            <div class="vcrp-nbt-head">
                <b>${esc(t.id)}</b>
                ${isFilled(t) ? "" : `<span class="vcrp-nbt-draft" title="Not given to the story until the Truth box is filled in">new, write it below</span>`}
                <span class="vcrp-nbt-when">${esc(whereWritten(t))}</span>
                <span class="vcrp-nbt-when">${clues} clue${clues === 1 ? "" : "s"}</span>
                ${isOpen ? `
                <span class="vcrp-nbt-actions">
                    <button type="button" class="ps-modern-btn secondary nb_hide" data-id="${esc(t.id)}" style="font-size:0.68rem;"><i class="fa-solid fa-eye-slash"></i> Hide</button>
                    <button type="button" class="ps-modern-btn secondary nb_reveal" data-id="${esc(t.id)}" style="font-size:0.68rem;" title="The truth is out: it leaves the story's notebook and joins Past"><i class="fa-solid fa-flag-checkered"></i> Mark revealed</button>
                    <button type="button" class="ps-modern-btn secondary nb_forget" data-id="${esc(t.id)}" style="font-size:0.68rem; color:#ef4444;" title="Delete this truth. The next new truth takes its number."><i class="fa-solid fa-trash"></i> Delete</button>
                </span>` : ""}
            </div>
            <div class="vcrp-nbt-body${isOpen ? "" : " is-hidden"}" data-id="${esc(t.id)}">
                <div class="vcrp-nbt-fields">
                    ${FIELDS.map(field).join("")}
                    <div class="set-label" style="margin:8px 0 2px; font-size:0.72rem;">Clues planted</div>
                    ${clueList(t, { removable: true })}
                    <div class="set-desc" style="margin-top:6px;">Changes save as soon as you leave a box.</div>
                </div>
                ${isOpen ? "" : `<button type="button" class="ps-modern-btn secondary nb_show vcrp-nbt-show" data-id="${esc(t.id)}" style="font-size:0.7rem;"><i class="fa-solid fa-eye"></i> Show this truth</button>`}
            </div>
        </div>`;
}

function pastItem(t) {
    return `
        <div class="vcrp-nbt-past" data-id="${esc(t.id)}">
            <div class="vcrp-nbt-head">
                <b>${esc(t.id)}</b>
                <span class="vcrp-nbt-when">${esc(whereWritten(t))}</span>
                <span class="vcrp-nbt-when">came out in ${esc(turnLabel(t.revealedSeq))}</span>
                <span class="vcrp-nbt-actions">
                    <button type="button" class="ps-modern-btn secondary nb_restore" data-id="${esc(t.id)}" style="font-size:0.68rem;" title="Put it back in the story as a live truth"><i class="fa-solid fa-rotate-left"></i> Activate again</button>
                    <button type="button" class="ps-modern-btn secondary nb_forget" data-id="${esc(t.id)}" style="font-size:0.68rem; color:#ef4444;" title="Delete this truth"><i class="fa-solid fa-trash"></i> Delete</button>
                </span>
            </div>
            <div style="font-size:0.78rem; margin-top:4px;">${esc(t.truth)}</div>
            ${(t.hiddenFrom || []).length ? `<div class="set-desc"><i>Was still hidden from:</i> ${esc(t.hiddenFrom.join(", "))}</div>` : ""}
            <div class="vcrp-nbt-how">${esc(HOW[t.revealedHow] || "came out")}</div>
            ${clueList(t)}
        </div>`;
}

// The box the tab scrolls in, so a redraw after an edit keeps the place.
function scrollParent(el) {
    try {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
            const o = getComputedStyle(n).overflowY;
            if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
        }
    } catch (e) { /* no layout to keep */ }
    return null;
}

const row = (id, label, desc, control) => `
    <div class="mtab-setting-row" style="border:none;">
        <div class="set-info"><div class="set-label">${label}</div><div class="set-desc">${desc}</div></div>
        ${control}
    </div>`;

export function renderNotebookTab(c) {
    const scrollBox = c[0] ? scrollParent(c[0]) : null;
    const keepScroll = scrollBox ? scrollBox.scrollTop : 0;
    c.empty();
    const on = notebookOn();
    const forced = notebookForced();
    const { state } = notebookFromChat();
    const live = liveTruths(state).sort((a, b) => a.createdSeq - b.createdSeq);
    const filled = filledLiveTruths(state).length;
    const past = pastTruths(state).sort((a, b) => (a.revealedSeq - b.revealedSeq) || (a.createdSeq - b.createdSeq));
    const cap = notebookLiveCap();
    const status = !on ? "Off: nothing is sent, and what this chat kept stays as it is."
        : !filled ? `The next reply writes the notebook: ${truthCountWords(cap).replace("truth", "hidden truth")}, built from the card, the setting and the story so far.`
            : `${filled} of ${cap} truths ${filled === 1 ? "is" : "are"} live in this chat${past.length ? `, ${past.length} came out` : ""}. Each turn the model reads them after the chat (never cached) and notes a clue, who found out, or what came out.`;

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #0ea5e9, #0369a1);"><i class="fa-solid fa-book"></i></div>
                <div>
                    <h2>The Notebook</h2>
                    <p>Megumin Suite V11's Author's Notebook: the story decides a few hidden truths, keeps them from turn to turn, plants small clues and reveals each one when the story earns it, instead of forgetting a secret or blurting it out. It is read from this chat's replies, so swipes, edits and deletes undo exactly what a reply did; your own changes here are kept with the chat.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="color:${on ? "#0ea5e9" : "var(--text-muted)"};"><i class="fa-solid fa-${on ? "circle-check" : "circle-xmark"}" style="font-size:0.6rem;"></i> ${on ? "On" : "Off"}</div>
        </div>
        <div class="mtab-panel" id="nb_settings">
            ${row("nb_on", "Keep an Author's Notebook", `The fixed rules sit in the cached part of the prompt; the live truths ride after the chat.${forced ? " <b>Always on with V11 Тайна</b>, whose own text speaks of its notebook." : ""}`,
                `<input type="checkbox" id="nb_on" ${on ? "checked" : ""} ${forced ? "disabled" : ""} />`)}
            <div id="nb_status" class="set-desc" style="margin:0 0 8px;"><i class="fa-solid fa-circle-info"></i> ${status}</div>
            ${row("nb_cap", "Truths kept at once", `How many hidden truths the story keeps live, 1 to ${MAX_LIVE_CAP} (V11's default is three). The setup asks for that many, and a new one past it is left out; more truths cost a little more each turn. Lowering it keeps the truths already in play. A truth you delete gives its number to the next new one.`,
                `<input type="number" id="nb_cap" class="ps-modern-input" min="1" max="${MAX_LIVE_CAP}" step="1" style="width:64px;" value="${cap}" ${on ? "" : "disabled"} />`)}
            ${row("nb_keep_secrets", "Keep Secrets and Seeds in World State too", "Off (as in V11): while the notebook is on, World State stops asking for each character's Secret and for planted Seeds, because the notebook keeps the hidden things. On: World State keeps them as well.",
                `<input type="checkbox" id="nb_keep_secrets" ${keepWorldSecrets() ? "checked" : ""} ${on ? "" : "disabled"} />`)}
        </div>
        <div class="mtab-panel" id="nb_active">
            <div class="mtab-panel-title gold" style="display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-mask"></i> Active <span class="set-desc" style="font-weight:400;">${filled} of ${cap} live</span>
                <button type="button" class="ps-modern-btn secondary" id="nb_add" style="font-size:0.7rem; margin-left:auto;" title="Add an empty truth to fill in yourself"><i class="fa-solid fa-plus"></i> Add a truth</button>
            </div>
            ${!on && live.length ? `<div class="set-desc">The notebook is off, so these are kept but not handed to the story.</div>` : ""}
            ${live.length
                ? `<div class="set-desc" style="margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> These are the truths the story is still hiding. Opening one spoils what the story is building toward.</div>${live.map(t => liveCard(t, opened.has(keyOf(t.id)))).join("")}`
                : `<div class="set-desc">No truth is live. ${on ? "The next reply writes new ones, or add one yourself." : "Switch the notebook on, or add one yourself."}</div>`}
        </div>
        ${past.length ? `
        <div class="mtab-panel" id="nb_past">
            <div class="mtab-panel-title"><i class="fa-solid fa-timeline"></i> Past <span class="set-desc" style="font-weight:400;">${past.length} ${past.length === 1 ? "truth" : "truths"} that came out</span></div>
            <div class="vcrp-nbt-timeline">${past.map(pastItem).join("")}</div>
        </div>` : ""}
    `);

    const redraw = () => renderNotebookTab(c);
    const toast = (kind, msg) => { if (typeof toastr !== "undefined" && toastr[kind]) toastr[kind](msg, "Author's Notebook"); };
    const truthOf = el => state.truths[String($(el).attr("data-id"))];

    c.find("#nb_on").on("change", function () { setNotebookOn($(this).is(":checked")); saveProfileToMemory(); redraw(); });
    c.find("#nb_cap").on("change", function () { setNotebookLiveCap($(this).val()); saveProfileToMemory(); redraw(); });
    c.find("#nb_keep_secrets").on("change", function () { setKeepWorldSecrets($(this).is(":checked")); saveProfileToMemory(); });

    // Opens straight away: the reader is writing it, there is nothing to spoil.
    c.find("#nb_add").on("click", () => { opened.add(keyOf(peekNextId(state))); addTruth(); redraw(); });

    c.find(".nb_show").on("click", async function () {
        const id = String($(this).attr("data-id"));
        const ok = await new Popup("<h3>Show this truth?</h3><p>This shows what the story is hiding. Reading it spoils what the story is building toward.</p>", POPUP_TYPE.CONFIRM, "", { okButton: "Show it", cancelButton: "Keep it hidden" }).show();
        if (!ok) return;
        opened.add(keyOf(id));
        redraw();
    });
    c.find(".nb_hide").on("click", function () { opened.delete(keyOf(String($(this).attr("data-id")))); redraw(); });

    // Saved as soon as the reader leaves a box.
    c.find(".nb_field").on("change", function () {
        const t = truthOf(this);
        if (!t) return;
        const key = String($(this).attr("data-key"));
        const raw = String($(this).val() || "").trim();
        const fields = {};
        if (key === "hiddenFrom") {
            const names = splitNames(raw);
            if (names.join("|") !== (t.hiddenFrom || []).join("|")) fields.hiddenFrom = names;
        } else if (raw !== (t[key] || "")) {
            fields[key] = raw;
        }
        if (fields.truth === "" && isFilled(t)) {
            toast("warning", "A truth can't be empty. Delete it instead.");
            $(this).val(t.truth);
            return;
        }
        if (!Object.keys(fields).length) return;
        editTruth(t.id, fields);
        if (fields.hiddenFrom && !fields.hiddenFrom.length) toast("info", `${t.id} is hidden from no one now, so it came out.`);
        else if (fields.truth && !isFilled(t)) toast("success", `${t.id} written. The next reply reads it.`);
        redraw();
    }).on("keydown", function (e) { if (e.key === "Enter" && this.tagName === "INPUT") this.blur(); });

    c.find(".nb_clue_del").on("click", function () {
        const t = truthOf(this);
        if (!t) return;
        const i = Number($(this).attr("data-i"));
        editTruth(t.id, { clues: (t.clues || []).filter((_, j) => j !== i) });
        redraw();
    });

    c.find(".nb_reveal").on("click", function () { const t = truthOf(this); if (t) { revealTruth(t.id); redraw(); } });

    c.find(".nb_restore").on("click", function () {
        const t = truthOf(this);
        if (!t) return;
        if (filled >= cap) { toast("warning", `${cap} truths are already live. Mark one revealed or delete one first, or raise the number above.`); return; }
        restoreTruth(t.id);
        redraw();
    });

    // Delete asks first.
    c.find(".nb_forget").on("click", async function () {
        const t = truthOf(this);
        if (!t) return;
        const ok = await new Popup(`<h3>Delete ${esc(t.id)} for good?</h3><p>It leaves the notebook and the story stops keeping it. To take it out of the story but keep it, use Mark revealed instead.</p>`, POPUP_TYPE.CONFIRM, "", { okButton: "Delete", cancelButton: "Keep" }).show();
        if (!ok) return;
        opened.delete(keyOf(t.id));
        forgetTruth(t.id);
        redraw();
    });

    if (scrollBox) scrollBox.scrollTop = keepScroll;
}
