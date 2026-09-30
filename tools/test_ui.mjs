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
if (p.memoryCore) p.memoryCore.enabled = true;
if (p.storyPlan) p.storyPlan.enabled = true;
p.banList = ["no purple prose"];
await renderAll("all on");

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
