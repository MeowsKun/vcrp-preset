// Behaviour test: builds prompts from the VCRP V10 presets and runs them through the extension's
// own prompt interceptor, with a stubbed SillyTavern. Run from the repo root:  node tools/test_fork.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { REPO, buildFakeTree, installBrowserGlobals } from "./st_stub.mjs";

// ── Fake SillyTavern state ───────────────────────────────────────────────────
const extension_settings = {};
const chatCompletionSettings = { chat_completion_source: "claude", claude_model: "claude-opus-5-5" };
const chat = [];
const ctx = {
    characters: [{ avatar: "alice.png", name: "Alice", data: {} }], characterId: 0, groupId: null, groups: [],
    chat, chatMetadata: {}, name1: "Bob", name2: "Alice", chatCompletionSettings,
    extensionSettings: extension_settings, eventSource: { on() {}, emit: async () => {} },
};
const substituteParams = s => String(s).replaceAll("{{user}}", "Bob").replaceAll("{{char}}", "Alice")
    .replaceAll("{{description}}", "Alice is a barista.").replaceAll("{{personality}}", "").replaceAll("{{scenario}}", "");
let quietHook = null;
globalThis.__ST__ = {
    extension_settings, getContext: () => ctx, substituteParams,
    saveSettingsDebounced() {}, saveMetadata() {}, saveChat() {}, chat_metadata: {}, isGenerating: () => false,
    debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now",
    generateQuietPrompt: async () => { const m = [{ role: "system", content: "main preset" }, { role: "user", content: "___PS_DUMMY___" }]; await quietHook(m); return JSON.stringify(m); },
    event_types: new Proxy({}, { get: (t, k) => String(k) }), eventSource: { on() {}, once() {}, emit: async () => {}, removeListener() {} },
};
installBrowserGlobals();
globalThis.extension_settings = extension_settings;

const { ext } = buildFakeTree("test-fork");
const imp = p => import(pathToFileURL(join(ext, p)).href);
const { handlePromptInjection } = await imp("src/engine/injection.js");
const { initProfile } = await imp("src/core/profile.js");
const state = await imp("src/core/state.js");
const { vcrpSetGenerationType } = await imp("src/vcrp/generation.js");
const { runMeguminTask } = await imp("src/engine/tasks.js");
quietHook = msgs => handlePromptInjection({ chat: msgs, dryRun: false });

initProfile();
const p = state.localProfile;
assert(p && extension_settings.VCRP, "profile should live under extension_settings.VCRP");
Object.assign(p, { mode: "v10-core", model: "cot-v10-ukiyo-english", cotEnabled: true });
console.log("0 ok  profile initialised under the VCRP key; knowledgebase seeded:", p.knowledgebase.entries.length, "entries");

// ── Prompt builder (what ST hands to CHAT_COMPLETION_PROMPT_READY, roughly) ──
function buildPrompt(presetFile, { history = 3 } = {}) {
    const preset = JSON.parse(readFileSync(join(REPO, "Presets", presetFile), "utf8"));
    const byId = Object.fromEntries(preset.prompts.map(x => [x.identifier, x]));
    const out = [];
    for (const o of preset.prompt_order.find(x => x.character_id === 100001).order) {
        if (!o.enabled) continue;
        const q = byId[o.identifier];
        if (!q) continue;
        if (q.identifier === "chatHistory") {
            for (let i = 1; i <= history; i++) {
                out.push({ role: "user", content: `user msg ${i}` });
                out.push({ role: "assistant", content: `<think>plan ${i}</think>\nScene prose ${i}.` });
            }
            out.push({ role: "user", content: "latest user msg" });
            continue;
        }
        const role = q.marker ? "system" : q.role || "system";
        const content = q.marker ? `[${q.name}]` : substituteParams(q.content || "");
        if (!content) continue;
        if (role === "system" && out.at(-1)?.role === "system") out.at(-1).content += "\n" + content;
        else out.push({ role, content });
    }
    return out;
}
const text = msgs => msgs.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
const leftovers = msgs => [...text(msgs).matchAll(/\[\[[A-Za-z0-9_ \-]+\]\]/g)].map(m => m[0]);
async function run(presetFile, type = "normal") {
    vcrpSetGenerationType(type, {}, false);
    const msgs = buildPrompt(presetFile);
    await handlePromptInjection({ chat: msgs, dryRun: false });
    return msgs;
}

for (const preset of ["VCRP V10 Universal.json", "VCRP V10 Universal Cache Friendly.json"]) {
    const tag = preset.includes("Cache") ? "CF " : "STD";
    extension_settings.VCRP.globalSettings = extension_settings.VCRP.globalSettings || {};
    p.addons = []; p.knowledgebase.enabled = false; p.animeMode.enabled = false;

    // 1. Normal reply on Claude Opus 5.5: no prefill, nothing left over.
    chatCompletionSettings.chat_completion_source = "claude"; chatCompletionSettings.claude_model = "claude-opus-5-5";
    let msgs = await run(preset);
    assert.deepEqual(leftovers(msgs), [], `${tag}: tags left over: ${leftovers(msgs)}`);
    assert(text(msgs).includes("You are the narrator of an ongoing prose story"), `${tag}: Ukiyo engine missing`);
    assert(text(msgs).includes("Writer's Mind"), `${tag}: Ukiyo CoT missing`);
    assert.notEqual(msgs.at(-1).role, "assistant", `${tag}: prefill must be dropped for Claude 5`);
    assert(!msgs.some(m => typeof m.content === "string" && !m.content.trim()), `${tag}: empty message left`);
    assert(!text(msgs).includes("<bold_npcs>") && !text(msgs).includes("<knowledgebase>") && !text(msgs).includes("<anime_mode>"), `${tag}: off features leaked`);
    console.log(`1 ok  ${tag} Ukiyo on Claude 5: clean, no prefill`);

    // 2. Gemini Pro keeps the prefill.
    chatCompletionSettings.chat_completion_source = "makersuite"; chatCompletionSettings.google_model = "gemini-2.5-pro";
    msgs = await run(preset);
    assert.equal(msgs.at(-1).role, "assistant", `${tag}: Gemini Pro should keep the prefill`);
    assert(msgs.at(-1).content.includes("<think>"), `${tag}: prefill content`);
    extension_settings.VCRP.globalSettings.cotPrefillMode = "off";
    msgs = await run(preset);
    assert.notEqual(msgs.at(-1).role, "assistant", `${tag}: "Always off" must drop the prefill`);
    extension_settings.VCRP.globalSettings.cotPrefillMode = "auto";
    console.log(`2 ok  ${tag} Gemini Pro prefill kept; "Always off" respected`);

    // 3. Knowledgebase, Anime Mode, Bold NPCs.
    p.knowledgebase.enabled = true; p.animeMode.enabled = true; p.addons = ["bold_npcs"];
    msgs = await run(preset);
    const t3 = text(msgs);
    assert.deepEqual(leftovers(msgs), [], `${tag}: tags left over with features on: ${leftovers(msgs)}`);
    for (const s of ["<knowledgebase>", "Writing Quality Baseline", "<anime_mode>", "overrides the engine's dialogue restrictions", "<bold_npcs>", "Also keep in mind the knowledgebase entries", "should read distinctly anime"])
        assert(t3.includes(s), `${tag}: missing ${s}`);
    assert(t3.includes("allowed for stammers, cut-offs") && t3.includes("stripped articles"), `${tag}: merged ban list`);
    console.log(`3 ok  ${tag} knowledgebase + anime + bold NPCs + merged ban list`);

    // 4. Continue / Impersonate / quiet: no reply format, no prefill.
    for (const type of ["continue", "impersonate", "quiet"]) {
        msgs = await run(preset, type);
        const t4full = text(msgs);
        // The mode note itself mentions <think>/<Blocks>; check everything else.
        const t4 = t4full.split("\n").filter(l => !l.startsWith("[Continue your") && !l.startsWith("[For this one message")).join("\n");
        assert.deepEqual(leftovers(msgs), [], `${tag} ${type}: tags left over`);
        for (const bad of ["Writer's Mind", "<Blocks>", "<dice_rules>"]) assert(!t4.includes(bad), `${tag} ${type}: reply format leaked (${bad}): ...${t4.slice(Math.max(0, t4.indexOf(bad) - 300), t4.indexOf(bad) + 100)}`);
        assert(!(msgs.at(-1).role === "assistant" && msgs.at(-1).content.includes("<think>")), `${tag} ${type}: prefill leaked`);
        if (type !== "quiet") assert(t4full.includes(type === "continue" ? "Continue your previous reply exactly" : "write Bob's next turn"), `${tag} ${type}: note missing`);
    }
    console.log(`4 ok  ${tag} continue / impersonate / quiet`);
    p.knowledgebase.enabled = false; p.animeMode.enabled = false; p.addons = [];
}

// 5. Other presets are left alone (no tags → no note, no message removal).
vcrpSetGenerationType("continue", {}, false);
const other = [{ role: "system", content: "some other preset" }, { role: "assistant", content: "" }, { role: "user", content: "hi" }];
await handlePromptInjection({ chat: other, dryRun: false });
assert.equal(other.length, 3, "a non-VCRP prompt must not be modified");
console.log("5 ok  non-VCRP prompts untouched");

// 6. Story Config's AI helpers (runMeguminTask) no longer need an Engine preset.
vcrpSetGenerationType("quiet", {}, false);
const raw = await runMeguminTask("Write a writing style rule based on: noir.");
const sent = JSON.parse(raw);
assert(sent.some(m => m.content.includes("Write a writing style rule based on: noir.")), "order text not sent");
assert(sent.some(m => m.content.includes("Alice is a barista.")), "character description not sent");
assert(!sent.some(m => m.content.includes("___PS_DUMMY___") || m.content === "main preset"), "main preset leaked into the task");
console.log("6 ok  Story Config AI tasks build their own prompt (no Engine preset)");

console.log("\nALL FORK CHECKS PASSED");
