// ─────────────────────────────────────────────────────────────────────────────
// The Focus tab's Voices panel: each character's earliest lines (the voice anchors) and what
// the drift meter reads for them (vcrp/voice.js). The reader can write a character's lines
// themselves, hide one, leave a character out of the prompt, or say that a changed voice is
// the character's now.
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import {
    voiceSettings, voiceCharacters, driftReadings, voiceAnchorLines, addOwnLine, removeOwnLine, hideLine, showHiddenLines,
    setVoiceOff, acceptVoiceNow, resetVoiceStart, ANCHOR_SENT, METER_MIN_LINES, DRIFT_MARK,
} from "../voice.js";
import { focusPrompt } from "./index.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);
const LEVEL = { steady: { color: "#10b981", label: "steady" }, shifting: { color: "#f59e0b", label: "shifting" }, drifting: { color: "#ef4444", label: "drifting" } };

function meterHtml(r, total) {
    if (!r) return `<span class="set-desc" style="opacity:.7;">meter: ${total < METER_MIN_LINES ? `needs ${METER_MIN_LINES} named lines (${total} so far)` : "not enough lines since their voice was taken from here"}</span>`;
    const l = LEVEL[r.level] || LEVEL.steady;
    return `<span title="0 to 100: how unlike their earliest lines their latest are. ${DRIFT_MARK} and over reads as drifting." style="display:inline-flex; align-items:center; gap:6px;">
        <span style="display:inline-block; width:64px; height:6px; border-radius:3px; background:rgba(255,255,255,0.12); overflow:hidden;"><span style="display:block; height:100%; width:${Math.max(3, Math.min(100, r.score))}%; background:${l.color};"></span></span>
        <span style="font-size:0.72rem; color:${l.color};">${l.label} ${r.score}</span></span>`;
}

function characterHtml(c, r) {
    const lines = c.anchors.map((a, i) => `
        <div style="display:flex; gap:6px; align-items:flex-start; margin:3px 0;">
            <span style="flex:1; font-size:0.78rem;${i >= ANCHOR_SENT ? " opacity:.6;" : ""}">${a.own ? `<i class="fa-solid fa-pen" title="Your own line" style="color:#2dd4bf; font-size:0.65rem; margin-right:4px;"></i>` : ""}"${esc(a.text)}"${a.own ? "" : ` <span style="opacity:.55; font-size:0.68rem;">#${a.at}</span>`}</span>
            <button class="focus-voice-drop" data-key="${esc(c.key)}" data-own="${a.own ? 1 : 0}" data-text="${esc(a.text)}" title="${a.own ? "Take your line out" : "Hide this line: the next of their early lines takes its place"}" style="background:transparent; border:none; color:#ef4444; cursor:pointer; font-size:0.75rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join("");
    return `
        <details class="focus-voice-char" data-key="${esc(c.key)}" style="border-top:1px solid rgba(255,255,255,0.06); padding:6px 0;">
            <summary style="cursor:pointer; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                <b style="font-size:0.82rem;${c.off ? " opacity:.5; text-decoration:line-through;" : ""}">${esc(c.name)}</b>
                <span class="set-desc">${c.total} ${c.total === 1 ? "line" : "lines"}${c.since ? " · voice taken from later in the story" : ""}${c.off ? " · left out" : ""}</span>
                ${meterHtml(r, c.total)}
            </summary>
            ${r && r.says.length ? `<div class="set-desc" style="margin:6px 0 2px;">Since their earliest lines: ${esc(r.says.join("; "))}. Counted, not judged: an audit reads whether it is drift.</div>` : ""}
            <div style="margin-top:6px;">${lines || `<div class="set-desc">No line of theirs is long enough to be a sample yet (5 words or more).</div>`}</div>
            ${c.anchors.length > ANCHOR_SENT ? `<div class="set-desc" style="margin-top:2px;">The first ${ANCHOR_SENT} go to the model; the dimmed ones stand by.</div>` : ""}
            <div style="display:flex; gap:6px; margin-top:6px;">
                <input class="ps-modern-input focus-voice-line" data-key="${esc(c.key)}" data-name="${esc(c.name)}" placeholder="Write a line in their voice" style="flex:1; min-width:0; font-size:0.76rem;">
                <button class="ps-modern-btn secondary focus-voice-add" data-key="${esc(c.key)}" style="font-size:0.7rem;"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
                <button class="ps-modern-btn secondary focus-voice-off" data-key="${esc(c.key)}" data-name="${esc(c.name)}" data-off="${c.off ? 0 : 1}" style="font-size:0.68rem;">${c.off ? "Send their lines again" : "Leave them out of the prompt"}</button>
                ${c.since
        ? `<button class="ps-modern-btn secondary focus-voice-first" data-key="${esc(c.key)}" style="font-size:0.68rem;" title="Their voice is taken from their first lines in the chat again">Back to their first lines</button>`
        : (c.total >= METER_MIN_LINES ? `<button class="ps-modern-btn secondary focus-voice-now" data-key="${esc(c.key)}" style="font-size:0.68rem;" title="The story changed them: take their voice from their latest lines on, for their anchors and for the meter">This is their voice now</button>` : "")}
                ${c.hidden ? `<button class="ps-modern-btn secondary focus-voice-unhide" data-key="${esc(c.key)}" style="font-size:0.68rem;">Show ${c.hidden} hidden ${c.hidden === 1 ? "line" : "lines"}</button>` : ""}
            </div>
        </details>`;
}

/** What the voices send with a reply now, as the model reads it. */
function preview() {
    const lines = voiceAnchorLines();
    return lines ? esc(focusPrompt("voiceTemplate").replace("{{lines}}", () => lines)) : "Nothing right now: no character in the scene has lines far enough back (16 messages), or the anchors are off.";
}

/** The panel's HTML. */
export function voicePanelHtml() {
    const s = voiceSettings();
    let chars = [], readings = new Map();
    try { chars = voiceCharacters(); readings = new Map(driftReadings().map(r => [r.key, r])); } catch (e) { console.warn("[VCRP] Voices: the panel could not read the chat:", e); }
    const colorOn = Boolean(localProfile && Array.isArray(localProfile.addons) && localProfile.addons.includes("color"));
    const named = chars.some(c => c.total > 0);
    return `
        <div class="mtab-panel" id="focus_voice_panel">
            <div class="mtab-panel-title gold"><i class="fa-solid fa-comment-dots"></i> Voices</div>
            <div class="set-desc" style="margin-bottom:6px;">How each character spoke when the story began, in their own lines, so the model keeps hearing them. Read by VCRP from the speaker names Dialogue Colors puts on every line: no call of its own, free.</div>
            ${named ? "" : `<div class="mtab-callout" style="margin-bottom:8px;"><i class="fa-solid fa-circle-info"></i><span>${colorOn
        ? "No spoken line in this chat names its speaker yet. They are learned as replies arrive; a model that leaves the names out gives the voices nothing to read."
        : "The voices are read from the names the <b>Dialogue Colors</b> add-on puts on every spoken line (Global Toggles &amp; Add Ons). It is off, so there is nothing to read; a line you write yourself below still goes out."}</span></div>`}
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">Send voice anchors</div><div class="set-desc">For the characters in the scene (four at most), ${ANCHOR_SENT} of their earliest lines go with each reply, in the per-turn rules after the chat (never cached; about 30 tokens a line). A line is sent once it lies 16 messages back: until then the model can still see it.</div></div>
                <input type="checkbox" id="focus_voice_anchors" ${s.anchors ? "checked" : ""} />
            </div>
            <div class="mtab-setting-row" style="padding-bottom:0; border:none;">
                <div class="set-info"><div class="set-label">The drift meter decides when to audit</div><div class="set-desc">The meter counts how a character's latest 30 lines differ from their earliest (how long they run, contractions, questions and exclamations, trailing off, soft and harsh words, the words they open and close on), against how much their lines differ among themselves. While it is on and the drift audits are on (below), an audit runs when a character newly reads as drifting, and otherwise half as often as the number you set. It needs ${METER_MIN_LINES} named lines for a character.</div></div>
                <input type="checkbox" id="focus_voice_meter" ${s.meter ? "checked" : ""} />
            </div>
            <div id="focus_voice_list" style="margin-top:8px;">${chars.map(c => characterHtml(c, readings.get(c.key))).join("")}</div>
            <div class="set-label" style="margin:10px 0 4px;">A character with no lines here yet</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <input id="focus_voice_new_name" class="ps-modern-input" placeholder="Name" style="width:120px; font-size:0.76rem;">
                <input id="focus_voice_new_line" class="ps-modern-input" placeholder="A line in their voice" style="flex:1; min-width:140px; font-size:0.76rem;">
                <button id="focus_voice_new_add" class="ps-modern-btn secondary" style="font-size:0.7rem;"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
            <details style="margin-top:10px;">
                <summary class="set-desc" style="cursor:pointer;">What the next reply would get now</summary>
                <div id="focus_voice_preview" class="set-desc" style="white-space:pre-wrap; margin-top:6px; padding:8px; border-radius:6px; background:rgba(0,0,0,0.2);">${preview()}</div>
            </details>
        </div>`;
}

/** Wires the panel in `c`; `rerender` redraws the tab. */
export function wireVoicePanel(c, rerender) {
    const setting = (key, value) => {
        if (!localProfile.focus || typeof localProfile.focus !== "object") localProfile.focus = {};
        localProfile.focus.voice = { ...voiceSettings(), [key]: value };
        saveProfileToMemory();
        rerender();
    };
    // A redraw closes every <details>: the ones the reader had open are opened again.
    const open = () => c.find(".focus-voice-char[open]").map(function () { return String($(this).attr("data-key")); }).get();
    const redraw = keep => { rerender(); keep.forEach(k => c.find(".focus-voice-char").filter(function () { return String($(this).attr("data-key")) === k; }).attr("open", "")); };
    const act = fn => async function (e) {
        if (e && e.preventDefault) e.preventDefault();
        const keep = open();
        await fn($(this));
        redraw(keep);
    };
    c.find("#focus_voice_anchors").on("change", function () { setting("anchors", $(this).is(":checked")); });
    c.find("#focus_voice_meter").on("change", function () { setting("meter", $(this).is(":checked")); });
    c.find(".focus-voice-drop").on("click", act(async $b => {
        const key = String($b.attr("data-key")), text = String($b.attr("data-text"));
        if ($b.attr("data-own") === "1") await removeOwnLine(key, text); else await hideLine(key, text);
    }));
    const addFor = async key => {
        const $in = c.find(".focus-voice-line").filter(function () { return String($(this).attr("data-key")) === key; });
        const text = String($in.val() || "");
        if (text.trim()) await addOwnLine(key, text, String($in.attr("data-name") || ""));
    };
    c.find(".focus-voice-add").on("click", act(async $b => addFor(String($b.attr("data-key")))));
    c.find(".focus-voice-line").on("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); act(async $i => addFor(String($i.attr("data-key")))).call(this, e); } });
    c.find(".focus-voice-off").on("click", act(async $b => setVoiceOff(String($b.attr("data-key")), $b.attr("data-off") === "1", String($b.attr("data-name") || ""))));
    c.find(".focus-voice-now").on("click", act(async $b => {
        if (!confirm("Take this character's voice from their latest lines on?\n\nUse it when the story has changed them for good: their anchors and the drift meter then start from how they speak now, not from their first lines. You can go back.")) return;
        await acceptVoiceNow(String($b.attr("data-key")));
    }));
    c.find(".focus-voice-first").on("click", act(async $b => resetVoiceStart(String($b.attr("data-key")))));
    c.find(".focus-voice-unhide").on("click", act(async $b => showHiddenLines(String($b.attr("data-key")))));
    c.find("#focus_voice_new_add").on("click", act(async () => {
        const name = String(c.find("#focus_voice_new_name").val() || "").trim();
        const line = String(c.find("#focus_voice_new_line").val() || "").trim();
        if (!name || !line) { if (typeof toastr !== "undefined") toastr.info("Give a name and a line.", "VCRP Focus"); return; }
        await addOwnLine("", line, name);
    }));
}
