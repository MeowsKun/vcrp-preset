// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Knowledgebase.
//
// User-defined rule / lore entries. An entry with no trigger keywords is always sent;
// one with keywords is sent only when one of them appears, as a whole word, in the
// last few messages (lorebook-style, to save tokens).
//
// Where they go:
//   - always-on entries:  [[knowledgebase_always]], in Main 2 before the chat. They change
//     only when edited, so they sit in the cached part and are read at a tenth of the
//     price. A preset from before that slot existed gets them in the per-turn block.
//   - keyed entries:      [[knowledgebase]], in Output RULES after the chat, where coming
//     and going every turn leaves the cache alone.
//
// Two stores:
//   - this character's entries: on the profile as `knowledgebase` (the key VCRP V8
//     used, so V8 entries come back as they were);
//   - shared entries: in the extension settings as `sharedKnowledgebase`, sent for
//     EVERY character whose Knowledgebase is switched on.
// Entries can be moved between the two, and both can be exported/imported as one file.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced, getContext } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { saveProfileToMemory } from "../core/profile.js";
import { meguminCleanChatHistoryText } from "../engine/chatText.js";
import { downloadJsonFile } from "../utils/download.js";
import { escapeRegex } from "../utils/regex.js";
import { vcrpWithoutSwipedReply } from "./generation.js";

const EXPORT_FORMAT = "vcrp-knowledgebase";
export const ALWAYS_SLOT = "[[knowledgebase_always]]";
const DEFAULT_SCAN_DEPTH = 6;          // recent messages searched for keywords
const BIG_ALWAYS_TOKENS = 2000;        // always-on entries past this get a warning
export const kbTokens = text => Math.ceil(String(text || "").length / 3.5);   // the same estimate Story Memory uses

// The hypnosis example fires on its subject only. "conditioning" and "entrance" are left
// out on purpose: air conditioning and a front entrance are not hypnosis.
const HYPNOSIS_TRIGGERS = "hypno*, trance, trances, mesmeri*";

// The hypnosis entry's text, shared by the seed and the upgrade below.
const HYPNOSIS_CONTENT = "Use this framework whenever hypnosis, trance, or conditioning appears in the story.\n\n- Induction: Trance is reached gradually through focus (a fixed point, a voice, repetition, rhythm), not instantly. Resistance, distraction, or disbelief slows or breaks it.\n- Depth: Track a rough depth, from light (relaxed, suggestible but aware), to medium (compliant, fuzzy, fewer inhibitions), to deep (highly pliable, narrowed awareness). Deeper states take longer to reach and to leave.\n- Suggestibility: Subjects accept suggestions that don't violate their core values easily; suggestions that do are resisted, cause distress, or fail. Repetition and depth increase what holds.\n- Triggers: Post-hypnotic triggers (a word, gesture, sound) can be installed and later fire, but only ones that were actually established earlier in the story.\n- Aftereffects: Coming out is groggy and disoriented. Memory of trance may be hazy or absent depending on what was suggested. Effects fade over time unless reinforced.\n\nKeep it internally consistent: never have hypnosis do something it hasn't been set up to do.";

// Earlier built-in text. A saved entry still word-for-word equal to one of these
// was never edited, so it follows the current default; an edited one is left alone.
const LEGACY_KB = {
    writing: "Always show through concrete action, sensation, and behavior rather than naming emotions outright. Avoid abstract summary (\"she felt nervous\") in favor of physical evidence (\"her thumb worried the hem of her sleeve\"). Keep prose grounded and specific: real textures, weights, temperatures, sounds. No purple prose, no recycled clichés, no melodrama. Every paragraph should advance the scene, reveal character, or deepen sensation, never tread water.",
    hypnosis: "Use this framework whenever hypnosis, trance, or conditioning appears in the story. Adjust or delete if your setting works differently.\n\n- Induction: Trance is reached gradually through focus (a fixed point, a voice, repetition, rhythm), not instantly. Resistance, distraction, or disbelief slows or breaks it.\n- Depth: Track a rough depth, from light (relaxed, suggestible but aware), to medium (compliant, fuzzy, fewer inhibitions), to deep (highly pliable, narrowed awareness). Deeper states take longer to reach and to leave.\n- Suggestibility: Subjects accept suggestions that don't violate their core values easily; suggestions that do are resisted, cause distress, or fail. Repetition and depth increase what holds.\n- Triggers: Post-hypnotic triggers (a word, gesture, sound) can be installed and later fire, but only ones that were actually established earlier in the story.\n- Aftereffects: Coming out is groggy and disoriented. Memory of trance may be hazy or absent depending on what was suggested. Effects fade over time unless reinforced.\n\nKeep it internally consistent: never have hypnosis do something it hasn't been set up to do.",
};

// Built-in entries, seeded once. Deleting them sticks (see ensureKnowledgebase).
function makeDefaultKbEntries() {
    const t = Date.now();
    return [
        {
            id: "kb_default_hypnosis",
            title: "Hypnosis Mechanics (example)",
            content: HYPNOSIS_CONTENT,
            active: true, triggers: HYPNOSIS_TRIGGERS, timestamp: t,
        },
        {
            id: "kb_default_trope",
            title: "Character Trope Guidance",
            content: "When a character leans on a trope (tsundere, stoic protector, femme fatale, golden retriever himbo, etc.), treat the trope as a starting flavor, never the whole person. Rules:\n- The trope shapes default reactions, but real motivations, fears, and contradictions sit underneath and surface under pressure.\n- Never announce the trope or play it as parody. A tsundere doesn't say \"it's not like I like you\" on cue; they deflect in a way specific to who they are.\n- Let the character break their own trope when the moment earns it; that contrast is where they feel human.\n- Consistency over caricature: the same person across every scene, not a costume swapped per beat.",
            active: true, triggers: "", timestamp: t,
        },
    ];
}

/** Makes sure the profile has a knowledgebase, seeding the built-in entries exactly once. */
export function ensureKnowledgebase(profile) {
    if (!profile.knowledgebase) profile.knowledgebase = { enabled: false, entries: [] };
    const kb = profile.knowledgebase;
    if (!Array.isArray(kb.entries)) kb.entries = [];
    if (kb.seeded === undefined) {
        if (kb.entries.length === 0) kb.entries = makeDefaultKbEntries();
        kb.seeded = true;
    }
    // The writing baseline repeated the engines' own rules; the hypnosis entry
    // carried a note meant for the reader. Upgrade untouched copies only.
    kb.entries = kb.entries.filter(e => !(e && e.id === "kb_default_writing" && e.content === LEGACY_KB.writing));
    kb.entries.forEach(e => { if (e && e.id === "kb_default_hypnosis" && e.content === LEGACY_KB.hypnosis) e.content = HYPNOSIS_CONTENT; });
    // The hypnosis example used to be always on, telling every story about hypnosis every
    // turn. Untouched copies get its keywords, once: clearing them afterwards sticks.
    if (!kb.hypnosisKeyed) {
        kb.entries.forEach(e => {
            if (e && e.id === "kb_default_hypnosis" && e.content === HYPNOSIS_CONTENT && !String(e.triggers || "").trim()) e.triggers = HYPNOSIS_TRIGGERS;
        });
        kb.hypnosisKeyed = true;
    }
    return kb;
}

/** The shared store (every character), created on first use. */
export function getSharedKnowledgebase() {
    const store = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    if (!store.sharedKnowledgebase || !Array.isArray(store.sharedKnowledgebase.entries)) {
        store.sharedKnowledgebase = { entries: [] };
    }
    return store.sharedKnowledgebase;
}

function saveShared() {
    saveSettingsDebounced();
}

// ── Keywords ─────────────────────────────────────────────────────────────────

/** An entry's keywords as typed: comma-separated, blanks dropped. */
export function parseKeywords(triggers) {
    return String(triggers || "").split(",").map(k => k.trim()).filter(k => k && k !== "*");
}

// A keyword matches as a whole word (or phrase), in any script, ignoring case. A trailing
// * matches word starts: "hypno*" finds hypnosis and hypnotized. Matching inside words was
// the old behaviour, and it fired "trance" on "entrance" and "ass" on "class".
const kwCache = new Map();
export function keywordRegex(keyword) {
    let re = kwCache.get(keyword);
    if (!re) {
        const stem = keyword.endsWith("*");
        const words = (stem ? keyword.slice(0, -1) : keyword).trim().split(/\s+/).filter(Boolean);
        // Nothing left to look for (a bare "*") must match nothing, not everything.
        re = !words.length ? /(?!)/
            : new RegExp(`(?<![\\p{L}\\p{N}_])${words.map(escapeRegex).join("\\s+")}${stem ? "" : "(?![\\p{L}\\p{N}_])"}`, "iu");
        if (kwCache.size > 500) kwCache.clear();
        kwCache.set(keyword, re);
    }
    return re;
}

/** The first of the entry's keywords found in `text`, or null. */
export function matchedKeyword(entry, text) {
    for (const k of parseKeywords(entry && entry.triggers)) if (keywordRegex(k).test(text)) return k;
    return null;
}

/** How many recent messages keywords are looked for in. */
export function kbScanDepth(profile = localProfile) {
    const d = Number(profile && profile.knowledgebase && profile.knowledgebase.scanDepth);
    return Number.isFinite(d) && d >= 1 ? Math.min(50, Math.round(d)) : DEFAULT_SCAN_DEPTH;
}

// The text keywords are looked for in: the last messages, without thinking or blocks. With
// a draft (the preview), the draft stands in for the message about to be sent.
function scanText(profile, draft) {
    const depth = kbScanDepth(profile);
    // A preview (draft) looks at the chat as it stands; a request skips a reply being swiped.
    const all = ((getContext() || {}).chat || []).filter(m => !m.is_system);
    const chat = draft ? all : vcrpWithoutSwipedReply(all);
    const n = draft ? depth - 1 : depth;
    // slice(-0) would be the whole chat: a scan of one message plus a draft is the draft alone.
    const parts = (n > 0 ? chat.slice(-n) : []).map(m => meguminCleanChatHistoryText(m.mes));
    if (draft) parts.push(draft);
    return parts.join("\n");
}

// ── What gets sent ───────────────────────────────────────────────────────────

/**
 * The entries to send right now: always-on ones, and keyed ones with the keyword that
 * fired them ({entry, keyword}). Active, non-empty only; this character's before shared.
 * `draft` previews the next message without sending it.
 */
export function kbSelection(profile = localProfile, draft = "") {
    const kb = profile && profile.knowledgebase;
    if (!kb || !kb.enabled) return { always: [], keyed: [], dormant: [] };
    const usable = e => e && e.active !== false && e.content && e.content.trim();
    const active = [...(kb.entries || []).filter(usable), ...getSharedKnowledgebase().entries.filter(usable)];
    const always = active.filter(e => !parseKeywords(e.triggers).length);
    const keyedAll = active.filter(e => parseKeywords(e.triggers).length);
    let text = "";
    if (keyedAll.length) {
        try { text = scanText(profile, String(draft || "").trim()); } catch (e) { /* no chat: keyed entries stay dormant */ }
    }
    const keyed = [], dormant = [];
    for (const e of keyedAll) {
        const keyword = text ? matchedKeyword(e, text) : null;
        if (keyword) keyed.push({ entry: e, keyword }); else dormant.push(e);
    }
    return { always, keyed, dormant };
}

/** Every entry that would be sent right now, in order. */
export function getInjectableKbEntries(profile = localProfile) {
    const s = kbSelection(profile);
    return [...s.always, ...s.keyed.map(x => x.entry)];
}

/** Whether the active preset has an enabled slot carrying [[knowledgebase_always]]. */
export function presetCarriesAlwaysSlot() {
    try {
        const cc = getContext().chatCompletionSettings || {};
        const carrier = (cc.prompts || []).filter(p => p && typeof p.content === "string" && p.content.includes(ALWAYS_SLOT));
        if (!carrier.length) return false;
        const order = Array.isArray(cc.prompt_order) ? (cc.prompt_order.find(o => o && o.character_id === 100001) || cc.prompt_order[0]) : null;
        if (!order || !Array.isArray(order.order)) return true;
        return carrier.some(p => order.order.some(o => o.identifier === p.identifier && o.enabled));
    } catch (e) {
        return false;
    }
}

// An entry's own text must not close the tags it is sent in.
const guardTags = s => String(s).replace(/<(\/?)(knowledgebase\w*|entry)\b/gi, "‹$1$2");
const entryXml = e => `<entry title="${String(e.title || "").replace(/"/g, "'")}">\n${guardTags(e.content.trim())}\n</entry>`;
const wrap = (tag, lead, entries) => `<${tag}>\n${lead}\n\n${entries.map(entryXml).join("\n\n")}\n</${tag}>`;

/**
 * The text for [[knowledgebase_always]] (alwaysBlock, cached), [[knowledgebase]] (block,
 * per turn), and the one-sentence reminder appended to the CoT.
 */
export function buildKnowledgebase(profile = localProfile) {
    const { always, keyed } = kbSelection(profile);
    const fired = keyed.map(x => x.entry);
    if (!always.length && !fired.length) return { block: "", alwaysBlock: "", cotNote: "" };
    const cached = always.length > 0 && presetCarriesAlwaysSlot();
    const alwaysBlock = cached
        ? wrap("knowledgebase", "Standing rules and lore for this story. Where an entry applies to the scene, follow it exactly.", always)
        : "";
    const perTurn = cached ? fired : [...always, ...fired];
    const block = !perTurn.length ? ""
        : cached ? wrap("knowledgebase_scene", "Rules and lore the current scene touches. Where an entry applies, follow it exactly.", perTurn)
        : wrap("knowledgebase", "Binding rules and lore for this story. Where an entry applies to the scene, follow it exactly.", perTurn);
    const titles = [...always, ...fired].map(e => `"${e.title}"`).join(", ");
    const cotNote = `Also keep in mind the knowledgebase entries (${titles}): anything they define that bears on this scene is binding.`;
    return { block, alwaysBlock, cotNote };
}

/** Always-on entries and their tokens, for the tab and Setup Check. */
export function kbAlwaysOnStats(profile = localProfile) {
    const { always } = kbSelection(profile);
    return { count: always.length, tokens: always.reduce((n, e) => n + kbTokens(e.content), 0) };
}

// ── Import / export ──────────────────────────────────────────────────────────

const newId = () => "kb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sameEntry = (a, b) => (a.title || "").trim() === (b.title || "").trim() && (a.content || "").trim() === (b.content || "").trim();

function exportKnowledgebase() {
    const kb = ensureKnowledgebase(localProfile);
    const pick = shared => e => ({ title: e.title || "", content: e.content || "", triggers: e.triggers || "", active: e.active !== false, shared });
    downloadJsonFile("vcrp_knowledgebase.json", {
        format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
        entries: [...kb.entries.map(pick(false)), ...getSharedKnowledgebase().entries.map(pick(true))],
    });
}

/**
 * Adds entries from an exported file. Entries marked shared go to the shared list, the rest to
 * this character; an entry identical (title + content) to one already in its list is skipped.
 * @returns {{added: number, skipped: number}}
 */
export function importKnowledgebaseData(data, profile = localProfile) {
    // Accept a VCRP export, or a bare array of entries.
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
    if (!list) throw new Error("This file is not a VCRP knowledgebase export.");
    const kb = ensureKnowledgebase(profile);
    const shared = getSharedKnowledgebase();
    let added = 0, skipped = 0;
    for (const raw of list) {
        if (!raw || typeof raw.content !== "string" || !raw.content.trim()) { skipped++; continue; }
        const entry = {
            id: newId(), title: String(raw.title || "Imported Entry"), content: raw.content,
            triggers: String(raw.triggers || ""), active: raw.active !== false, timestamp: Date.now(),
        };
        const target = raw.shared ? shared.entries : kb.entries;
        if (target.some(e => sameEntry(e, entry))) { skipped++; continue; }
        target.push(entry);
        added++;
    }
    return { added, skipped };
}

// ── UI: the Knowledgebase tab ────────────────────────────────────────────────

export function renderKnowledgebase(c) {
    c.empty();
    const kb = ensureKnowledgebase(localProfile);

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #6366f1, #4f46e5);">
                    <i class="fa-solid fa-book-open"></i>
                </div>
                <div>
                    <h2>Knowledgebase</h2>
                    <p>Core rules, lore, and trope guidance the AI always has access to - think of it as a permanent lorebook.</p>
                </div>
            </div>
            <div id="kb_header_badge" class="mtab-header-badge"></div>
        </div>

        <div class="mtab-toggle-row ${kb.enabled ? 'active' : ''}" id="kb_enable_card" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-book-open" style="color:#6366f1;"></i> Enable Knowledgebase</div>
                <div class="toggle-desc">Active entries are injected into the prompt: always-on by default, or only when their trigger keywords appear in recent chat. Use this for complex rules, hypnosis mechanics, magic systems, or any lore the AI must know. Shared entries apply to every character that has the Knowledgebase on.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <div id="kb_main_content" style="display: ${kb.enabled ? 'block' : 'none'};">
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 14px; flex-wrap: wrap;">
                <input type="file" id="kb_file_import" accept=".json" style="display: none;">
                <button id="kb_btn_import" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem;"><i class="fa-solid fa-file-import"></i> Import</button>
                <button id="kb_btn_export" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem;"><i class="fa-solid fa-file-export"></i> Export</button>
            </div>

            <div class="mtab-panel" style="margin-bottom: 18px; padding: 12px 14px;">
                <div id="kb_summary" style="font-size: 0.75rem; line-height: 1.55; display: flex; flex-direction: column; gap: 3px;"></div>
                <div class="mtab-setting-row" style="padding: 10px 0 0; border: none;">
                    <div class="set-info">
                        <div class="set-label">Keyword scan</div>
                        <div class="set-desc">How many recent messages are searched for an entry's keywords.</div>
                    </div>
                    <input id="kb_scan_depth" type="number" min="1" max="50" step="1" class="ps-modern-input" style="width: 80px;">
                </div>
                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button id="kb_btn_preview" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem;" title="Which entries the last messages, plus whatever is in the message box, would send. Nothing is sent."><i class="fa-solid fa-magnifying-glass"></i> What fires now?</button>
                </div>
                <div id="kb_preview_out" style="margin-top: 8px; font-size: 0.75rem; line-height: 1.55;"></div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div style="color: #818cf8; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-user"></i> This Character
                    <span id="kb_count_own" style="color: var(--text-muted); font-size: 0.75rem; margin-left: 8px;"></span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="kb_btn_add" class="ps-modern-btn primary" style="padding: 4px 12px; font-size: 0.72rem; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; border: none;"><i class="fa-solid fa-plus"></i> Add Entry</button>
                    <button id="kb_btn_clear_all" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-trash-can"></i> Clear All</button>
                </div>
            </div>
            <div id="kb_entry_list" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div style="color: #10b981; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-users"></i> Shared (All Characters)
                    <span id="kb_count_shared" style="color: var(--text-muted); font-size: 0.75rem; margin-left: 8px;"></span>
                </div>
                <button id="kb_btn_add_shared" class="ps-modern-btn primary" style="padding: 4px 12px; font-size: 0.72rem; background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none;"><i class="fa-solid fa-plus"></i> Add Shared Entry</button>
            </div>
            <div id="kb_shared_list" style="display: flex; flex-direction: column; gap: 10px;"></div>
        </div>
    `);

    const paintBadge = () => $("#kb_header_badge")
        .css(kb.enabled
            ? { background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }
            : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)", border: "1px solid var(--border-color)" })
        .html(`<i class="fa-solid fa-${kb.enabled ? "circle-check" : "circle-xmark"}" style="font-size:0.6rem;"></i> ${kb.enabled ? "Enabled" : "Disabled"}`);
    paintBadge();

    $("#kb_enable_card").on("click", function () {
        kb.enabled = !kb.enabled;
        saveProfileToMemory();
        $(this).toggleClass("active", kb.enabled);
        paintBadge();
        if (kb.enabled) { $("#kb_main_content").slideDown(200); renderKbLists(); }
        else $("#kb_main_content").slideUp(200);
    });

    const addTo = (list, save, listSel) => {
        list.push({ id: newId(), title: "New Entry", content: "", active: true, triggers: "", timestamp: Date.now() });
        save();
        renderKbLists();
        const last = $(`${listSel} .kb-entry-card`).last();
        last.find(".kb-entry-body").show();
        last.find(".kb-chevron").css("transform", "rotate(90deg)");
        last.find(".kb-title-input").trigger("focus").trigger("select");
    };
    $("#kb_btn_add").on("click", () => addTo(kb.entries, saveProfileToMemory, "#kb_entry_list"));
    $("#kb_btn_add_shared").on("click", () => addTo(getSharedKnowledgebase().entries, saveShared, "#kb_shared_list"));

    $("#kb_btn_clear_all").on("click", function () {
        if (!kb.entries.length) return;
        if (confirm("Delete all of this character's knowledgebase entries? Shared entries are kept. This cannot be undone.")) {
            kb.entries = [];
            saveProfileToMemory();
            renderKbLists();
        }
    });

    $("#kb_scan_depth").val(kbScanDepth(localProfile)).on("change", function () {
        const v = Math.round(Number($(this).val()));
        kb.scanDepth = Number.isFinite(v) ? Math.min(50, Math.max(1, v)) : DEFAULT_SCAN_DEPTH;
        $(this).val(kb.scanDepth);
        saveProfileToMemory();
    });

    // Built with .text(), so titles and keywords can hold anything.
    $("#kb_btn_preview").on("click", () => {
        const draft = String($("#send_textarea").val() || "");
        const s = kbSelection(localProfile, draft);
        const out = $("#kb_preview_out").empty();
        const line = (label, color, items) => {
            const row = $(`<div></div>`);
            row.append($(`<b></b>`).css("color", color).text(`${label}: `));
            row.append(document.createTextNode(items.length ? items.join(" · ") : "none"));
            out.append(row);
        };
        if (!s.always.length && !s.keyed.length && !s.dormant.length) {
            out.append($(`<div style="opacity:.8;"></div>`).text("No active entries."));
            return;
        }
        line("Always on", "#10b981", s.always.map(e => e.title || "Untitled"));
        line(`Fires now${draft.trim() ? " (with the message box)" : ""}`, "#f59e0b", s.keyed.map(x => `${x.entry.title || "Untitled"} (on "${x.keyword}")`));
        line(`Not now (searched the last ${kbScanDepth(localProfile)} messages)`, "var(--text-muted)", s.dormant.map(e => e.title || "Untitled"));
    });

    $("#kb_btn_export").on("click", exportKnowledgebase);
    $("#kb_btn_import").on("click", () => $("#kb_file_import").trigger("click"));
    $("#kb_file_import").on("change", function () {
        const file = this.files && this.files[0];
        this.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const { added, skipped } = importKnowledgebaseData(JSON.parse(String(reader.result)));
                saveProfileToMemory();
                saveShared();
                renderKbLists();
                toastr.success(`Imported ${added} entr${added === 1 ? "y" : "ies"}${skipped ? `, skipped ${skipped} (duplicate or empty)` : ""}.`, "Knowledgebase");
            } catch (e) {
                toastr.error(e.message || "Could not read that file.", "Knowledgebase");
            }
        };
        reader.readAsText(file);
    });

    if (kb.enabled) renderKbLists();
}

// What the entries cost: always-on ones go out on every request, keyed ones only when they fire.
function paintSummary() {
    const el = $("#kb_summary");
    if (!el.length) return;
    const kb = ensureKnowledgebase(localProfile);
    const all = [...kb.entries, ...getSharedKnowledgebase().entries].filter(e => e && e.active !== false && e.content && e.content.trim());
    const keyedCount = all.filter(e => parseKeywords(e.triggers).length).length;
    const { count, tokens } = kbAlwaysOnStats(localProfile);
    const cached = presetCarriesAlwaysSlot();
    el.empty();
    const add = (text, color) => el.append($(`<div></div>`).css("color", color || "").text(text));
    add(`Always on: ${count} ${count === 1 ? "entry" : "entries"}, about ${tokens.toLocaleString()} tokens on every request${count && cached ? ", cached before the chat. Editing one makes the next request full price once." : "."}`);
    add(`Keyed: ${keyedCount} ${keyedCount === 1 ? "entry" : "entries"}, sent only on the turns their keywords appear.`);
    if (tokens > BIG_ALWAYS_TOKENS) add("That is a lot to send on every request. Give the entries that only matter sometimes a few keywords.", "#f59e0b");
    if (count && !cached) add("The active preset is from before the always-on slot: these entries go after the chat and are written to the cache again every turn. Re-import the VCRP preset to cache them.", "#f59e0b");
}

function renderKbLists() {
    const kb = ensureKnowledgebase(localProfile);
    const shared = getSharedKnowledgebase();
    paintSummary();
    renderEntryList($("#kb_entry_list"), kb.entries, {
        save: saveProfileToMemory,
        countEl: "#kb_count_own",
        empty: "No entries for this character yet. Click \"Add Entry\" to define world rules, lore, or trope guidance.",
        move: { label: "Share", icon: "fa-users", title: "Move to Shared (all characters)", to: shared.entries, saveTarget: saveShared },
    });
    renderEntryList($("#kb_shared_list"), shared.entries, {
        save: saveShared,
        countEl: "#kb_count_shared",
        empty: "No shared entries. Entries here are sent for every character that has the Knowledgebase on.",
        move: { label: "Unshare", icon: "fa-user", title: "Move to this character only", to: kb.entries, saveTarget: saveProfileToMemory },
    });
}

function renderEntryList(list, entries, opts) {
    list.empty();
    const activeCount = entries.filter(e => e.active !== false).length;
    $(opts.countEl).text(`(${entries.length} entries, ${activeCount} active)`);
    if (!entries.length) {
        list.append($(`<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 18px;"></div>`).text(opts.empty));
        return;
    }

    entries.forEach((entry, idx) => {
        const isActive = entry.active !== false;
        const hasContent = !!(entry.content && entry.content.trim());
        const isTriggered = parseKeywords(entry.triggers).length > 0;

        const card = $(`
            <div class="kb-entry-card" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(99,102,241,${isActive ? "0.25" : "0.1"}); border-radius: 10px; overflow: hidden; transition: border-color 0.2s, opacity 0.2s; opacity: ${isActive ? "1" : "0.5"};">
                <div class="kb-entry-header" style="padding: 9px 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: linear-gradient(135deg, rgba(99,102,241,${isActive ? "0.1" : "0.04"}), rgba(79,70,229,${isActive ? "0.06" : "0.02"})); user-select: none;">
                    <i class="fa-solid fa-chevron-right kb-chevron" style="font-size: 0.6rem; color: #818cf8; transition: transform 0.2s; flex-shrink: 0;"></i>
                    <input type="text" class="kb-title-input" placeholder="Entry title..."
                        style="flex: 1; background: transparent; border: none; color: var(--text-main); font-size: 0.83rem; font-weight: 600; outline: none; cursor: text; min-width: 0;" />
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                        ${!hasContent ? `<span style="font-size:0.58rem; color:#f59e0b; opacity:0.8;"><i class="fa-solid fa-triangle-exclamation"></i> Empty</span>` : ""}
                        <span title="${isTriggered ? "Injected only when a trigger keyword appears in recent chat" : "Always injected while active"}" style="display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:8px; font-size:0.58rem; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; flex-shrink:0; ${isTriggered ? "background:rgba(245,158,11,0.14); color:#f59e0b; border:1px solid rgba(245,158,11,0.3);" : "background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25);"}">
                            <i class="fa-solid ${isTriggered ? "fa-key" : "fa-infinity"}" style="font-size:0.5rem;"></i>${isTriggered ? "Keyed" : "Always"}
                        </span>
                        <span class="kb_active_toggle" style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:8px; font-size:0.6rem; font-weight:700; cursor:pointer; text-transform:uppercase; letter-spacing:0.4px; flex-shrink:0; ${isActive ? "background:rgba(99,102,241,0.18); color:#818cf8; border:1px solid rgba(99,102,241,0.35);" : "background:rgba(107,114,128,0.12); color:#6b7280; border:1px solid rgba(107,114,128,0.2);"}">
                            <i class="fa-solid ${isActive ? "fa-eye" : "fa-eye-slash"}" style="font-size:0.55rem;"></i>${isActive ? "Active" : "Off"}
                        </span>
                        <button class="kb_move_btn" style="background: transparent; border: none; color: #10b981; cursor: pointer; font-size: 0.72rem; padding: 2px 4px;"><i class="fa-solid"></i></button>
                        <button class="kb_del_btn" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 0.75rem; padding: 2px 4px;" title="Delete entry"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="kb-entry-body" style="display: none; padding: 10px 12px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <textarea class="ps-modern-input kb-content-input"
                        placeholder="Enter the knowledge, rules, or lore for this entry. This text is injected verbatim into the prompt."
                        style="width: 100%; height: 130px; resize: vertical; font-size: 0.74rem; line-height: 1.55; font-family: monospace;"></textarea>
                    <div style="font-size: 0.63rem; color: var(--text-muted); margin-top: 5px; display:flex; justify-content:flex-end;">
                        <span class="kb-char-count"></span>
                    </div>
                    <div style="margin-top: 10px; padding-top: 9px; border-top: 1px dashed rgba(99,102,241,0.15);">
                        <label style="display:block; font-size:0.63rem; color:#818cf8; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">
                            <i class="fa-solid fa-key" style="font-size:0.55rem;"></i> Trigger Keywords <span style="color:var(--text-muted); font-weight:400; text-transform:none; letter-spacing:0;">(optional, comma-separated)</span>
                        </label>
                        <input type="text" class="ps-modern-input kb-triggers-input" placeholder="e.g. hypno*, trance, spiral - leave blank to always inject" style="width:100%; font-size:0.72rem;" />
                        <div style="font-size:0.6rem; color:var(--text-muted); margin-top:4px;">Leave blank = always injected. With keywords, this entry is sent only when one appears in recent chat as a whole word, in any capitalisation. End a keyword with * to match word starts: hypno* finds hypnosis and hypnotized.</div>
                    </div>
                </div>
            </div>
        `);

        // Values are set through .val()/.text(), never pasted into the HTML, so any text is safe.
        const paintCount = len => card.find(".kb-char-count").text(`${len} chars · about ${Math.ceil(len / 3.5).toLocaleString()} tokens${isTriggered ? " when it fires" : " on every request"}`).css("color", len > 2000 ? "#ef4444" : "var(--text-muted)");
        // Saved as you type, a moment after the last keystroke: on a phone, closing the panel
        // mid-edit may never fire the change event the save used to wait for.
        let saveTimer = null;
        const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => opts.save(), 400); };
        card.find(".kb-title-input").val(entry.title);
        card.find(".kb-content-input").val(entry.content);
        card.find(".kb-triggers-input").val(entry.triggers || "");
        card.find(".kb_move_btn").attr("title", opts.move.title).find("i").addClass(opts.move.icon);
        paintCount((entry.content || "").length);

        card.find(".kb-entry-header").on("click", function (e) {
            if ($(e.target).closest(".kb_del_btn, .kb_move_btn, .kb_active_toggle, .kb-title-input").length) return;
            const body = $(this).siblings(".kb-entry-body");
            const opening = !body.is(":visible");
            body.slideToggle(180);
            $(this).find(".kb-chevron").css("transform", opening ? "rotate(90deg)" : "rotate(0deg)");
        });
        card.find(".kb-title-input")
            .on("input", function () { entry.title = $(this).val(); saveSoon(); })
            .on("change", function () { entry.title = $(this).val(); clearTimeout(saveTimer); opts.save(); })
            .on("click", e => e.stopPropagation())
            .on("keydown", e => { if (e.key === "Enter") e.target.blur(); });
        card.find(".kb-content-input")
            .on("input", function () { entry.content = $(this).val(); paintCount(entry.content.length); saveSoon(); })
            .on("change", function () { entry.content = $(this).val(); clearTimeout(saveTimer); opts.save(); renderKbLists(); });
        card.find(".kb-triggers-input")
            .on("input", function () { entry.triggers = $(this).val(); saveSoon(); })
            .on("change", function () { entry.triggers = $(this).val(); clearTimeout(saveTimer); opts.save(); renderKbLists(); })
            .on("click", e => e.stopPropagation())
            .on("keydown", e => { if (e.key === "Enter") e.target.blur(); });
        card.find(".kb_active_toggle").on("click", function (e) {
            e.stopPropagation();
            entry.active = entry.active === false;
            opts.save();
            renderKbLists();
        });
        card.find(".kb_move_btn").on("click", function (e) {
            e.stopPropagation();
            entries.splice(idx, 1);
            opts.move.to.push(entry);
            opts.save();
            opts.move.saveTarget();
            renderKbLists();
        });
        card.find(".kb_del_btn").on("click", function (e) {
            e.stopPropagation();
            if (confirm(`Delete "${entry.title}"?`)) {
                entries.splice(idx, 1);
                opts.save();
                renderKbLists();
            }
        });

        list.append(card);
    });
}
