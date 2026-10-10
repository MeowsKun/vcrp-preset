// Renders every tab of the extension in jsdom with real jQuery, then clicks every button, card and
// toggle in every tab, to catch runtime errors in UI code.
// One-time setup:  cd tools && npm install      Run from the repo root:  node tools/test_ui.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let JSDOM, jqueryFactory;
try {
    ({ JSDOM } = require("jsdom"));
    jqueryFactory = require("jquery");
} catch {
    console.log("Missing test libraries. Run once:  cd tools && npm install");
    process.exit(1);
}

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const { buildFakeTree } = await import(pathToFileURL(join(REPO, "tools/st_stub.mjs")).href);

// ── browser ──────────────────────────────────────────────────────────────────
const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="send_but_sheld"></div><textarea id="send_textarea"></textarea><div id="chat"></div></body></html>`,
    { url: "http://localhost:8000/", pretendToBeVisual: true });
const w = dom.window;
const $ = jqueryFactory(w);
$.fx.off = true;
const errors = [];
const origError = console.error;
console.error = (...a) => { const s = a.map(String).join(" "); if (s.includes("Not implemented: navigation")) return; errors.push(s); };
Object.assign(globalThis, {
    window: w, document: w.document, HTMLElement: w.HTMLElement, Node: w.Node,
    getComputedStyle: w.getComputedStyle, requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    localStorage: w.localStorage, sessionStorage: w.sessionStorage, MutationObserver: w.MutationObserver,
    $, jQuery: $,
    toastr: { info() {}, success() {}, error() {}, warning() {}, clear() {} },
});
w.$ = $; w.jQuery = $; w.toastr = globalThis.toastr;
globalThis.confirm = () => true; w.confirm = () => true;
globalThis.prompt = () => "Test Name"; w.prompt = globalThis.prompt;
globalThis.alert = () => {}; w.alert = () => {};

// ── SillyTavern stubs ────────────────────────────────────────────────────────
const extension_settings = {};
const chat = [
    { is_user: true, mes: "hello", name: "Bob" },
    { is_user: false, mes: "<think>x</think>Alice smiles.\n<Blocks><World_State>Time: now</World_State></Blocks>", name: "Alice" },
];
const ctx = {
    characters: [{ avatar: "alice.png", name: "Alice", data: {} }], characterId: 0, groupId: null, groups: [],
    chat, chatMetadata: {}, name1: "Bob", name2: "Alice", extensionSettings: extension_settings,
    chatCompletionSettings: { chat_completion_source: "claude", claude_model: "claude-opus-5-5" },
    eventSource: { on() {}, emit: async () => {} }, getTokenCountAsync: async s => Math.ceil(String(s).length / 4),
};
globalThis.__ST__ = {
    extension_settings, getContext: () => ctx, substituteParams: s => String(s),
    saveSettingsDebounced() {}, saveMetadata() {}, saveChat() {}, chat_metadata: {}, isGenerating: () => false,
    debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now", generateQuietPrompt: async () => "",
    event_types: new Proxy({}, { get: (t, k) => String(k) }), eventSource: { on() {}, once() {}, emit: async () => {}, removeListener() {} },
    Popup: class { constructor() {} show() { return Promise.resolve(true); } }, POPUP_TYPE: { CONFIRM: 1, TEXT: 2, INPUT: 3 },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.extension_settings = extension_settings;

const { ext } = buildFakeTree("test-ui");
const imp = p => import(pathToFileURL(join(ext, p)).href);
const { initProfile } = await imp("src/core/profile.js");
const state = await imp("src/core/state.js");
const { tabsUI, switchTab } = await imp("src/ui/tabs.js");
const { renderDevMode } = await imp("src/ui/devmode.js");

$("body").append(readFileSync(join(REPO, "example.html"), "utf8"));
initProfile();

let failures = 0;
async function renderAll(label) {
    for (let i = 0; i < tabsUI.length; i++) {
        const before = errors.length;
        try {
            switchTab(i);
            await new Promise(r => setTimeout(r, 5));
            const html = $("#ps_stage_content").html() || "";
            const leaked = html.match(/\bundefined\b|\[object Object\]|NaN/g);
            const problems = [];
            if (html.length < 50) problems.push(`rendered almost nothing (${html.length} chars)`);
            if (leaked) problems.push(`suspicious text in output: ${[...new Set(leaked)].join(", ")}`);
            if (errors.length > before) problems.push(`console.error: ${errors.slice(before).join(" | ").slice(0, 300)}`);
            if (problems.length) { failures++; console.log(`  ✗ [${label}] ${tabsUI[i].title}: ${problems.join("; ")}`); }
            else console.log(`  ✓ [${label}] ${tabsUI[i].title} (${html.length} chars)`);
        } catch (e) {
            failures++;
            console.log(`  ✗ [${label}] ${tabsUI[i].title}: THREW ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e}`);
        }
    }
}

console.log("Tabs:", tabsUI.map(t => t.title).join(" | "));
await renderAll("defaults");

// Every remaining feature switched on.
const p = state.localProfile;
Object.assign(p, { mode: "v10-shura", model: "cot-v10-shura-english", cotEnabled: true, thinkingV2: true });
p.knowledgebase.enabled = true; p.animeMode.enabled = true;
p.addons = ["bold_npcs", "html", "color", "dn"];
if (p.npcBank) { p.npcBank.enabled = true; p.npcBank.npcs = [{ name: "Mara", appearance: "tall", pfp: "" }]; }

if (p.storyPlan) p.storyPlan.enabled = true;
p.focus = { enabled: true, every: 20, checks: { drift: true, motifs: true, slop: true } };
p.banList = ["no purple prose"];
// Story Memory on, with a chapter, an arc, a fact and a chapter waiting for review.
const memory = await imp("src/vcrp/memory/index.js");
const seedMemory = () => {
    p.vcrpMemory.enabled = true;
    Object.assign(memory.memoryState(), {
        lastPlan: { at: 0, cold: true, cut: false, behind: true, limit: "summaries", reason: "cold start, over budget (summaries)", promptTokens: 30000 },
        chapters: [{ id: "C1", gist: "Bob met Mara at the bar.", chapter: "Bob walked into the Lantern.", from: 0, to: 0, start: null, end: null, checked: "ok" }],
        arcs: [{ text: "The first week in Baltimore.", covers: [] }],
        ledger: [{ id: "F1", cat: "person", text: "Mara tends bar at the Lantern." }],
        pending: [{ from: 0, to: 1, gist: "Mara smiled.", chapter: "Alice smiled.", ops: [{ op: "+", cat: "item", text: "a brass key" }], checked: "corrected", arc: "", foldIds: [], start: null, end: null }, { from: 2, to: 3, gist: "Second.", chapter: "More.", ops: [], checked: "ok", arc: "", foldIds: [], start: null, end: null }],
        shown: "<story_memory>x</story_memory>",
    });
};
seedMemory();
await renderAll("all on");
// Every tab again with a Pura engine and every Pura setting and tracker on.
{
    const keep = { mode: p.mode, pura: p.pura, order: [...p.blockStack.order] };
    p.mode = "pura-original";
    p.pura = { voice: "random", randomisers: ["chaos", "kink"], groundedProse: true, html: true, diegeticStats: true, nameRandomiser: true, reasoning: "procedure", friction: true, nsfw: true, gooner: true, nightmare: true, director: "Be bold." };
    p.blockStack.order = [...p.blockStack.order, "pura_scene", "pura_relationship", "pura_npc", "pura_events", "pura_skill_choices", "pura_stats"];
    await renderAll("pura on");
    p.mode = "pura-adapted";
    await renderAll("pura adapted");
    Object.assign(p, { mode: keep.mode, pura: keep.pura });
    p.blockStack.order = keep.order;
}

// Click every interactive element in every tab (re-rendering the tab before each click).
const CLICKABLE = "button, .mtab-eng-card, .mtab-toggle-row, .ps-toggle-card, .ws-nav-btn, .ws-card, .ecard-opt, .kb_active_toggle, .kb-entry-header, .wstyle-filter-pill, [data-target]";
let clicks = 0;
for (let i = 0; i < tabsUI.length; i++) {
    switchTab(i);
    const count = $("#ps_stage_content").find(CLICKABLE).length;
    for (let k = 0; k < count; k++) {
        switchTab(i);
        const el = $("#ps_stage_content").find(CLICKABLE).eq(k);
        if (!el.length) continue;
        const desc = `${tabsUI[i].title} › ${(el.text() || el.attr("id") || el.attr("class") || "").replace(/\s+/g, " ").trim().slice(0, 50)}`;
        const before = errors.length;
        try {
            el.trigger("click");
            await new Promise(r => setTimeout(r, 2));
            clicks++;
            if (errors.length > before) { failures++; console.log(`  ✗ click ${desc}: ${errors.slice(before).join(" | ").slice(0, 300)}`); }
        } catch (e) {
            failures++;
            console.log(`  ✗ click ${desc}: THREW ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e}`);
        }
    }
}
// Story Memory's own controls, with the panel switched on for each click (the generic pass
// above clicks its on/off toggle first, which hides the rest).
const memTab = tabsUI.findIndex(t => t.title === "Memory");
seedMemory(); switchTab(memTab);
const memCount = $("#ps_stage_content").find("[id^=vmem_]").filter("button, input[type=checkbox]").length;
for (let k = 0; k < memCount; k++) {
    seedMemory(); switchTab(memTab);
    const el = $("#ps_stage_content").find("[id^=vmem_]").filter("button, input[type=checkbox]").eq(k);
    if (!el.length || el.attr("id") === "vmem_enable") continue;
    const before = errors.length;
    try {
        el.trigger(el.is("input") ? "change" : "click");
        await new Promise(r => setTimeout(r, 2));
        clicks++;
        if (errors.length > before) { failures++; console.log(`  ✗ Story Memory › ${el.attr("id")}: ${errors.slice(before).join(" | ").slice(0, 300)}`); }
    } catch (e) {
        failures++;
        console.log(`  ✗ Story Memory › ${el.attr("id")}: THREW ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e}`);
    }
}
// Reply length, with Story Memory off: the panel still shows (length is most of what a reply
// costs either way), Story Memory's own controls do not, and each control reaches its setting.
{
    p.vcrpMemory.enabled = false;
    switchTab(memTab);
    const box = $("#ps_stage_content");
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ Reply length: ${what}`); } };
    check(box.find("#vmem_len").length === 1 && box.find("#vmem_think").length === 1 && box.find("#vmem_cap_reply").length === 1, "the panel is missing with Story Memory off");
    check(box.find("#vmem_summarize").length === 0, "Story Memory's own controls show while it is off");
    const lengthValue = box.find("#vmem_len option").eq(2).val();
    box.find("#vmem_len").val(lengthValue).trigger("change");
    check(p.storyConfig && p.storyConfig.length === lengthValue, "Story length does not reach Story Config's Length");
    box.find("#vmem_think").val("250").trigger("change");
    check(p.thinkEffort === "250", "Thinking length does not reach Thinking Effort");
    box.find("#vmem_cap_reply").val("9000").trigger("change");
    const capNow = (((extension_settings.VCRP || {}).globalSettings || {}).memoryBudget || {}).replyCap;
    check(capNow === 9000, `the safety cap is not saved (${capNow})`);
    clicks += 3;
    console.log("  ✓ Reply length (Story Memory off): drawn, and each control reaches its setting");
}
// Background calls: their price shows before sending (Story Director, NPC scan, NPC update),
// "Only New Messages" reaches its setting, and the Memory tab counts them in what was spent.
{
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ Background calls: ${what}`); } };
    const failedBefore = failures;
    const box = $("#ps_stage_content");
    switchTab(tabsUI.findIndex(t => t.title === "Story Director"));
    check(/^Sends about [\d.]+k tokens, roughly \$[\d.]+ on Claude Opus 5\.5\.$/.test(box.find("#sd_cost_estimate").text()), `Story Director estimate: "${box.find("#sd_cost_estimate").text()}"`);
    p.npcBank.enabled = true; p.npcBank.npcs = [{ name: "Mara", appearance: "tall", pfp: "" }];   // the click pass cleared them
    switchTab(tabsUI.findIndex(t => t.title === "NPCs Bank"));
    check(/^Next scan: Sends about/.test(box.find("#npc_scan_estimate").text()), `NPC scan estimate: "${box.find("#npc_scan_estimate").text()}"`);
    check(/Sends about/.test(box.find(".npc_force_update").first().attr("title") || ""), `NPC update estimate missing from its button (${box.find(".npc_force_update").length} buttons, title "${box.find(".npc_force_update").first().attr("title")}")`);
    check(box.find("#npc_scan_new_only").is(":checked"), "Only New Messages is not on by default");
    box.find("#npc_scan_new_only").prop("checked", false).trigger("change");
    check(p.npcBank.scanNewOnly === false, "Only New Messages does not reach its setting");
    p.npcBank.scanNewOnly = true;
    seedMemory();
    Object.assign(memory.memoryState(), { spend: { since: 0, replies: 2, replyCost: 0.4, tasks: 0, taskCost: 0, last: null, bgCalls: 1, bgCost: 0.1 } });
    switchTab(memTab);
    const spent = box.text().replace(/\s+/g, " ");
    check(spent.includes("about $0.50") && spent.includes("1 VCRP task such as the Story Director and NPC scans ($0.10)"), `the Memory tab does not count background calls: ${(spent.match(/Spent in this chat.{0,200}/) || ["(no spend line)"])[0]}`);
    clicks += 1;
    if (failures === failedBefore) console.log("  ✓ Background calls: priced before sending, Only New Messages saved, counted in the Memory tab");
}
// Focus: an audit waiting for review is shown; approving puts the edited note live and keeps
// its findings; the settings hold their limits; a finding can be forgotten.
{
    const focus = await imp("src/vcrp/focus/index.js");
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ Focus: ${what}`); } };
    const failedBefore = failures;
    const tick = () => new Promise(r => setTimeout(r, 5));
    p.focus = { enabled: true, every: 20, checks: { drift: true, motifs: true, slop: true } };
    Object.assign(focus.focusState(), {
        note: "Old note.", noteAt: 1, nextId: 2, items: [{ id: "F1", kind: "motif", text: "the smirk", times: 2, last: 1 }],
        pending: { recurring: ["F1"], findings: [{ kind: "slop", text: "air thick with <tension>" }], note: "New note.", at: 2, replies: 20 },
    });
    switchTab(tabsUI.findIndex(t => t.title === "Focus"));
    const box = $("#ps_stage_content");
    check(box.find("#focus_pending_note").val() === "New note." && box.text().includes("came back: 3 times now") && box.text().includes("air thick with <tension>"), "the waiting audit is not shown in full");
    box.find("#focus_pending_note").val("Edited note.");
    box.find("#focus_approve").trigger("click"); await tick();
    const st = focus.peekFocusState();
    check(st.note === "Edited note." && !st.pending && st.items.find(i => i.id === "F1").times === 3 && st.items.length === 2, `approving: ${JSON.stringify(st)}`);
    check(box.find("#focus_note").val() === "Edited note." && !box.find("#focus_approve").length, "not redrawn after approving");
    check(box.text().includes("Also sent with it, as repeat offenders:") && box.text().includes("in the prompt"), "the repeat offender in the prompt is not shown");
    box.find("#focus_standing").prop("checked", false).trigger("change");
    check(p.focus.standing === false && !box.text().includes("Also sent with it"), "Keep repeat offenders does not switch off");
    box.find("#focus_standing").prop("checked", true).trigger("change");
    box.find("#focus_note").val("Hand-edited.").trigger("change"); await tick();
    check(focus.peekFocusState().note === "Hand-edited.", "the live note cannot be edited");
    box.find("#focus_every").val("3").trigger("change");
    check(p.focus.every === 5, `every went below 5 (${p.focus.every})`);
    for (const k of ["drift", "motifs", "slop"]) box.find(`#focus_check_${k}`).prop("checked", false).trigger("change");
    check(p.focus.checks.slop === true && box.find("#focus_check_slop").is(":checked"), "all three checks could be turned off");
    box.find(".focus_item_remove").first().trigger("click"); await tick();
    check(focus.peekFocusState().items.length === 1, "a finding could not be forgotten");
    box.find("#focus_clear_note").trigger("click"); await tick();
    check(focus.peekFocusState().note === "" && !box.find("#focus_clear_note").length, "the note could not be taken out");
    clicks += 6;
    if (failures === failedBefore) console.log("  ✓ Focus: review, approve with edits, live note, limits, forgetting a finding");

    // The plot focus: drawn and working with the drift audits off.
    const plotBefore = failures;
    p.focus.enabled = false;
    switchTab(tabsUI.findIndex(t => t.title === "Focus"));
    check(box.find("#focus_plot_text").length === 1 && box.find("#focus_plot_status").text().startsWith("Off."), "the plot focus is not drawn with the audits off");
    box.find("#focus_plot_on").prop("checked", true).trigger("change"); await tick();
    check(/On, but empty/.test(box.find("#focus_plot_status").text()), `switched on empty: "${box.find("#focus_plot_status").text()}"`);
    box.find("#focus_plot_text").val("The brass ring <and> who wants it").trigger("change"); await tick();
    box.find("#focus_plot_strength").val("thread").trigger("change"); await tick();
    box.find("#focus_plot_end").val("-4").trigger("change"); await tick();
    const plot = focus.peekFocusState().plot;
    check(plot.active && plot.text === "The brass ring <and> who wants it" && plot.strength === "thread" && plot.endAfter === 0, `the plot focus settings: ${JSON.stringify(plot)}`);
    check(/until you switch it off/.test(box.find("#focus_plot_status").text()), "the status does not say it is on");
    box.find("#focus_plot_end").val("12").trigger("change"); await tick();
    check(/12 replies left/.test(box.find("#focus_plot_status").text()), `the count is not shown: "${box.find("#focus_plot_status").text()}"`);
    check(/Enabled/.test(box.find(".mtab-header-badge").text()), "the tab badge ignores an active plot focus");
    clicks += 6;
    if (failures === plotBefore) console.log("  ✓ Plot focus: on/off, text, strength, count, status, works with the audits off");

    // The prompt editor, with the audits off and on; typing saves the reader's text.
    const editorBefore = failures;
    check(box.find("#focus_prompt_editor textarea").length === 15, `the prompt editor (audits off): ${box.find("#focus_prompt_editor textarea").length} fields`);
    p.focus.enabled = true;
    switchTab(tabsUI.findIndex(t => t.title === "Focus"));
    check(box.find("#focus_prompt_editor textarea").length === 15, "the prompt editor is missing with the audits on");
    box.find("#focus_prompt_editor .pe-enable-toggle").trigger("click");
    box.find('#focus_prompt_editor textarea[data-key="checkSlop"]').val("- [slop] my own check").trigger("input");
    check(p.focus.customPromptsEnabled === true && p.focus.customPrompts && p.focus.customPrompts.checkSlop === "- [slop] my own check", "an edit does not reach the profile");
    box.find("#focus_prompt_editor .btn-reset-all").trigger("click");
    check(p.focus.customPrompts === null, "Reset All Defaults does not clear the edits");
    clicks += 3;
    if (failures === editorBefore) console.log("  ✓ Focus prompts: editor drawn either way, edits saved, reset");
}
// What's new after an update: a card on Global Settings and a dot on the gear until "Got it".
{
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ What's new: ${what}`); } };
    const before = failures;
    const gs = extension_settings.VCRP.globalSettings;
    const gear = tabsUI.findIndex(t => t.title === "Global Settings");
    switchTab(gear);
    check(!$("#vcrp_whats_new").length, "shown on a fresh install");
    delete gs.whatsNewSeen;
    switchTab(gear);
    check($("#vcrp_whats_new").length === 1 && /Import the preset again/.test($("#vcrp_whats_new").text()), "not shown after an update");
    const dot = () => $(`#dot_${gear}`);
    check(dot().length === 1 && dot().hasClass("has-notice"), "no dot on the settings gear");
    $("#vcrp_whats_new_ok").trigger("click");
    await new Promise(r => setTimeout(r, 5));
    check(!$("#vcrp_whats_new").length && gs.whatsNewSeen, "Got it does not dismiss it");
    check(!dot().hasClass("has-notice"), "the dot stays after Got it");
    clicks += 1;
    if (failures === before) console.log("  ✓ What's new: hidden on a fresh install, shown after an update, Got it dismisses it");
}
// Pura Director: the panel appears with a Pura engine (Original with Pura's own controls,
// Adapted without them), settings save, randomisers stop at two (the Director's Cut alone);
// the BLOCKS tab lists Pura's trackers apart, and a reply's Pura block is drawn with Pura's card.
{
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ Pura: ${what}`); } };
    const before = failures;
    const tick = () => new Promise(r => setTimeout(r, 5));
    const box = $("#ps_stage_content");
    const presetsTab = tabsUI.findIndex(t => t.title === "PRESETS & COT");
    const keepMode = p.mode;
    p.pura = {};
    p.mode = "pura-original";
    switchTab(presetsTab);
    const btn = () => box.find('.ws-nav-btn[data-target="sec-pura"]');
    check(btn().length === 1 && !/display:\s*none/.test(btn().attr("style") || ""), "no Pura Director button with a Pura engine selected");
    btn().trigger("click");
    check(box.find("#sec-pura").is(":visible") || box.find("#sec-pura").css("display") !== "none", "the Pura section does not open");
    check(box.find("#pura_user").length === 1 && box.find("#pura_formatting").length === 1 && box.find("#pura_genre").length === 1, "Original: Pura's own controls missing");
    box.find("#pura_voice").val("random").trigger("change");
    box.find("#pura_formatting").prop("checked", false).trigger("change");
    check(p.pura.voice === "random" && p.pura.formatting === false, `settings not saved: ${JSON.stringify(p.pura)}`);
    box.find('.pura_rand[data-key="chaos"]').prop("checked", true).trigger("change"); await tick();
    box.find('.pura_rand[data-key="pressure"]').prop("checked", true).trigger("change"); await tick();
    check(JSON.stringify(p.pura.randomisers) === '["chaos","pressure"]' && box.find('.pura_rand[data-key="kink"]').is(":disabled"), `two randomisers, then the rest locked: ${JSON.stringify(p.pura.randomisers)}`);
    box.find('.pura_rand[data-key="chaos"]').prop("checked", false).trigger("change"); await tick();
    box.find('.pura_rand[data-key="pressure"]').prop("checked", false).trigger("change"); await tick();
    box.find('.pura_rand[data-key="directorsCut"]').prop("checked", true).trigger("change"); await tick();
    check(JSON.stringify(p.pura.randomisers) === '["directorsCut"]' && box.find('.pura_rand[data-key="chaos"]').is(":disabled"), "the Director's Cut stands alone");
    p.mode = "pura-adapted";
    switchTab(presetsTab);
    btn().trigger("click");
    check(box.find("#pura_user").length === 0 && box.find("#pura_formatting").length === 0 && box.find("#pura_voice").length === 1 && box.find("#pura_gooner").length === 1, "Adapted: Pura's formatting controls hidden, its own extras kept");
    p.mode = "v10-core";
    switchTab(presetsTab);
    check(/display:\s*none/.test(btn().attr("style") || ""), "the Pura button shows with a VCRP engine");

    // BLOCKS: Pura's trackers in a group of their own.
    switchTab(tabsUI.findIndex(t => t.title === "BLOCKS"));
    check(box.text().includes("Pura's trackers") && box.find(".blk-pool").last().find(".blk-add").length >= 17, `Pura's trackers not listed apart (${box.find(".blk-pool").last().find(".blk-add").length})`);

    // A reply's Pura block, drawn with Pura's card.
    const { extractBlocks, buildBlocksCard } = await imp("src/blocks/render.js");
    const { meguminRenderRegistry } = await imp("src/features/blocks/registry.js");
    const mes = "Prose.\n<Blocks>\n<Pura_Events>\n[EVENT|⚠️ THREAT|Okafor wants paying|Friday]\ncontext: the ring\n[/EVENT]\n</Pura_Events>\n</Blocks>";
    const found = extractBlocks(mes, meguminRenderRegistry());
    const card = buildBlocksCard(found, { document: w.document });
    const html = card && (card.outerHTML || String(card));
    check(found.length === 1 && /Okafor wants paying/.test(html || "") && /⏳ Friday/.test(html || ""), "a Pura block is not drawn with Pura's card");
    // The card keeps its touches: a sideways scroll on it never reaches SillyTavern's swipe gesture.
    w.document.body.appendChild(card);
    let swipeSaw = 0;
    const saw = () => { swipeSaw++; };
    for (const type of ["touchstart", "touchmove", "touchend"]) w.document.addEventListener(type, saw);
    const inner = card.querySelector("*") || card;
    for (const type of ["touchstart", "touchmove", "touchend"]) inner.dispatchEvent(new w.Event(type, { bubbles: true }));
    for (const type of ["touchstart", "touchmove", "touchend"]) w.document.removeEventListener(type, saw);
    card.remove();
    check(card.getAttribute("data-swipe-ignore") === "true" && swipeSaw === 0, `the blocks card lets a touch through to the swipe gesture (${swipeSaw})`);
    // Reply length (Memory tab): Pura Original's own length; thinking length does not apply.
    p.mode = "pura-original";
    p.pura = { length: "flexible" };
    switchTab(tabsUI.findIndex(t => t.title === "Memory"));
    check(box.find("#vmem_len_pura").length === 1 && box.find("#vmem_len").length === 0 && !box.find("#vmem_think").is(":disabled"), "Reply length: Pura Original's length row, thinking length live");
    box.find("#vmem_len_pura").val("short").trigger("change");
    check(p.pura.length === "short", "Reply length: the story length does not reach Pura's setting");
    p.mode = "pura-adapted";
    switchTab(tabsUI.findIndex(t => t.title === "Memory"));
    check(box.find("#vmem_len").length === 1 && box.find("#vmem_len_pura").length === 0 && !box.find("#vmem_think").is(":disabled"), "Reply length: Adapted uses Story Config's length, thinking length live");

    // Overlap hints: a block and its Pura twin together; VCRP's HTML add-on and Pura's HTML.
    const keepOrder = [...p.blockStack.order];
    p.blockStack.order = ["bonds", "pura_relationship", "pura_npc"];
    switchTab(tabsUI.findIndex(t => t.title === "BLOCKS"));
    check(box.find(".blk-overlap").length === 2 && /Relationships/.test(box.find(".blk-overlap").first().text() + box.find(".blk-overlap").last().text()), `overlap hints: ${box.find(".blk-overlap").length}`);
    p.blockStack.order = keepOrder;
    const keepAddons = p.addons;
    p.addons = ["html"];
    switchTab(presetsTab);
    btn().trigger("click");
    check(box.find("#pura_html_overlap").length === 1, "Pura panel: no note that VCRP's HTML add-on is on too");
    p.addons = keepAddons;

    // Dev Mode: no copy of a Pura engine on offer, and a note saying why.
    const { renderDevMode } = await imp("src/ui/devmode.js");
    renderDevMode("engines");
    const stage = $("#ps_stage_content");
    check(stage.find("#dev_pura_note").length === 1 && !/Pura Director/.test(stage.find(".dev-grid").last().text()), "Dev Mode: Pura engines offered for copying, or no note");

    p.mode = keepMode;
    clicks += 14;
    if (failures === before) console.log("  ✓ Pura: panel per engine, settings saved, randomiser limits, BLOCKS group, Pura's card in the chat (touches kept from the swipe gesture), reply length, overlap hints, Dev Mode");
}
// The Dialogue Colors list (Global Toggles & Add Ons, with the add-on on), Story Config's
// Tense field, and wide content in a message keeping a sideways scroll from the swipe gesture.
{
    const check = (ok, what) => { if (!ok) { failures++; console.log(`  ✗ Colors / Tense / wide content: ${what}`); } };
    const before = failures;
    const tick = () => new Promise(r => setTimeout(r, 5));
    const box = $("#ps_stage_content");
    const meta = globalThis.__ST__.chat_metadata;
    const keepAddons = p.addons;
    const globalTab = tabsUI.findIndex(t => t.title === "Global Toggles & Add Ons");
    p.addons = (p.addons || []).filter(a => a !== "color");
    meta.vcrp_colors = { names: { mara: { name: "Mara", color: "#ff69b4" }, jonah: { name: "Jonah", color: "#abc" } } };
    switchTab(globalTab);
    check(box.find("#vcrp_colors_panel").length === 0, "the colors list shows with the add-on off");
    p.addons = [...p.addons, "color"];
    switchTab(globalTab);
    const rows = () => box.find(".vcrp-color-row");
    check(rows().length === 2 && /Mara/.test(box.find("#vcrp_colors_panel").text()) && rows().last().find(".vcrp-color-pick").val() === "#aabbcc", `the list (${rows().length} rows)`);
    rows().first().find(".vcrp-color-pick").val("#00ff00").trigger("change"); await tick();
    check(meta.vcrp_colors.names.mara.color === "#00ff00", "a new color does not reach the chat's lock");
    rows().last().find(".vcrp-color-forget").trigger("click"); await tick();
    check(!meta.vcrp_colors.names.jonah && rows().length === 1, "Forget does not forget");
    meta.vcrp_colors.names.jonah = { name: "Jonah", color: "#123456" };
    switchTab(globalTab);
    box.find("#vcrp_colors_forget_all").trigger("click"); await tick();
    check(Object.keys(meta.vcrp_colors.names).length === 0 && box.find("#vcrp_colors_empty").length === 1, "Forget all does not empty the list");
    p.addons = keepAddons;
    delete meta.vcrp_colors;

    // Story Config: the Tense field.
    switchTab(tabsUI.findIndex(t => t.title === "PRESETS & COT"));
    check(box.find('.cfg-row[data-key="tense"]').length === 1 && /Tense/.test(box.find('.cfg-row[data-key="tense"]').text()), "no Tense field in Story Config");

    // Pura cost hints: the panel's summary (live) and each setting's line; each Pura tracker's line in BLOCKS.
    const keepMode = p.mode, keepPura = p.pura, keepOrder = [...p.blockStack.order];
    p.mode = "pura-adapted";
    p.pura = {};
    switchTab(tabsUI.findIndex(t => t.title === "PRESETS & COT"));
    box.find('.ws-nav-btn[data-target="sec-pura"]').trigger("click");
    const total = () => box.find("#pura_cost_total").text();
    const first = total();
    check(/tokens cached and ≈ [\d,]+ sent fresh every reply, about \$[\d.]+ a reply once cached on Claude Opus 5\.5/.test(first), `the panel's cost summary: ${first.slice(0, 120)}`);
    check(box.find("#pura_panel .pura-cost").length >= 12 && /Grounded Prose[\s\S]*sent fresh every reply/.test(box.find("#pura_panel").text()), `cost lines: ${box.find("#pura_panel .pura-cost").length}`);
    box.find("#pura_grounded").prop("checked", true).trigger("change"); await tick();
    check(total() !== first, "the summary does not follow a setting");
    box.find("#pura_voice").val("random").trigger("change"); await tick();
    check(/sent fresh every reply/.test(box.find("#pura_cost_voice").text()), "the voice's line does not follow the pick");
    p.blockStack.order = ["pura_scene", "world"];
    switchTab(tabsUI.findIndex(t => t.title === "BLOCKS"));
    check(box.find(".blk-cost").length === 1 && /rules [\d,]+ cached/.test(box.find(".blk-cost").text()) && /Pura's trackers here: ≈ \$/.test(box.find("#blk_pura_cost").text()), `BLOCKS cost lines: ${box.find(".blk-cost").length}`);
    Object.assign(p, { mode: keepMode, pura: keepPura });
    p.blockStack.order = keepOrder;

    // Tone Rules: this chat's, in Global Toggles & Add Ons and in the Pura panel (the same text).
    delete meta.vcrp_tone;
    switchTab(globalTab);
    check(box.find("#global_tone_panel").length === 1 && box.find("#global_tone_closed").length === 1 && !box.find("#global_tone_text").length, "Tone Rules without a chat open: no 'open a chat' note");
    ctx.chatId = "chat-1";
    switchTab(globalTab);
    box.find("#global_tone_on").prop("checked", true).trigger("change");
    box.find("#global_tone_text").val("Bleak. No rescues.").trigger("input"); await tick();
    check(meta.vcrp_tone && meta.vcrp_tone.enabled === true && meta.vcrp_tone.text === "Bleak. No rescues.", `Tone Rules not saved with the chat: ${JSON.stringify(meta.vcrp_tone)}`);
    check(/sent fresh every reply/.test(box.find("#global_tone_cost").text()), "Tone Rules: no cost line");
    const keepToneMode = p.mode;
    p.mode = "pura-adapted";
    switchTab(tabsUI.findIndex(t => t.title === "PRESETS & COT"));
    box.find('.ws-nav-btn[data-target="sec-pura"]').trigger("click");
    check(box.find("#pura_tone_text").val() === "Bleak. No rescues." && box.find("#pura_tone_on").is(":checked") && /Dead Dove Escalation/.test(box.find("#pura_tone_panel").text()), "the Pura panel does not show the same Tone Rules");
    box.find("#pura_tone_text").val("Grim, always.").trigger("input"); await tick();
    switchTab(globalTab);
    check(box.find("#global_tone_text").val() === "Grim, always." && meta.vcrp_tone.text === "Grim, always.", "an edit in the Pura panel does not reach Global Toggles");
    p.mode = keepToneMode;
    delete ctx.chatId;
    delete meta.vcrp_tone;

    // VCRP Quick (wand menu): Tone Rules, the plot focus and Pura's randomisers.
    const quick = await imp("src/vcrp/quickPanel.js");
    const menu = w.document.createElement("div");
    menu.id = "extensionsMenu";
    w.document.body.appendChild(menu);
    quick.vcrpInstallQuickPanel(w.document);
    quick.vcrpInstallQuickPanel(w.document);
    check(menu.querySelectorAll("#vcrp_quick_wand").length === 1 && !w.document.getElementById("vcrp_quick_fab"), "VCRP Quick: not in the wand menu once");
    ctx.chatId = "chat-2";
    meta.vcrp_tone = { enabled: false, text: "Bleak." };
    delete meta.vcrp_focus;   // an earlier check leaves a plot focus on
    const keepQuick = { mode: p.mode, pura: p.pura };
    p.mode = "v10-core";
    w.document.getElementById("vcrp_quick_wand").click();
    const q$ = sel => w.document.querySelector(`#vcrp_quick_overlay ${sel}`);
    // Its own look, whatever style.css the phone has cached: a full-screen layer, the card at the bottom.
    const ov = w.document.getElementById("vcrp_quick_overlay");
    check(ov && ov.style.position === "fixed" && ov.style.top === "0px" && ov.style.bottom === "0px" && ov.style.alignItems === "flex-end" && q$(".vcrp-quick-card").style.maxWidth === "420px" && w.document.getElementById("vcrp-quick-style"), "VCRP Quick: the panel does not carry its own placement and styles");
    check(menu.style.display === "none" || w.$(menu).css("display") === "none", "VCRP Quick: the wand menu is left open behind the panel");
    check(q$(".vcrp-quick-card") && !q$("#vcrp_quick_tone").checked && /appear here while a Pura Director engine/.test(q$(".vcrp-quick-card").textContent), "VCRP Quick: not open, or wrong with a VCRP engine");
    // The one-shot direction box: typing keeps it for the next reply; Clear empties it.
    const shotBox = q$("#vcrp_quick_shot");
    shotBox.value = "She finally tells him.";
    shotBox.dispatchEvent(new w.Event("input", { bubbles: true }));
    shotBox.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick();
    check(meta.vcrp_oneshot && meta.vcrp_oneshot.text === "She finally tells him." && /Goes out with your next reply/.test(q$("#vcrp_quick_shot_desc").textContent), "VCRP Quick: the one-shot direction is not kept");
    quick.refreshQuickPanel(w.document);
    q$("#vcrp_quick_shot_clear").click(); await tick();
    check(meta.vcrp_oneshot.text === "" && q$("#vcrp_quick_shot").value === "", "VCRP Quick: Clear does not empty the one-shot direction");
    q$("#vcrp_quick_tone").click(); await tick();
    check(meta.vcrp_tone.enabled === true && q$("#vcrp_quick_tone").checked, "VCRP Quick: Tone Rules not switched on");
    q$("#vcrp_quick_plot").click(); await tick(); await tick();
    const { peekFocusState } = await imp("src/vcrp/focus/index.js");
    check(peekFocusState() && peekFocusState().plot && peekFocusState().plot.active === true, "VCRP Quick: plot focus not switched on");
    p.mode = "pura-adapted";
    p.pura = { randomisers: [] };
    quick.refreshQuickPanel(w.document);
    const chip = k => q$(`.vcrp_quick_rand[data-key="${k}"]`);
    check(w.document.querySelectorAll("#vcrp_quick_overlay .vcrp_quick_rand").length === 8, "VCRP Quick: Pura's randomisers missing with a Pura engine");
    chip("deadDove").click(); await tick();
    chip("chaos").click(); await tick();
    check(JSON.stringify(p.pura.randomisers) === '["deadDove","chaos"]' && chip("kink").disabled && chip("directorsCut").disabled, `VCRP Quick: randomiser limits (${JSON.stringify(p.pura.randomisers)})`);
    chip("deadDove").click(); await tick();
    check(JSON.stringify(p.pura.randomisers) === '["chaos"]' && !chip("kink").disabled, "VCRP Quick: unticking does not free a slot");
    q$("#vcrp_quick_close").click();
    check(!w.document.getElementById("vcrp_quick_overlay"), "VCRP Quick: Close does not close it");
    quick.openQuickPanel(w.document);
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    check(!w.document.getElementById("vcrp_quick_overlay"), "VCRP Quick: Escape does not close it");
    // Where the browser has modal dialogs (every current one; jsdom lacks them, so stubbed here):
    // a dialog in the top layer, held to the bottom; Escape or the back gesture ("cancel") closes it.
    const proto = w.HTMLDialogElement.prototype;
    proto.showModal = function () { this.setAttribute("open", ""); };
    proto.close = function () { this.removeAttribute("open"); };
    quick.openQuickPanel(w.document);
    const dlg = w.document.getElementById("vcrp_quick_overlay");
    check(dlg && dlg.tagName === "DIALOG" && dlg.hasAttribute("open") && /margin: auto auto 12px/.test(dlg.getAttribute("style")) && dlg.querySelector(".vcrp-quick-card #vcrp_quick_shot"), "VCRP Quick: not opened as a modal dialog where the browser has them");
    dlg.dispatchEvent(new w.Event("cancel", { cancelable: true }));
    check(!w.document.getElementById("vcrp_quick_overlay"), "VCRP Quick: the dialog's cancel (Escape, back gesture) does not close it");
    delete proto.showModal;
    delete proto.close;
    const bare = w.document.implementation.createHTMLDocument("bare");
    quick.vcrpInstallQuickPanel(bare, { fallback: false });
    check(!bare.getElementById("vcrp_quick_fab"), "VCRP Quick: a button before SillyTavern is ready (its menu may still come)");
    quick.vcrpInstallQuickPanel(bare);
    check(bare.getElementById("vcrp_quick_fab"), "VCRP Quick: no button when SillyTavern has no wand menu");
    const late = bare.createElement("div");
    late.id = "extensionsMenu";
    bare.body.appendChild(late);
    quick.vcrpInstallQuickPanel(bare);
    check(!bare.getElementById("vcrp_quick_fab") && late.querySelector("#vcrp_quick_wand"), "VCRP Quick: a wand menu that turns up later does not take over from the button");
    menu.remove();
    Object.assign(p, keepQuick);
    delete ctx.chatId;
    delete meta.vcrp_tone;
    delete meta.vcrp_focus;

    // Each reply's cost: its badge under the avatar, and the switch in the Memory tab.
    const cost = await imp("src/vcrp/replyCost.js");
    const chatBox = w.document.getElementById("chat");
    const keepBox = chatBox.innerHTML;
    chatBox.innerHTML = `<div class="mes" mesid="1"><div class="mesAvatarWrapper"><div class="avatar"></div></div><div class="mes_block"><div class="mes_text">x</div></div></div>`;
    chat[1].extra = { vcrp_cost: { total: 0.0123, output: 800, parts: 1, cold: false, model: "Claude Opus 5.5", tokens: { read: 30000, write: 2000, plain: 500 }, pieces: { read: 0.006, write: 0.002, plain: 0.0002, output: 0.0041 } } };
    cost.drawCostBadge(1, w.document);
    cost.drawCostBadge(1, w.document);
    const badge = () => chatBox.querySelectorAll(".mesAvatarWrapper .vcrp-cost-badge");
    check(badge().length === 1 && badge()[0].textContent === "≈ $0.012" && /cache warm/.test(badge()[0].title), `the cost badge: ${badge().length} ${badge()[0] && badge()[0].textContent}`);
    switchTab(tabsUI.findIndex(t => t.title === "Memory"));
    box.find("#vmem_cost_badges").prop("checked", false).trigger("change");
    check(badge().length === 0, "switching the cost off does not take the badges away");
    box.find("#vmem_cost_badges").prop("checked", true).trigger("change");
    check(badge().length === 1, "switching the cost on does not bring the badges back");
    chatBox.innerHTML = keepBox;
    delete chat[1].extra;

    // Wide content in a message: a touch on it never reaches the swipe gesture; ordinary text does.
    const { vcrpInstallSwipeGuard } = await imp("src/vcrp/swipeGuard.js");
    const chatEl = w.document.getElementById("chat");
    const keepChat = chatEl.innerHTML;
    chatEl.innerHTML = `<div class="mes"><div class="mes_text"><p id="sg_plain">Prose.</p><div id="sg_wide" style="overflow-x:auto;"><span id="sg_in">A wide terminal</span></div><div id="sg_clip" style="overflow-x:hidden;"><span id="sg_clip_in">clipped</span></div><div id="sg_fits" style="overflow-x:auto;"><span id="sg_fits_in">fits</span></div></div></div><div id="sg_outside" style="overflow-x:auto;"><span id="sg_out_in">x</span></div>`;
    for (const id of ["sg_wide", "sg_clip", "sg_outside"]) {
        const el = w.document.getElementById(id);
        Object.defineProperty(el, "scrollWidth", { value: 900, configurable: true });
        Object.defineProperty(el, "clientWidth", { value: 360, configurable: true });
    }
    check(vcrpInstallSwipeGuard(w.document) && vcrpInstallSwipeGuard(w.document) && chatEl.getAttribute("data-vcrp-swipe-guard") === "1", "the guard does not install on the chat");
    let seen = 0;
    const saw = () => { seen++; };
    w.document.addEventListener("touchstart", saw);
    const touch = id => { seen = 0; w.document.getElementById(id).dispatchEvent(new w.Event("touchstart", { bubbles: true })); return seen; };
    check(touch("sg_in") === 0, "a touch on wide content that scrolls reaches the swipe gesture");
    check(touch("sg_plain") === 1 && touch("sg_clip_in") === 1 && touch("sg_fits_in") === 1 && touch("sg_out_in") === 1, "a touch on ordinary text, clipped or fitting content, or outside a message no longer reaches the swipe gesture");
    w.document.removeEventListener("touchstart", saw);
    chatEl.innerHTML = keepChat;
    clicks += 5;
    if (failures === before) console.log("  ✓ Dialogue Colors list (shown with the add-on, change, forget, forget all), Story Config's Tense, Pura cost hints (panel summary live, each setting, BLOCKS lines), Tone Rules (per chat, same text in both places), VCRP Quick (wand menu, one-shot direction, Tone Rules, plot focus, Pura's randomisers and their limits), each reply's cost badge and its switch, wide content keeps its sideways scroll from the swipe gesture");
}
console.log(`  (${clicks} clicks across all tabs)`);
await new Promise(r => setTimeout(r, 200)); // let async handlers settle
if (errors.length) console.log("  late console.error:", errors.slice(-3).join(" | ").slice(0, 400));

// Dev Mode views.
for (const view of ["landing", "editor"]) {
    const before = errors.length;
    try {
        renderDevMode(view, view === "editor" ? "v10-core" : null);
        await new Promise(r => setTimeout(r, 5));
        const ok = errors.length === before;
        if (!ok) failures++;
        console.log(`  ${ok ? "✓" : "✗"} Dev Mode "${view}"${ok ? "" : ": " + errors.slice(before).join(" | ").slice(0, 300)}`);
    } catch (e) { failures++; console.log(`  ✗ Dev Mode "${view}": THREW ${e.stack.split("\n").slice(0, 3).join(" / ")}`); }
}

console.error = origError;
console.log(failures ? `\n${failures} UI PROBLEM(S)` : "\nALL TABS RENDER CLEANLY");
process.exit(failures ? 1 : 0);
