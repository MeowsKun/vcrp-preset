// Settings modal: floating button, tab shell, and the individual tabs.

import {
    getProfile, getUi, save, getChatKey, getChatName, hasOwnProfile,
    createOwnProfile, deleteOwnProfile, resetCurrentProfile, legacySettingsSize, deleteLegacySettings,
} from "./state.js";
import { detectModel, getActiveModel, shouldPrefill } from "./model.js";
import { buildAnchors } from "./inject.js";
import { BLOCKS, DEFAULT_ANIME_PROMPT, ENGINES, COTS, getEngine } from "./content.js";

const ctx = () => SillyTavern.getContext();
export const PRESET_NAME = "VCRP V9";

let folder = "";
let currentTab = 0;

// ---------------------------------------------------------------------------
// Form controls. Each one reads with get() and writes with set(value), then saves.
// ---------------------------------------------------------------------------

function changed(opts) {
    save();
    flashSaved();
    updateTokenEstimate();
    if (opts.rerender) renderTab(currentTab);
}

function field(label, desc, $control, inline = false) {
    const $f = $(`<div class="vcrp-field${inline ? " inline" : ""}"><div class="vcrp-field-text"><label></label><small></small></div></div>`);
    $f.find("label").text(label);
    if (desc) $f.find("small").text(desc); else $f.find("small").remove();
    return $f.append($control);
}

function toggle(opts) {
    const $c = $(`<label class="vcrp-switch"><input type="checkbox"><span></span></label>`);
    $c.find("input").prop("checked", !!opts.get()).on("change", function () { opts.set(this.checked); changed(opts); });
    return field(opts.label, opts.desc, $c, true);
}

function select(opts) {
    const $c = $(`<select class="vcrp-input"></select>`);
    opts.options.forEach(([value, label]) => $c.append($("<option>").val(value).text(label)));
    $c.val(opts.get()).on("change", function () { opts.set(this.value); changed(opts); });
    return field(opts.label, opts.desc, $c);
}

function input(opts) {
    const $c = $(`<input class="vcrp-input">`).attr({ type: opts.type || "text", placeholder: opts.placeholder || "" });
    if (opts.type === "number") $c.attr({ min: opts.min ?? 0 });
    // Numbers are saved once the field is left, so half-typed values ("1" on the way to "15") are never clamped and stored.
    const event = opts.type === "number" ? "change" : "input";
    $c.val(opts.get()).on(event, function () { opts.set(this.value); changed(opts); });
    return field(opts.label, opts.desc, $c);
}

function textarea(opts) {
    const $c = $(`<textarea class="vcrp-input vcrp-textarea"></textarea>`).attr({ rows: opts.rows || 8, placeholder: opts.placeholder || "" });
    $c.val(opts.get()).on("input", function () { opts.set(this.value); changed(opts); });
    return field(opts.label, opts.desc, $c);
}

function section(title, desc) {
    const $s = $(`<section class="vcrp-section"><h3></h3><p class="vcrp-desc"></p></section>`);
    $s.find("h3").text(title);
    if (desc) $s.find("p").text(desc); else $s.find("p").remove();
    return $s;
}

function note(text, kind = "info") {
    return $(`<div class="vcrp-note ${kind}"></div>`).text(text);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function renderEngineTab($c) {
    const p = getProfile();
    const engine = getEngine(p.engine);

    const $e = section("Engine", "The core ruleset the story runs on. Each engine is its own slot in the preset; VCRP sends only the one you pick.");
    $e.append(select({
        label: "Engine", desc: engine.description,
        options: ENGINES.map(e => [e.id, e.label]),
        get: () => p.engine, set: v => { p.engine = v; }, rerender: true,
    }));
    $e.append(toggle({
        label: "Bold NPCs",
        desc: "Extra push for NPC agency: they chase their own goals, never hover or act halfway. Can clash with the V10 engines' subtler rules and with Strict dialogue, so it is off by default.",
        get: () => p.boldNpcs, set: v => { p.boldNpcs = v; },
    }));
    $e.append(toggle({
        label: "Strict dialogue",
        desc: "Swaps the engine's dialogue guidance for V10's explicit rulebook (idiolects, orthographic emotion cues, banned speech patterns). For models that treat the normal rules as suggestions.",
        get: () => p.strictDialogue, set: v => { p.strictDialogue = v; },
    }));
    $c.append($e);

    const det = detectModel();
    const { source, model } = getActiveModel();
    const $t = section("Thinking", "Every reply opens with a visible <think> block, shown collapsed in chat and removed from past replies before sending.");
    $t.append(select({
        label: "Chain of thought",
        desc: "Auto uses the CoT written for the selected engine.",
        options: [["auto", `Auto (${COTS.find(x => x.id === engine.cot).label})`], ...COTS.map(x => [x.id, x.label])],
        get: () => p.cot, set: v => { p.cot = v; },
    }));
    $t.append(toggle({
        label: "Thinking Cap",
        desc: "Hard ~150-word ceiling on thinking, one pass only. For models that overthink.",
        get: () => p.thinkingCap, set: v => { p.thinkingCap = v; },
    }));
    $t.append(select({
        label: "CoT prefill",
        desc: "The preset's 'CoT Prefill' message starts the reply inside <think>. Newer Claude and Gemini Flash models reject prefills, so Auto leaves it out for them.",
        options: [["auto", "Auto (recommended)"], ["on", "Always on"], ["off", "Always off"]],
        get: () => p.prefillMode, set: v => { p.prefillMode = v; }, rerender: true,
    }));
    $t.append(note(`Detected: ${source || "no chat completion API"}${model ? ` · ${model}` : ""}. Auto mode: ${det.prefill ? "prefill on" : "prefill off"} (${det.reason}). Currently: ${shouldPrefill(p) ? "prefilling" : "instruction only"}.`));
    $c.append($t);
}

function renderGlobalTab($c) {
    const p = getProfile();
    const $s = section("Global settings", "Language, length, and how the story treats you.");
    $s.append(input({
        label: "Output language", desc: "Leave empty for English. Thinking stays in whatever language the model prefers.",
        placeholder: "e.g. Spanish", get: () => p.language, set: v => { p.language = v; },
    }));
    $s.append(select({
        label: "Your character's gender", desc: "Stops the model from guessing how to address you.",
        options: [["off", "Don't specify"], ["male", "Male"], ["female", "Female"]],
        get: () => p.pronouns, set: v => { p.pronouns = v; },
    }));
    const $len = $(`<div class="vcrp-row"></div>`);
    $len.append(select({
        label: "Length limit", options: [["max", "At most"], ["min", "At least"]],
        get: () => p.lengthType, set: v => { p.lengthType = v; },
    }));
    $len.append(input({
        label: "Words", type: "number", placeholder: "no limit",
        get: () => p.lengthWords, set: v => { p.lengthWords = v; },
    }));
    $s.append($len);
    $s.append(toggle({
        label: "Dialogue colors", desc: "Each character's lines get their own locked hex color.",
        get: () => p.dialogueColors, set: v => { p.dialogueColors = v; },
    }));
    $s.append(toggle({
        label: "Explicit vocabulary", desc: "Blunt names for body parts and acts in sex scenes, no coy euphemisms.",
        get: () => p.directLanguage, set: v => { p.directLanguage = v; },
    }));
    $s.append(toggle({
        label: "User consent block", desc: "Adds V10's out-of-character consent statement: everything is permitted, no softening outcomes for the PC.",
        get: () => p.consent, set: v => { p.consent = v; },
    }));
    $c.append($s);

    const legacy = legacySettingsSize();
    if (legacy) {
        const $m = section("Old VCRP data", "Settings from the V8 extension are still stored in SillyTavern. V9 never reads them.");
        const $btn = $(`<button class="vcrp-btn danger"><i class="fa-solid fa-trash"></i> Delete old V8 data</button>`).on("click", () => {
            if (!confirm("Delete all settings saved by the old V8 extension (profiles, memory vaults, NPC banks)? This cannot be undone.")) return;
            deleteLegacySettings();
            renderTab(currentTab);
        });
        $m.append(note(`About ${Math.max(1, Math.round(legacy / 1024))} KB of old data.`), $btn);
        $c.append($m);
    }
}

function renderBlocksTab($c) {
    const p = getProfile();
    const $s = section("Response blocks", "Optional panels added to every reply. Each costs output tokens. Old copies are removed from context automatically.");
    BLOCKS.forEach(b => {
        $s.append(toggle({
            label: b.label, desc: b.description,
            get: () => p.blocks[b.id], set: v => { p.blocks[b.id] = v; }, rerender: b.id === "summary",
        }));
    });
    if (p.blocks.summary) {
        $s.append(input({
            label: "Condense after (replies)", type: "number", min: 5,
            desc: "Replies older than this are sent to the model as their summary only.",
            get: () => p.condenseDepth, set: v => { p.condenseDepth = Math.max(5, parseInt(v) || 40); },
        }));
    }
    $c.append($s);
}

function renderStyleTab($c) {
    const p = getProfile();
    const engine = getEngine(p.engine);
    const $s = section("Narration voice", `How the narrator sounds. Leave empty to use ${engine.label}'s own voice (shown greyed out below).`);
    $s.append(textarea({ label: "Voice", placeholder: engine.voice, rows: 7, get: () => p.style.text, set: v => { p.style.text = v; } }));
    $s.append(loadDefaultButton(() => { p.style.text = engine.voice; }));
    $c.append($s);

    const $a = section("Anime mode", "Rewrites dialogue, reactions, framing, and pacing as anime/manga. Overrides the grounded narration defaults while on.");
    $a.append(toggle({ label: "Anime mode", get: () => p.anime.enabled, set: v => { p.anime.enabled = v; }, rerender: true }));
    if (p.anime.enabled) {
        $a.append(textarea({ label: "Anime rules", placeholder: DEFAULT_ANIME_PROMPT, rows: 10, get: () => p.anime.text, set: v => { p.anime.text = v; } }));
        $a.append(loadDefaultButton(() => { p.anime.text = DEFAULT_ANIME_PROMPT; }));
    }
    $c.append($a);
}

function loadDefaultButton(apply) {
    return $(`<button class="vcrp-btn subtle"><i class="fa-solid fa-file-import"></i> Load default text to edit</button>`)
        .on("click", () => { apply(); changed({ rerender: true }); });
}

const TABS = [
    { title: "Engine & Thinking", icon: "fa-brain", render: renderEngineTab },
    { title: "Global", icon: "fa-earth-americas", render: renderGlobalTab },
    { title: "Response Blocks", icon: "fa-table-list", render: renderBlocksTab },
    { title: "Writing Style", icon: "fa-pen-nib", render: renderStyleTab },
];

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

function renderTab(index) {
    currentTab = index;
    const $content = $("#vcrp-content");
    const scroll = $content.scrollTop();
    $content.empty();
    TABS[index].render($content);
    $content.scrollTop(scroll);
    $(".vcrp-tab").removeClass("active").eq(index).addClass("active");
}

function renderHeader() {
    const c = ctx();
    const key = getChatKey();
    const own = hasOwnProfile();
    const name = getChatName();

    const pick = Math.floor(Math.random() * 4); // default.png, default1.png … default3.png
    let img = `${folder}/img/default${pick || ""}.png`;
    if (c.groupId !== undefined && c.groupId !== null) img = `${folder}/img/group.png`;
    else if (key) img = `/characters/${encodeURIComponent(key)}`;
    $("#vcrp-banner").css("background-image", `url("${img}")`);

    $("#vcrp-chat-name").text(name || "No chat open");
    const $badge = $("#vcrp-profile-badge").removeClass("own global");
    const $btn = $("#vcrp-profile-btn");
    if (!key) {
        $badge.addClass("global").text("Editing the global default");
        $btn.hide();
    } else if (own) {
        $badge.addClass("own").text(`Own profile for ${name}`);
        $btn.show().html(`<i class="fa-solid fa-link"></i> Use global default`);
    } else {
        $badge.addClass("global").text("Using the global default");
        $btn.show().html(`<i class="fa-solid fa-user-pen"></i> Give ${$("<i>").text(name).html()} own settings`);
    }

    const presetName = c.chatCompletionSettings?.preset_settings_openai;
    $("#vcrp-preset-warning").toggle(!!presetName && presetName !== PRESET_NAME)
        .text(`Active preset is "${presetName}". Select "${PRESET_NAME}" for VCRP to work.`);
}

function flashSaved() {
    const $s = $("#vcrp-saved").stop(true).fadeIn(100);
    clearTimeout(flashSaved.t);
    flashSaved.t = setTimeout(() => $s.fadeOut(300), 1200);
}

async function updateTokenEstimate() {
    const $t = $("#vcrp-tokens");
    if (!$t.length) return;
    const text = Object.values(buildAnchors()).join("\n");
    try {
        const n = await ctx().getTokenCountAsync(text);
        $t.text(`VCRP additions: ~${n} tokens`);
    } catch {
        $t.text(`VCRP additions: ~${Math.round(text.length / 4)} tokens`);
    }
    $t.attr("title", "Text VCRP adds to the preset from your settings. The engine and rules in the preset itself are not counted.");
}

function buildModal() {
    const $o = $(`
<div id="vcrp-overlay">
  <div class="vcrp-modal" role="dialog" aria-label="VCRP settings">
    <header id="vcrp-banner" class="vcrp-header">
      <div class="vcrp-header-inner">
        <div class="vcrp-title">
          <span class="vcrp-logo">VCRP</span>
          <span id="vcrp-chat-name"></span>
          <span id="vcrp-profile-badge"></span>
        </div>
        <div class="vcrp-actions">
          <button id="vcrp-profile-btn" class="vcrp-btn"></button>
          <button id="vcrp-reset-btn" class="vcrp-btn danger" title="Reset this profile to defaults"><i class="fa-solid fa-rotate-left"></i></button>
          <button id="vcrp-close-btn" class="vcrp-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div id="vcrp-preset-warning" class="vcrp-note warn"></div>
    </header>
    <div class="vcrp-body">
      <nav class="vcrp-nav"></nav>
      <main id="vcrp-content"></main>
    </div>
    <footer class="vcrp-footer">
      <label class="vcrp-switch small"><input type="checkbox" id="vcrp-preview-toggle"><span></span></label>
      <span>Preview prompt before sending</span>
      <span class="vcrp-spacer"></span>
      <span id="vcrp-saved"><i class="fa-solid fa-check"></i> Saved</span>
      <span id="vcrp-tokens"></span>
    </footer>
  </div>
</div>`);

    TABS.forEach((t, i) => {
        $(`<button class="vcrp-tab"><i class="fa-solid ${t.icon}"></i><span></span></button>`)
            .find("span").text(t.title).end()
            .on("click", () => renderTab(i))
            .appendTo($o.find(".vcrp-nav"));
    });

    $o.on("click", e => { if (e.target === $o[0]) closeModal(); });
    $o.find("#vcrp-close-btn").on("click", closeModal);
    $o.find("#vcrp-profile-btn").on("click", () => {
        if (hasOwnProfile()) {
            if (!confirm(`Delete ${getChatName()}'s own settings and go back to the global default?`)) return;
            deleteOwnProfile();
        } else {
            createOwnProfile();
        }
        refresh();
    });
    $o.find("#vcrp-reset-btn").on("click", () => {
        const which = hasOwnProfile() ? `${getChatName()}'s settings` : "the global default";
        if (!confirm(`Reset ${which} to factory defaults?`)) return;
        resetCurrentProfile();
        refresh();
    });
    $o.find("#vcrp-preview-toggle").on("change", function () { getUi().previewPrompt = this.checked; save(); });
    $(document).on("keydown.vcrp", e => { if (e.key === "Escape" && $("#vcrp-overlay").is(":visible")) closeModal(); });
    $("body").append($o);
}

function refresh() {
    renderHeader();
    renderTab(currentTab);
    updateTokenEstimate();
}

export function openModal() {
    if (!$("#vcrp-overlay").length) buildModal();
    $("#vcrp-preview-toggle").prop("checked", !!getUi().previewPrompt);
    refresh();
    $("#vcrp-overlay").css("display", "flex").hide().fadeIn(150);
}

export function closeModal() {
    $("#vcrp-overlay").fadeOut(150);
}

/** Called when the chat changes, so an open modal follows the new character. */
export function onChatChanged() {
    if ($("#vcrp-overlay").is(":visible")) refresh();
}

// ---------------------------------------------------------------------------
// Entry points: draggable floating button + Extensions menu item
// ---------------------------------------------------------------------------

export function mountUi(extensionFolder) {
    folder = extensionFolder;
    const $btn = $(`<div id="vcrp-fab" title="VCRP settings"><i class="fa-solid fa-wand-magic-sparkles"></i></div>`).appendTo("body");
    makeDraggable($btn, openModal);

    const $menuItem = $(`<div id="vcrp-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><i class="fa-solid fa-wand-magic-sparkles"></i><span>VCRP</span></div>`);
    $menuItem.on("click", openModal);
    $("#extensionsMenu").append($menuItem);
}

function makeDraggable($btn, onClick) {
    const KEY = "vcrp_fab_position";
    const place = pos => {
        const gutter = window.innerWidth <= 768 ? 12 : 20;
        $btn.css({ left: "", right: "", top: "" });
        const top = pos ? Math.max(10, Math.min(window.innerHeight - 60, pos.top * window.innerHeight)) : 60;
        $btn.css("top", `${top}px`).css(pos?.side === "left" ? "left" : "right", `${gutter}px`);
    };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }
    place(saved);
    $(window).on("resize.vcrp", () => place(saved));

    let start = null, moved = false;
    const point = e => (e.touches ? e.touches[0] : e);
    $btn.on("mousedown touchstart", e => {
        if (e.type === "mousedown" && e.button !== 0) return;
        // Stops the browser's synthetic mouse/click events after a tap, which would
        // otherwise land on the freshly opened overlay and close it again.
        if (e.type === "touchstart" && e.cancelable) e.preventDefault();
        const pt = point(e.originalEvent);
        const r = $btn[0].getBoundingClientRect();
        start = { x: pt.clientX, y: pt.clientY, left: r.left, top: r.top };
        moved = false;
        $btn.addClass("dragging");
    });
    $(document).on("mousemove.vcrp touchmove.vcrp", e => {
        if (!start) return;
        const pt = point(e.originalEvent);
        const dx = pt.clientX - start.x, dy = pt.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        // No preventDefault here: document-level touchmove listeners are passive, and
        // `touch-action: none` on the button already stops the page from scrolling.
        $btn.css({ right: "auto", left: `${start.left + dx}px`, top: `${Math.max(10, Math.min(window.innerHeight - 60, start.top + dy))}px` });
    });
    $(document).on("mouseup.vcrp touchend.vcrp", () => {
        if (!start) return;
        start = null;
        $btn.removeClass("dragging");
        if (!moved) { onClick(); return; }
        const r = $btn[0].getBoundingClientRect();
        saved = { side: r.left + r.width / 2 < window.innerWidth / 2 ? "left" : "right", top: r.top / window.innerHeight };
        try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignore */ }
        place(saved);
    });
}
