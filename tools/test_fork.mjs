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
let quietImpl = null;   // a test can stand in for the model on quiet calls
globalThis.__ST__ = {
    extension_settings, getContext: () => ctx, substituteParams,
    saveSettingsDebounced() {}, saveMetadata() {}, saveChat() {}, chat_metadata: {}, isGenerating: () => false,
    debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now",
    generateQuietPrompt: async (...a) => { if (quietImpl) return quietImpl(...a); const m = [{ role: "system", content: "main preset" }, { role: "user", content: "___PS_DUMMY___" }]; await quietHook(m); return JSON.stringify(m); },
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
// SillyTavern's quiet generation: the instruction is a system message added at the very end,
// after the preset's after-chat slots; with "squash system messages" on (the VCRP preset sets
// it) it merges into a system message right before it. The CoT Prefill slot, when on, sits
// between them, so the two layouts differ by that slot.
function buildQuietPrompt(presetFile, quietPrompt, { prefillSlot = true } = {}) {
    const msgs = buildPrompt(presetFile);
    if (!prefillSlot && msgs.at(-1)?.role === "assistant") msgs.pop();
    if (msgs.at(-1)?.role === "system") msgs.at(-1).content += "\n" + quietPrompt;
    else msgs.push({ role: "system", content: quietPrompt });
    return msgs;
}
const text = msgs => msgs.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
const leftovers = msgs => [...text(msgs).matchAll(/\[\[[A-Za-z0-9_ \-]+\]\]/g)].map(m => m[0]);
async function run(presetFile, type = "normal") {
    vcrpSetGenerationType(type, {}, false);
    const msgs = buildPrompt(presetFile);
    await handlePromptInjection({ chat: msgs, dryRun: false });
    return msgs;
}

for (const preset of ["VCRP V10 Universal.json"]) {
    const tag = "STD";
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
    // No writing style picked: the engine's "voice:" line has nothing to say and goes.
    for (const mode of [["v10-core", "cot-v10-ukiyo-english"], ["v10-shura", "cot-v10-shura-english"]]) {
        const keep = [p.mode, p.model, p.aiRule];
        [p.mode, p.model, p.aiRule] = [...mode, ""];
        msgs = await run(preset);
        assert(!/^\s*- (\*\*)?voice:(\*\*)?\s*$/m.test(text(msgs)), `${tag}: empty voice line left (${mode[0]})`);
        p.aiRule = "Dry and patient.";
        msgs = await run(preset);
        assert(text(msgs).includes("Dry and patient."), `${tag}: writing style lost (${mode[0]})`);
        [p.mode, p.model, p.aiRule] = keep;
    }
    msgs = await run(preset);
    assert(text(msgs).includes("Open every reply with your own <think> block"), `${tag}: think instruction missing`);
    assert(text(msgs).includes("3. NEVER write Bob's actions, speech, thoughts, or feelings."), `${tag}: never-write-for-user reminder missing`);
    console.log(`1 ok  ${tag} Ukiyo on Claude 5: clean, no prefill, no empty voice line`);

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
    for (const s of ["<knowledgebase>", "Character Trope Guidance", "<anime_mode>", "overrides the engine's dialogue restrictions", "<bold_npcs>", "Also keep in mind the knowledgebase entries", "should read distinctly anime"])
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
        assert(!t4.includes("Open every reply with your own <think>"), `${tag} ${type}: think instruction leaked`);
        if (type === "impersonate") assert(!t4.includes("NEVER write Bob's actions"), `${tag}: never-write-for-user reminder must go on impersonate`);
    }
    // Continue with SillyTavern's "Continue prefill": the partial reply is the LAST message and
    // the model continues from it, so the mode note must sit before it, never after.
    vcrpSetGenerationType("continue", {}, false);
    msgs = buildPrompt(preset);
    msgs.push({ role: "assistant", content: "Alice turned toward the door and" });
    await handlePromptInjection({ chat: msgs, dryRun: false });
    assert.equal(msgs.at(-1).content, "Alice turned toward the door and", `${tag}: continued text must stay last`);
    assert(msgs.at(-2).content.startsWith("[Continue your previous reply exactly"), `${tag}: continue note must sit right before it`);
    console.log(`4 ok  ${tag} continue / impersonate / quiet (+ continue-prefill ordering)`);
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

// 7. Setup health check.
const { vcrpHealthCheck } = await imp("src/vcrp/health.js");
const presetJson = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
ctx.mainApi = "openai";
Object.assign(chatCompletionSettings, {
    preset_settings_openai: "VCRP V10 Universal", prompts: presetJson.prompts, prompt_order: presetJson.prompt_order,
    extensions: presetJson.extensions,
});
let hc = vcrpHealthCheck();
assert(hc.items.some(i => i.level === "error" && /not allowed/.test(i.title)), "health: regex not yet allowed should be an error");
extension_settings.preset_allowed_regex = { openai: ["VCRP V10 Universal"] };
hc = vcrpHealthCheck();
assert.equal(hc.errors, 0, `health: no errors expected once allowed: ${JSON.stringify(hc.items)}`);
presetJson.extensions.regex_scripts.find(r => r.scriptName === "Blocks cleanup").disabled = true;
hc = vcrpHealthCheck();
assert(hc.items.some(i => i.level === "error" && /Blocks cleanup/.test(i.title)), "health: disabled essential regex should be an error");
chatCompletionSettings.prompts = [{ identifier: "main", content: "some other preset" }];
chatCompletionSettings.preset_settings_openai = "Default";
hc = vcrpHealthCheck();
assert(hc.items.some(i => i.level === "error" && /not a VCRP preset/.test(i.title)), "health: non-VCRP preset should be an error");
ctx.mainApi = "textgenerationwebui";
hc = vcrpHealthCheck();
assert(hc.items.some(i => /Chat Completion/.test(i.title) && i.level === "error"), "health: text completion should be an error");
console.log("7 ok  setup health check (preset, regex allowed/disabled, API type)");

// 8. Knowledgebase: shared entries + import.
const kbMod = await imp("src/vcrp/knowledgebase.js");
p.knowledgebase.enabled = true;
p.knowledgebase.entries = [{ id: "a", title: "Own Rule", content: "own content", active: true, triggers: "" }];
kbMod.getSharedKnowledgebase().entries = [{ id: "b", title: "Shared Rule", content: "shared content", active: true, triggers: "" }];
let kbText = kbMod.buildKnowledgebase(p).block;
assert(kbText.includes("own content") && kbText.includes("shared content"), "kb: own + shared entries both injected");
p.knowledgebase.enabled = false;
assert.equal(kbMod.buildKnowledgebase(p).block, "", "kb: nothing injected when the knowledgebase is off");
p.knowledgebase.enabled = true;
const res = kbMod.importKnowledgebaseData({ format: "vcrp-knowledgebase", entries: [
    { title: "Own Rule", content: "own content" },                 // duplicate of an own entry -> skipped
    { title: "New Own", content: "x", triggers: "magic" },          // -> own list
    { title: "New Shared", content: "y", shared: true },            // -> shared list
    { title: "Empty", content: "   " },                             // empty -> skipped
] }, p);
assert.deepEqual(res, { added: 2, skipped: 2 }, "kb import counts");
assert(p.knowledgebase.entries.some(e => e.title === "New Own") && kbMod.getSharedKnowledgebase().entries.some(e => e.title === "New Shared"), "kb import targets");
assert.throws(() => kbMod.importKnowledgebaseData({ nope: 1 }, p), /not a VCRP knowledgebase export/);
console.log("8 ok  knowledgebase shared entries + import (dedupe, targets, bad file)");

// 9. Settings backup/restore.
const backup = await imp("src/vcrp/settingsBackup.js");
const snapshot = JSON.parse(JSON.stringify(extension_settings.VCRP));
snapshot.globalSettings = { ...(snapshot.globalSettings || {}), cotPrefillMode: "off" };
snapshot.profiles.default.language_marker = "restored";
extension_settings.VCRP.globalSettings.cotPrefillMode = "on";
backup.applySettingsImport({ format: "vcrp-settings", version: 1, settings: snapshot });
assert.equal(extension_settings.VCRP.globalSettings.cotPrefillMode, "off", "import replaced global settings");
assert.equal(extension_settings.VCRP.profiles.default.language_marker, "restored", "import replaced profiles");
assert.throws(() => backup.applySettingsImport({ format: "vcrp-knowledgebase", entries: [] }), /knowledgebase export/);
assert.throws(() => backup.applySettingsImport({ format: "vcrp-settings", settings: {} }), /no profiles/);
assert.throws(() => backup.applySettingsImport({ random: true }), /not a VCRP settings export/);
console.log("9 ok  settings backup/restore (replace, wrong file types rejected)");

// 10. Token breakdown rows.
const { groupPromptRows, buildTokenBreakdown } = await imp("src/vcrp/tokenBreakdown.js");
const rows = groupPromptRows([
    { role: "system", content: "Engine rules\nmore" },
    { role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "next" },
    { role: "system", content: "Output RULES" },
    { role: "assistant", content: [{ type: "text", text: "<think>" }, { type: "image_url", image_url: {} }] },
]);
assert.deepEqual(rows.map(r => r.label), ["SYSTEM: Engine rules", "Chat history (3 messages)", "SYSTEM: Output RULES", "ASSISTANT: <think>"], "breakdown rows");
assert.equal(rows[3].images, 1, "breakdown counts images");
const html = await buildTokenBreakdown([{ role: "system", content: "x".repeat(380) }, { role: "user", content: "<b>tag</b>" }]);
assert(html.includes("Token breakdown") && html.includes("&lt;b&gt;tag&lt;/b&gt;") && !html.includes("<b>tag</b>"), "breakdown renders and escapes labels");
console.log("10 ok token breakdown (grouping, images, escaping)");

// 11. NPC Bank: saved field hints upgrade only when unedited; retrieved NPCs and the ignore list.
{
    const stored = Object.values(extension_settings.VCRP.profiles).find(x => x && x.npcBank);
    const field = id => stored.npcBank.fields.find(f => f.id === id);
    field("voice").placeholder = "How they speak — cadence, accent, verbal tics, topics they dodge";   // old default
    field("whereToFind").placeholder = "My own hint, keep it";                                              // reader's edit
    initProfile();
    const q = state.localProfile;
    const now = id => q.npcBank.fields.find(f => f.id === id).placeholder;
    assert.equal(now("voice"), "How they speak: cadence, accent, verbal tics, topics they dodge", "unedited old hint upgrades");
    assert.equal(now("whereToFind"), "My own hint, keep it", "a hint the reader wrote is left alone");

    Object.assign(q, { mode: "v10-shura", model: "cot-v10-shura-english" });
    q.npcBank.enabled = true;
    q.npcBank.npcs = [{ name: "Mara Voss", appearance: "tall, red hair" }];
    chat.push({ is_user: true, mes: "I ask Mara Voss for a drink.", name: "Bob" });
    const t11 = text(await run("VCRP V10 Universal.json"));
    chat.pop();
    assert(t11.includes('<npc name="Mara Voss">') && t11.includes("</npc>"), "retrieved NPC uses an attribute tag");
    assert(!/\*\*(Age|Sex|Orientation):\*\* \?/.test(t11), "unknown vitals are left out");
    assert(/already-known or ignored characters: [^\]]*Alice[^\]]*Bob/.test(t11), "the card character and the user are on the ignore list");
    assert(t11.includes("A job never disqualifies anyone") && !t11.includes("inner_circle_rule"), "dossier rules updated");
    const dossier = t11.slice(t11.indexOf("### NPC DOSSIER"), t11.indexOf("### NPC UPDATES"));
    assert(!dossier.includes("—"), "em dash in the dossier rules: " + dossier.split("\n").filter(l => l.includes("—")).join(" / "));
    q.npcBank.enabled = false; q.npcBank.npcs = [];
}
console.log("11 ok NPC Bank (hint upgrade, attribute tags, no '?' vitals, ignore list, rules)");

// 12. Blocks: Choices guidance, sidebar rule, per-block stat example, chatter cap untouched.
{
    const q = state.localProfile;
    const { meguminSyncLegacyBlockIds } = await imp("src/features/blocks/registry.js");
    const keep = JSON.stringify(q.blockStack.order);
    q.blockStack.order = ["cyoa", "chatter", "bonds", "sheet"]; meguminSyncLegacyBlockIds();
    const t12 = text(await run("VCRP V10 Universal.json"));
    assert(t12.includes("each written as Bob's next message"), "Choices guidance present");
    assert(t12.includes("The blocks are a sidebar for the reader"), "sidebar rule in the <Blocks> header");
    const sheet = t12.slice(t12.indexOf("<Character_Sheet>"), t12.indexOf("</Character_Sheet>"));
    const bonds = t12.slice(t12.indexOf("<Bonds>"), t12.indexOf("</Bonds>"));
    assert(sheet.includes("(-12 a knife across the forearm)") && !sheet.includes("heard pity"), "sheet has its own example");
    assert(bonds.includes("(-6 he apologised and she heard pity)"), "bonds keeps the feeling example");
    assert(t12.includes("max Length is 30 words.") && t12.includes("inside that character's head: stray feelings"), "chatter cap as V10, damage repaired");
    const { parseChoices } = await imp("src/blocks/render.js");
    const parsed = parseChoices("[Four things Bob could do next.]\n1. Ask Mara about the debt\n2. Leave\n3. Order a drink\n4. Wait");
    assert(parsed && parsed.choices.length === 4, "a Choices body with the guidance line still parses as four choices");
    q.blockStack.order = JSON.parse(keep); meguminSyncLegacyBlockIds();
}
console.log("12 ok blocks (choices guidance, sidebar rule, stat examples, chatter cap)");

// 13. Features round: KB upgrade of untouched defaults, wording, conflicts.
{
    // Plant the old built-in KB entries in the saved profile, one of them edited, and reload.
    const stored = Object.values(extension_settings.VCRP.profiles).find(x => x && x.npcBank);
    const oldHyp = "Use this framework whenever hypnosis, trance, or conditioning appears in the story. Adjust or delete if your setting works differently.\n\n- Induction: x";
    stored.knowledgebase = { enabled: true, seeded: true, entries: [] };
    stored.knowledgebase.entries = [
        { id: "kb_default_writing", title: "Writing Quality Baseline", content: "Always show through concrete action, sensation, and behavior rather than naming emotions outright. Avoid abstract summary (\"she felt nervous\") in favor of physical evidence (\"her thumb worried the hem of her sleeve\"). Keep prose grounded and specific: real textures, weights, temperatures, sounds. No purple prose, no recycled clichés, no melodrama. Every paragraph should advance the scene, reveal character, or deepen sensation, never tread water.", active: true },
        { id: "kb_default_hypnosis", title: "Hypnosis Mechanics (example)", content: oldHyp, active: true },
    ];
    initProfile();
    let q = state.localProfile;
    assert(!q.knowledgebase.entries.some(e => e.id === "kb_default_writing"), "untouched writing baseline is removed");
    assert.equal(q.knowledgebase.entries[0].content, oldHyp, "an edited hypnosis entry is left alone");
    const { ensureKnowledgebase } = await imp("src/vcrp/knowledgebase.js");
    const fresh = ensureKnowledgebase({});
    assert(fresh.entries.length === 2 && !fresh.entries.some(e => /Adjust or delete/.test(e.content)), "new profiles get the trimmed defaults");

    Object.assign(q, { mode: "v10-shura", model: "cot-v10-shura-english" });
    q.addons = ["bold_npcs", "dn", "html"];
    q.animeMode.enabled = true;
    q.onomatopoeia = { enabled: true, useStyling: true };
    q.enhancedDialogue = { "v10-shura": true };
    q.storyPlan.enabled = true; q.storyPlan.currentPlan = "Mara's brother arrives.";
    const t13 = text(await run("VCRP V10 Universal.json"));
    for (const s of ["the action lands", "interleave them freely", "must be animated and colored", "freezes the world for a moment",
                     "flows like real talk", "Ban chained clauses", "compass, not a script: weave"])
        assert(t13.includes(s), `missing: ${s}`);
    assert(!/\ba beat\b(?! late)/.test(t13.slice(t13.indexOf("<anime_mode>"), t13.indexOf("</anime_mode>"))), "anime mode no longer says 'a beat'");
    const enh = t13.slice(t13.indexOf("*ALL rules in this tag ONLY apply"), t13.indexOf("Reference Examples"));
    assert(!enh.replace(/"[^"]*"/g, "").includes("—"), "no em dashes in Enhanced Dialogue's instruction text");
    q.addons = []; q.animeMode.enabled = false; q.onomatopoeia = { enabled: false }; q.enhancedDialogue = {}; q.storyPlan.enabled = false;
}
console.log("13 ok features (KB upgrade, add-ons, anime, enhanced dialogue, director)");

// 14. Ukiyo pass: conflicts fixed, duplicates trimmed, no em dashes outside example speech.
{
    const q = state.localProfile;
    for (const model of ["cot-v10-ukiyo-english", "cot-v10-ukiyo-cap-english"]) {
        Object.assign(q, { mode: "v10-core", model });
        const msgs = await run("VCRP V10 Universal.json");
        const own = msgs.filter(m => typeof m.content === "string" && !/^(user|Scene prose|<think>plan)/.test(m.content)).map(m => m.content).join("\n");
        for (const s of ["if it stays, it stays because the scene asked for it", "only place for choices", "never a menu in the prose",
                         "the woman in the green coat", "a correction that arrives a moment too late", "not the same pronoun twice running"])
            assert(own.includes(s), `Ukiyo (${model}) missing: ${s}`);
        assert(!own.includes("Do not repeat last turn's temperature"), "old temperature rule gone");
        assert(!own.includes("invention fills only what the sheet leaves silent"), "people canon trimmed");
        assert(!own.includes("bereavement, betrayal, and humiliation"), "grief not said twice");
        const dashes = own.replace(/"[^"\n]*"/g, "").match(/—/g) || [];
        assert.equal(dashes.length, 0, `Ukiyo (${model}): em dashes outside quoted speech`);
    }
}
console.log("14 ok Ukiyo (temperature, menu, strangers, trims, no em dashes)");

// 15. OpenRouter hoists system messages to the front for Claude: VCRP sends everything after
//     the opening system run as user messages there, and only there.
{
    const keep = { ...chatCompletionSettings };
    const afterChatRoles = msgs => { const first = msgs.findIndex(m => m.role !== "system"); return msgs.slice(first + 1).map(m => m.role); };
    Object.assign(chatCompletionSettings, { chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-5.5" });
    let msgs = await run("VCRP V10 Universal.json");
    assert(msgs[0].role === "system", "the opening system prompt stays a system message");
    assert(!afterChatRoles(msgs).includes("system"), "OpenRouter + Claude: nothing after the chat is a system message");
    assert(msgs.some(m => m.role === "user" && m.content.includes("final reminder")), "Output Rules arrive as a user message");
    vcrpSetGenerationType("continue", {}, false);
    msgs = buildPrompt("VCRP V10 Universal.json");
    msgs.push({ role: "assistant", content: "Alice turned toward the door and" });
    await handlePromptInjection({ chat: msgs, dryRun: false });
    assert(msgs.at(-2).role === "user" && msgs.at(-2).content.startsWith("[Continue your previous reply"), "continue note: user role, still right before the partial reply");
    for (const [source, field, model] of [["claude", "claude_model", "claude-opus-5-5"], ["openrouter", "openrouter_model", "google/gemini-2.5-pro"]]) {
        Object.assign(chatCompletionSettings, { chat_completion_source: source, [field]: model });
        msgs = await run("VCRP V10 Universal.json");
        assert(afterChatRoles(msgs).includes("system"), `${source} ${model}: roles left as the preset set them`);
    }
    for (const k of Object.keys(chatCompletionSettings)) delete chatCompletionSettings[k];
    Object.assign(chatCompletionSettings, keep);
}
console.log("15 ok OpenRouter + Claude: after-chat messages sent as user (other routes untouched)");

// 16. Cache safety: anything that can change from one turn to the next sits after the chat
//     history. Before it, a change invalidates the cached history on every turn.
//     ([[long-Memory]] / [[Short-memory]] belong to the Memory Core being rewritten.)
{
    const preset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
    const byId = Object.fromEntries(preset.prompts.map(x => [x.identifier, x]));
    const order = preset.prompt_order.find(x => x.character_id === 100001).order;
    const chatAt = order.findIndex(o => o.identifier === "chatHistory");
    const before = order.slice(0, chatAt).map(o => (byId[o.identifier] || {}).content || "").join("\n");
    for (const tag of ["[[storyplan]]", "[[npc list]]", "[[npc_dossier]]", "[[story_recall]]", "[[knowledgebase]]", "[[ANIMEMODE]]", "[[blocks]]", "[[config]]", "[[THINK]]"])
        assert(!before.includes(tag), `${tag} must come after the chat history`);
    assert.equal(byId.dialogueExamples && order.find(o => o.identifier === "dialogueExamples").enabled, true, "Chat Examples on");
}
console.log("16 ok cache safety: per-turn tags sit after the chat history");

// 17. Budgeted memory: budget sizes, cut planning, anchors, and the interceptor.
{
    const { priceForModel, computeBudget } = await imp("src/vcrp/memory/budget.js");
    const { planWindow, summaryTarget } = await imp("src/vcrp/memory/window.js");
    const memory = await imp("src/vcrp/memory/index.js");

    assert.equal(priceForModel("anthropic/claude-opus-5.5").label, "Claude Opus 5.5");
    assert.equal(priceForModel("claude-opus-4-6").input, 5);
    assert.equal(priceForModel("anthropic/claude-sonnet-5").label, "Claude Sonnet 5 / 5.5");
    assert.equal(priceForModel("openai/gpt-5"), null, "unknown model: no price");
    assert.equal(priceForModel("openai/gpt-5", { input: 1, output: 2, read: 0.1 }).label, "Custom price");
    const b = computeBudget(priceForModel("claude-opus-5-5"), { ttl: "1h", targetCost: 0.27 });
    assert.equal(b.coldTokens, 25300, "($0.27 - 2500 output tokens at $20/M) / $8/M written, with the 0.92 safety margin");
    assert.equal(computeBudget(priceForModel("claude-opus-5-5"), { ttl: "5m" }).coldTokens, 46000, "default $0.30; a 5-minute miss writes at 1.25x");

    // 60 messages of 1000 tokens, user/assistant alternating, user first.
    const msgs = Array.from({ length: 60 }, (_, i) => ({ tokens: 1000, isUser: i % 2 === 0 }));
    const H = 3600 * 1000, now = 10 * H;
    let p = planWindow({ msgs, fixedTokens: 10000, state: { lastRequestAt: now - 60000 }, now, budget: b });
    assert(!p.cut && !p.cold, "warm and under the ceiling: nothing moves");
    p = planWindow({ msgs, fixedTokens: 10000, state: { lastRequestAt: now - 2 * H, summarizedTo: 50 }, now, budget: b });
    assert(p.cold && p.cut && !p.behind, "cold start with summaries: cut");
    assert(msgs[p.cutAt].isUser, "the carried history opens on a user message");
    assert(p.promptTokens <= b.coldTokens && 10000 + (60 - (p.cutAt - 2)) * 1000 > b.coldTokens, "the gentlest cut that fits");
    p = planWindow({ msgs, fixedTokens: 10000, state: { lastRequestAt: now - 2 * H, summarizedTo: 0 }, now, budget: b });
    assert(!p.cut && p.behind && p.limit === "summaries", "nothing summarized: nothing is dropped");
    p = planWindow({ msgs, fixedTokens: 10000, state: { lastRequestAt: now - 2 * H, summarizedTo: 59 }, now, budget: { ...b, minVerbatim: 25000 } });
    assert(60 - p.cutAt >= 25 && p.behind && p.limit === "verbatim floor", "the verbatim floor holds even over budget");
    p = planWindow({ msgs, fixedTokens: 10000, state: { lastRequestAt: now - 2 * H, summarizedTo: 50, cutAt: 46 }, now, budget: b });
    assert(p.cutAt >= 46, "a cut never moves back");
    const big = Array.from({ length: 240 }, (_, i) => ({ tokens: 500, isUser: i % 2 === 0 }));
    p = planWindow({ msgs: big, fixedTokens: 10000, state: { lastRequestAt: now - 60000, summarizedTo: 230 }, now, budget: b });
    assert(!p.cold && p.cut && p.promptTokens <= b.coldTokens, "warm but past the ceiling: a planned cut");
    const st = summaryTarget({ msgs, fixedTokens: 10000, budget: b, lookahead: 4000 });
    assert(st > 0 && msgs[st].isUser && 10000 + (60 - st) * 1000 + 4000 <= b.coldTokens, "summaries aim where a cold cut would land");

    // Anchors survive a deleted earlier message and give up when their own message is gone.
    const chatA = Array.from({ length: 10 }, (_, i) => ({ is_user: i % 2 === 0, send_date: `d${i}`, mes: `message ${i}` }));
    const a = memory.anchorOf(chatA, 6);
    assert.equal(memory.resolveAnchor(chatA.filter((_, i) => i !== 2), a), 5, "shifts with a deletion before it");
    assert.equal(memory.resolveAnchor(chatA.filter((_, i) => i !== 6), a), -1, "gone when its message is deleted");

    // The interceptor: hides before the cut on a real cold request; a dry run moves nothing.
    // (Group 7 left a Text Completion connection and another preset selected: Story Memory
    // refuses to cut there, since the memory text could not reach the prompt.)
    const vcrpPreset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
    ctx.mainApi = "openai";
    Object.assign(chatCompletionSettings, { prompts: vcrpPreset.prompts, prompt_order: vcrpPreset.prompt_order });
    const q = state.localProfile;
    q.vcrpMemory.enabled = true;
    const symbols = { ignore: Symbol("ignore") };
    ctx.symbols = symbols;
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });
    const T = 50 * H;
    memory.setMemoryClock(() => T);
    const long = Array.from({ length: 200 }, (_, i) => ({ is_user: i % 2 === 0, send_date: `s${i}`, mes: "word ".repeat(700) }));
    const meta = memory.memoryState();
    Object.assign(meta, { lastRequestAt: T - 3 * H, summarized: memory.anchorOf(long, 190), fixedTokens: 10000 });
    vcrpSetGenerationType("normal", {}, true);                 // a dry run first
    let core = long.map(m => ({ ...m }));
    await globalThis.vcrp_memory_intercept(core, 1e9, () => {}, "normal");
    assert(!core.some(m => m.extra && m.extra[symbols.ignore]) && meta.lastRequestAt === T - 3 * H, "dry run: nothing hidden, clock untouched");
    vcrpSetGenerationType("normal", {}, false);
    core = long.map(m => ({ ...m }));
    await globalThis.vcrp_memory_intercept(core, 1e9, () => {}, "normal");
    const hidden = core.filter(m => m.extra && m.extra[symbols.ignore]).length;
    assert(hidden > 0 && meta.lastPlan.cold && meta.lastPlan.cut, "cold real request: older messages hidden");
    assert(core.slice(0, hidden).every(m => m.mes === "") && core.slice(hidden).every(m => m.mes), "hidden exactly up to the cut");
    assert.equal(meta.lastRequestAt, T - 3 * H, "the interceptor alone does not stamp the clock");
    memory.vcrpMemoryAfterPrompt([{ role: "system", content: "x" }], false);
    assert.equal(meta.lastRequestAt, T, "the roleplay prompt, once built, stamps it");
    q.vcrpMemory.enabled = false;
    memory.setMemoryClock(null);
    delete ctx.symbols;
}
console.log("17 ok budgeted memory (budget, cut planning, anchors, interceptor)");

// 18. Story Memory chapters: parsing, fact changes, folding, the next stretch, and a full
//     summarize -> check -> review -> approve -> cut cycle against a stand-in model.
{
    const L = await imp("src/vcrp/memory/ledger.js");
    const S = await imp("src/vcrp/memory/summarize.js");
    const memory = await imp("src/vcrp/memory/index.js");

    const reply = `<think>planning</think><chapter_gist>Bob met Mara and took the key.</chapter_gist>
<chapter>Bob walked into the Lantern. Mara gave him a brass key.</chapter>
<fact_changes>
+ person | Mara Voss tends bar at the Lantern.
- + item | Bob carries a brass key from Mara.
+ weather | It rains all week.
~ F9 | nonsense
gibberish line
</fact_changes>`;
    const parsed = L.parseSummary(reply);
    assert(parsed.ok && parsed.gist.startsWith("Bob met Mara") && !parsed.chapter.includes("planning"), "summary tags read, thinking ignored");
    assert.equal(parsed.ops.length, 4, "three adds (one behind a bullet) and one reword");
    assert.equal(parsed.ops[2].cat, "world", "an unknown category becomes world");
    assert.deepEqual(parsed.skipped, ["gibberish line"]);
    assert.equal(L.parseCheck("OK.").verdict, "ok");
    assert.equal(L.parseCheck(reply).verdict, "corrected");
    assert.equal(L.parseCheck("I think it's mostly fine").verdict, "unreadable");
    let led = L.applyFactChanges({}, parsed.ops, "C1");
    assert(led.ledger.length === 3 && led.skipped.length === 1 && led.ledger[0].id === "F1", "adds numbered; a reword of an unknown id is skipped, not guessed");
    led = L.applyFactChanges(led, [{ op: "~", id: "F2", text: "Bob lost the key." }, { op: "-", id: "F3", reason: "the rain stopped" }], "C2");
    assert(led.ledger.find(f => f.id === "F2").text === "Bob lost the key." && !led.ledger.find(f => f.id === "F3") && led.retired[0].id === "F3", "reword and retire");
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `C${i + 1}`, gist: `g${i + 1}` }));
    assert.equal(L.gistsToFold(many).length, 10, "twelve open gists: fold the oldest ten");
    assert.equal(L.gistsToFold(many.slice(0, 11)).length, 0);
    const text = L.composeMemoryText({ arcs: [{ text: "Arc one." }], chapters: [{ gist: "g1", folded: true }, { gist: "g2" }, { gist: "g3", late: true }], ledger: led.ledger }, c => !c.late);
    assert(text.includes("Arc one.") && text.includes("- g2") && !text.includes("g1") && !text.includes("g3") && text.includes("[item] Bob lost the key."), "memory text: arcs, open gists before the cut, facts");

    // A 60-message chat, ~300 tokens each, on Claude Opus 5.5 with a default budget.
    const q = state.localProfile;
    q.vcrpMemory.enabled = true;
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });
    chat.length = 0;
    for (let i = 0; i < 60; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `t${i}`, mes: `(${i}) ` + "She set the glass down and looked at the door. ".repeat(22) });
    const meta = memory.memoryState();
    Object.assign(meta, { cut: null, summarized: null, shown: "", chapters: [], arcs: [], ledger: [], retired: [], pending: [], nextFactId: 1, chapterSeq: 0, fixedTokens: 12000, lastRequestAt: Date.now() });   // warm: the summary reuses the cache
    const budget = memory.currentMemoryBudget();
    const span = S.nextSpan(S.storyChat(), meta, budget);
    assert(span && span.start === 0 && span.tokens >= S.MIN_SPAN && span.tokens <= S.MAX_SPAN + 400, "a stretch from the start, sized between the limits");
    assert(chat[span.end].is_user, "a chapter ends where a user message begins");

    // The stand-in model: checks the prompt shape, answers the summary, then the check.
    const seen = [];
    quietImpl = async ({ quietPrompt: prompt }) => {
        vcrpSetGenerationType("quiet", {}, false);
        const msgs = buildQuietPrompt("VCRP V10 Universal.json", prompt);
        await handlePromptInjection({ chat: msgs, dryRun: false });
        seen.push(msgs);
        return prompt.includes("MEMORY TASK CHECK") ? "OK" : reply;
    };
    let r = await S.summarizeNext();
    assert.equal(r.status, "pending", "review on by default: the chapter waits");
    const [task, check] = seen;
    assert(task.at(-1).content.includes("[VCRP MEMORY TASK") && task.at(-1).content.includes("(0)"), "the instruction is last and quotes where the stretch starts");
    assert(!task.some(m => typeof m.content === "string" && m.content.includes("final reminder")), "the after-chat rules are dropped from a summary call");
    assert(check.at(-1).content.includes("MEMORY TASK CHECK") && check.at(-1).content.includes("Bob met Mara"), "the check call quotes the summary");
    assert(meta.pending.length === 1 && meta.pending[0].checked === "ok" && !meta.summarized, "waiting, checked, nothing counted yet");

    S.approvePending(meta, S.storyChat(), { gist: "Bob met Mara (edited)." });
    assert(meta.chapters.length === 1 && meta.chapters[0].gist === "Bob met Mara (edited)." && meta.ledger.length === 3, "approve: chapter and facts saved, edits kept");
    assert.equal(memory.resolveAnchor(S.storyChat(), meta.summarized), span.end, "coverage moves to the end of the stretch");

    // Review off: the next one is saved straight away. (The chat grows first: what is left
    // after one chapter all sits inside the verbatim floor, so there is nothing to write yet.)
    assert.equal(S.nextSpan(S.storyChat(), meta, budget, { catchUp: true }), null, "nothing outside the verbatim floor: nothing to write");
    for (let i = 60; i < 90; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `t${i}`, mes: `(${i}) ` + "She set the glass down and looked at the door. ".repeat(22) });
    extension_settings.VCRP.globalSettings.memoryBudget = { review: false };
    seen.length = 0;
    r = await S.summarizeNext({ catchUp: true });
    assert(r.status === "saved" && meta.chapters.length === 2 && meta.pending.length === 0, `review off: saved directly (got ${JSON.stringify(r)}, chapters ${meta.chapters.length})`);

    // A cold start now cuts, and the prompt carries the memory text in place of the old messages.
    const T = 100 * 3600 * 1000;
    memory.setMemoryClock(() => T);
    meta.lastRequestAt = T - 2 * 3600 * 1000;
    ctx.symbols = { ignore: Symbol("ignore") };
    vcrpSetGenerationType("normal", {}, false);
    await globalThis.vcrp_memory_intercept(S.storyChat().map(m => ({ ...m })), 1e9, () => {}, "normal");
    assert(meta.lastPlan.cut && meta.shown.includes("Bob met Mara (edited).") && meta.shown.includes("[person] Mara Voss"), "cold start: cut, memory text set");
    const after = await run("VCRP V10 Universal.json");
    assert(text && after.some(m => typeof m.content === "string" && m.content.includes("<story_memory>")), "the memory text reaches the prompt through [[long-Memory]]");

    quietImpl = null;
    delete extension_settings.VCRP.globalSettings.memoryBudget;
    q.vcrpMemory.enabled = false;
    memory.setMemoryClock(null);
    delete ctx.symbols;
    chat.length = 0;
}
console.log("18 ok Story Memory chapters (parse, facts, folding, stretch, summarize -> check -> review -> cut)");

// 19. Recall and the memory cap.
{
    const R = await imp("src/vcrp/memory/recall.js");
    const L = await imp("src/vcrp/memory/ledger.js");
    const memory = await imp("src/vcrp/memory/index.js");

    const cand = [
        { id: "C1", order: 0, text: "Bob met Mara Voss at the Lantern. She slid him a brass key to the cellar.", tokens: 30 },
        { id: "C2", order: 1, text: "Jonah fixed the boat engine at the harbor while gulls fought over bait.", tokens: 30 },
        { id: "C3", order: 2, text: "A storm cut the power across Baltimore; candles everywhere.", tokens: 30 },
    ];
    const ranked = R.rankRecall(cand, R.keywordsOf("Bob turned the brass key over and thought about Mara and the cellar."));
    assert(ranked.length === 1 && ranked[0].c.id === "C1", "the chapter sharing rare words is recalled, and only it");
    assert.equal(R.rankRecall(cand, R.keywordsOf("The harbor was quiet.")).length, 0, "one shared word is not enough");
    const both = R.pickRecall(cand, R.keywordsOf("Mara's brass key and the cellar; Jonah's boat engine at the harbor"), 40);
    assert(both.length === 1, "the recall size limit holds");
    assert.deepEqual(R.pickRecall(cand, R.keywordsOf("Mara's brass key and the cellar; Jonah's boat engine at the harbor"), 100).map(c => c.id), ["C1", "C2"], "recalled chapters come back in story order");

    const facts = Array.from({ length: 40 }, (_, i) => ({ id: `F${i + 1}`, cat: "world", text: `Fact number ${i + 1} about the docks and the people who work them.`, updated: `C${i + 1}` }));
    facts[0].updated = "edit";   // the reader's own edit counts as newest
    const capped = L.composeMemory({ ledger: facts }, () => true, 400);
    assert(capped.hidden.length > 0 && !capped.hidden.includes("F1") && capped.hidden[0] === "F2", "over the cap: oldest facts leave first, the reader's edit stays");
    assert(Math.ceil(capped.text.length / 3.5) <= 400, "the text fits the cap");

    // In a prompt: recall after a cut, from chapters that have left the prompt.
    const q = state.localProfile;
    q.vcrpMemory.enabled = true;
    chat.length = 0;
    for (let i = 0; i < 40; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `r${i}`, mes: `(${i}) The bar was busy tonight.` });
    chat.push({ is_user: true, name: "Bob", send_date: "r40", mes: "I take out Mara's brass key and walk down to the cellar." });
    const meta = memory.memoryState();
    Object.assign(meta, {
        cut: memory.anchorOf(chat, 20), summarized: memory.anchorOf(chat, 20), shown: "", hiddenFacts: [],
        chapters: [
            { id: "C1", gist: "Mara gave Bob a key.", chapter: "Mara Voss gave Bob a brass key to the cellar under the Lantern.", from: 0, to: 9, start: null, end: memory.anchorOf(chat, 10) },
            { id: "C2", gist: "Jonah fixed a boat.", chapter: "Jonah fixed the boat engine at the harbor.", from: 10, to: 19, start: memory.anchorOf(chat, 10), end: memory.anchorOf(chat, 20) },
            { id: "C3", gist: "Later.", chapter: "Mara's brass key and the cellar again, still in the prompt.", from: 20, to: 29, start: memory.anchorOf(chat, 20), end: memory.anchorOf(chat, 30) },
        ],
        ledger: [], arcs: [],
    });
    const msgs = await run("VCRP V10 Universal.json");
    const all = text(msgs);
    assert(all.includes("<story_recall>") && all.includes("Mara Voss gave Bob a brass key"), "the chapter the scene touches comes back");
    assert(!all.includes("still in the prompt"), "a chapter whose messages are still carried is not recalled");
    assert(all.indexOf("<story_recall>") > all.indexOf("latest user msg"), "recall sits after the chat");
    assert.deepEqual(meta.lastRecall, ["C1"]);
    meta.cut = null;
    assert(!text(await run("VCRP V10 Universal.json")).includes("<story_recall>"), "before the first cut there is nothing to recall");
    q.vcrpMemory.enabled = false;
    chat.length = 0;
}
console.log("19 ok recall and the memory cap");

// 20. Step 5: VCRP-side cache markers, and the Setup Check's long-chat items.
{
    const C = await imp("src/vcrp/memory/cache.js");
    const { vcrpHealthCheck } = await imp("src/vcrp/health.js");

    const sample = () => [
        { role: "system", content: "preset" },
        { role: "user", content: "u1" }, { role: "assistant", content: "a1" },
        { role: "user", content: "u2" }, { role: "assistant", content: "a2" },
        { role: "user", content: "u3" }, { role: "user", content: "output rules (sent as user)" },
    ];
    assert.deepEqual(C.cacheMarkIndices(sample()), [6, 3], "marks the newest user turn and the user turn two switches back");
    assert.deepEqual(C.cacheMarkIndices([...sample(), { role: "assistant", content: "<think>" }]), [6, 3], "a trailing prefill is skipped");
    let m = sample();
    C.markCache(m, "1h");
    assert.deepEqual(m[6].content, [{ type: "text", text: "output rules (sent as user)", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    assert(typeof m[5].content === "string" && Array.isArray(m[3].content), "only the marked messages change");
    m = sample(); C.markCache(m, "5m");
    assert.deepEqual(m[6].content[0].cache_control, { type: "ephemeral" }, "the 5-minute cache needs no ttl");

    // In the real prompt: only with Story Memory on, the option ticked, and OpenRouter + Claude.
    const keep = { ...chatCompletionSettings };
    const q = state.localProfile;
    q.vcrpMemory.enabled = true;
    const marked = msgs => msgs.filter(x => Array.isArray(x.content) && x.content.some(p => p.cache_control)).length;
    Object.assign(chatCompletionSettings, { chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-5.5" });
    assert.equal(marked(await run("VCRP V10 Universal.json")), 0, "option off: no markers");
    extension_settings.VCRP.globalSettings.memoryBudget = { markCache: true };
    const withMarks = await run("VCRP V10 Universal.json");
    assert.equal(marked(withMarks), 2, "option on, OpenRouter + Claude: two markers");
    assert(withMarks.at(-1).content.at(-1).cache_control.ttl === "1h", "the newest turn is marked, with the 1-hour lifetime");
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });
    assert.equal(marked(await run("VCRP V10 Universal.json")), 0, "direct Anthropic: left to SillyTavern");

    // The Setup Check.
    const presetJson = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
    ctx.mainApi = "openai";
    extension_settings.preset_allowed_regex = { openai: ["VCRP V10 Universal"] };
    Object.assign(chatCompletionSettings, {
        preset_settings_openai: "VCRP V10 Universal", prompts: presetJson.prompts, prompt_order: presetJson.prompt_order, extensions: presetJson.extensions,
        chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-5.5",
        openai_max_context: 4095, openrouter_providers: [], openrouter_allow_fallbacks: true,
    });
    let hc = vcrpHealthCheck();
    const has = (level, re) => hc.items.some(i => i.level === level && re.test(i.title));
    assert(has("error", /Context Size/), "Story Memory on with a 4k Context Size: a problem (red dot)");
    assert(has("info", /pin the provider/), "unpinned OpenRouter: a suggestion");
    assert(has("ok", /marks the prompt cache itself/), "VCRP marking: noted");
    Object.assign(chatCompletionSettings, { openai_max_context: 1000000, openrouter_providers: ["Anthropic"], openrouter_allow_fallbacks: false });
    extension_settings.VCRP.globalSettings.memoryBudget = {};
    hc = vcrpHealthCheck();
    assert(has("ok", /Context Size leaves Story Memory room/) && has("ok", /pinned to Anthropic/) && has("info", /config\.yaml/), "fixed: all clear, with the config.yaml reminder");
    assert.equal(hc.errors, 0, `no problems left: ${JSON.stringify(hc.items.filter(i => i.level === "error"))}`);
    {   // chapters waiting for review are mentioned
        const meta = (await imp("src/vcrp/memory/index.js")).memoryState();
        meta.pending = [{ gist: "x" }];
        hc = vcrpHealthCheck();
        assert(has("info", /waiting for review/), "waiting chapters are mentioned");
        meta.pending = [];
    }
    q.vcrpMemory.enabled = false;

    delete extension_settings.VCRP.globalSettings.memoryBudget;
    for (const k of Object.keys(chatCompletionSettings)) delete chatCompletionSettings[k];
    Object.assign(chatCompletionSettings, keep);
}
console.log("20 ok cache markers from VCRP, Setup Check long-chat items");

// 21. Step 6: the old Memory Core's data moves over, rewinds repair Story Memory, edited
//     messages keep their place, and a fold-only call tidies a long list of gists.
{
    const memory = await imp("src/vcrp/memory/index.js");
    const S = await imp("src/vcrp/memory/summarize.js");
    const meta = globalThis.__ST__.chat_metadata;
    // A chat with one hidden (system) message at index 5: old archive ids count it, Story Memory doesn't.
    chat.length = 0;
    for (let i = 0; i < 40; i++) chat.push({ is_user: i % 2 === 0, is_system: i === 5, name: i % 2 ? "Alice" : "Bob", send_date: `m${i}`, mes: `(${i}) The bar was busy.` });
    delete meta.vcrp_memory;
    meta.megumin_memory_core = {
        shortTermChunks: [{ id: "0-9", summary: "Bob met Mara at the Lantern. She poured him a drink.", timestamp: 1 }, { id: "10-19", summary: "Mara told Bob about her brother's debts.", timestamp: 2 }],
        longTermVault: [{ id: "0-9", summary: "A duplicate of the first range.", timestamp: 0 }],
    };
    assert.equal(memory.vcrpMemoryMigrateLegacy(), 2, "two ranges become two chapters (the duplicate range is skipped)");
    const st = memory.memoryState();
    assert.equal(st.chapters[0].gist, "Bob met Mara at the Lantern.", "the gist is the first sentence");
    assert.deepEqual([st.chapters[0].from, st.chapters[0].to, st.chapters[1].from, st.chapters[1].to], [0, 8, 9, 18], "ids in the full chat become positions among visible messages");
    const story = chat.filter(m => !m.is_system);
    assert.equal(memory.resolveAnchor(story, st.summarized), 19, "coverage runs to the end of the old summaries");
    assert.equal(memory.vcrpMemoryMigrateLegacy(), 0, "once per chat");

    // The old setting: a profile that had the Memory Core on gets Story Memory on.
    const stored = Object.values(extension_settings.VCRP.profiles).find(x => x && x.npcBank);
    stored.memoryCore = { enabled: true, chunkSize: 10 };
    stored.vcrpMemory = { enabled: false };
    initProfile();
    assert(state.localProfile.vcrpMemory.enabled && !state.localProfile.memoryCore, "Memory Core on becomes Story Memory on");
    state.localProfile.vcrpMemory.enabled = false;

    // A third chapter with fact changes, then a rewind that deletes its messages.
    const st2 = memory.memoryState();
    st2.ledger = [{ id: "F1", cat: "person", text: "Mara tends bar.", updated: "C1" }, { id: "F2", cat: "item", text: "Bob has a key.", updated: "C1" }];
    st2.nextFactId = 3;
    S.commitChapter(st2, story, {
        start: memory.anchorOf(story, 19), end: memory.anchorOf(story, 30), from: 19, to: 29, gist: "The debt came due.", chapter: "...",
        ops: [{ op: "+", cat: "thread", text: "The debt is due Friday." }, { op: "~", id: "F1", text: "Mara owns the bar now." }, { op: "-", id: "F2", reason: "lost" }],
        checked: "ok", created: 3,
    });
    assert(st2.ledger.some(f => f.id === "F3") && !st2.ledger.some(f => f.id === "F2"), "the chapter's fact changes applied");
    st2.cut = memory.anchorOf(story, 30);
    chat.splice(25);   // a rewind back into the third chapter
    assert(memory.vcrpMemoryCheckChat(), "the rewind is noticed");
    assert.equal(st2.chapters.length, 2, "the chapter whose messages are gone is taken out");
    assert(!st2.ledger.some(f => f.id === "F3") && st2.ledger.find(f => f.id === "F1").text === "Mara tends bar." && st2.ledger.some(f => f.id === "F2"), "its fact changes are undone");
    assert(st2.cut === st2.summarized || memory.resolveAnchor(chat.filter(m => !m.is_system), st2.cut) <= memory.resolveAnchor(chat.filter(m => !m.is_system), st2.summarized), "the cut never runs past the coverage");

    // Editing an old message keeps the place it anchors.
    const story2 = chat.filter(m => !m.is_system);
    const a = memory.anchorOf(story2, 10);
    story2[10].mes = "(edited) something else entirely";
    assert.equal(memory.resolveAnchor(story2, a), 10, "an edited message is still found by speaker and send time");

    // Fold-only: nothing to summarize, but a long list of gists. (initProfile above swapped the profile object.)
    state.localProfile.vcrpMemory.enabled = true;
    st2.chapters = Array.from({ length: 14 }, (_, i) => ({ id: `C${i + 1}`, gist: `gist ${i + 1}`, chapter: "x", from: 0, to: 0 }));
    st2.arcs = [];
    quietImpl = async ({ quietPrompt: prompt }) => (prompt.includes("MEMORY TASK FOLD") ? "<arc>The first ten chapters, folded.</arc>" : "OK");
    const r = await S.summarizeNext();
    assert.equal(r.status, "folded");
    assert(st2.arcs.length === 1 && st2.chapters.filter(c => c.folded).length === 10, "the oldest ten gists fold into one arc");
    quietImpl = null;
    state.localProfile.vcrpMemory.enabled = false;
    delete meta.megumin_memory_core;
    delete meta.vcrp_memory;
    chat.length = 0;
}
console.log("21 ok step 6: legacy data moved over, rewind repair, edited messages, fold-only call");

// 22. Pre-test sweep fixes.
{
    const memory = await imp("src/vcrp/memory/index.js");
    const S = await imp("src/vcrp/memory/summarize.js");
    const meta = globalThis.__ST__.chat_metadata;
    const fresh = () => {
        delete meta.vcrp_memory;
        const st = memory.memoryState();
        Object.assign(st, { fixedTokens: 12000 });
        return st;
    };
    state.localProfile.vcrpMemory.enabled = true;
    Object.assign(chatCompletionSettings, { chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-5.5" });
    extension_settings.VCRP.globalSettings.memoryBudget = { markCache: true };
    chat.length = 0;
    for (let i = 0; i < 90; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `w${i}`, mes: `(${i}) ` + "She set the glass down and looked at the door. ".repeat(22) });
    const good = `<chapter_gist>Bob met Mara.</chapter_gist><chapter>Bob met Mara at the bar.</chapter><fact_changes>+ person | Mara tends bar.</fact_changes>`;

    // A cold cache: the summary is a standalone call (just the stretch), the cache clock is not
    // touched, and no cache markers go on it. The instruction arrives as quietPrompt.
    let st = fresh();
    const T = 500 * 3600 * 1000;
    memory.setMemoryClock(() => T);
    st.lastRequestAt = T - 5 * 3600 * 1000;
    let seen = [];
    quietImpl = async (opts) => {
        assert(opts && typeof opts.quietPrompt === "string" && opts.quietPrompt.includes("[VCRP MEMORY TASK"), "the instruction travels as quietPrompt");
        vcrpSetGenerationType("quiet", {}, false);
        const msgs = buildQuietPrompt("VCRP V10 Universal.json", opts.quietPrompt);
        await handlePromptInjection({ chat: msgs, dryRun: false });
        seen.push(msgs);
        return opts.quietPrompt.includes("MEMORY TASK CHECK") ? "OK, accurate." : good;
    };
    let r = await S.summarizeNext();
    assert.equal(r.status, "pending");
    assert(seen[0].length === 4 && seen[0][1].content.startsWith("<chat>\nBob: (0)") && seen[0][3].content.includes("[VCRP MEMORY TASK"), "standalone: only the stretch and the instruction");
    const C = await imp("src/vcrp/memory/cache.js");
    assert.deepEqual(C.cacheMarkIndices(seen[0]), [3, 1], "caching marks the instruction and the end of the stretch, so the check call reads the stretch");
    assert.deepEqual(seen[1].slice(0, 3), seen[0].slice(0, 3), "the check call opens with the same three messages");
    assert(!seen.flat().some(m => Array.isArray(m.content)), "no cache markers on a standalone call");
    assert.equal(st.lastRequestAt, T - 5 * 3600 * 1000, "a standalone call leaves the cache clock alone");
    assert.equal(st.pending[0].checked, "ok", "'OK, accurate.' counts as OK");

    // A correction without its fact_changes tag keeps the original fact changes.
    st = fresh(); st.lastRequestAt = T;
    quietImpl = async ({ quietPrompt }) => quietPrompt.includes("MEMORY TASK CHECK")
        ? "<chapter_gist>Bob met Mara Voss.</chapter_gist><chapter>Bob met Mara Voss at the bar.</chapter>" : good;
    await S.summarizeNext();
    assert(st.pending[0].gist === "Bob met Mara Voss." && st.pending[0].ops.length === 1, "corrected text, original fact changes kept");

    // Failures: two in a row pause automatic summaries; three waiting chapters hold them.
    st = fresh(); st.lastRequestAt = T;
    quietImpl = async () => "I'd rather not.";
    r = await S.summarizeNext();
    assert(r.status === "failed" && !r.paused && !S.autoSummaryHold(st), "one failure: retried later");
    r = await S.summarizeNext();
    assert(r.paused && S.autoSummaryHold(st) === "paused after failed summaries", "two failures: paused");
    quietImpl = async ({ quietPrompt }) => (quietPrompt.includes("MEMORY TASK CHECK") ? "OK" : good);
    await S.summarizeNext({ catchUp: true });
    assert(!S.autoSummaryHold(st), "a success clears the pause");
    st.pending = [{}, {}, {}];
    assert.equal(S.autoSummaryHold(st), "waiting for review");

    // A fold asked for while a chapter waited, but done since: no second arc.
    st = fresh();
    st.chapters = [{ id: "C1", folded: true }, { id: "C2", folded: true }];
    st.arcs = [{ text: "old arc", covers: ["C1", "C2"] }];
    S.commitChapter(st, chat, { start: null, end: memory.anchorOf(chat, 10), gist: "g", chapter: "c", ops: [], arc: "new arc", foldIds: ["C1", "C2"] });
    assert.equal(st.arcs.length, 1, "no duplicate arc");

    // A rewind that deletes the cut's own message keeps the cut nearby.
    st = fresh();
    st.chapters = [{ id: "C1", start: null, end: memory.anchorOf(chat, 40), undo: {} }];
    st.summarized = memory.anchorOf(chat, 40);
    st.cut = memory.anchorOf(chat, 30);
    chat.splice(30, 1);
    memory.repairMemory(chat, st);
    const cutNow = memory.resolveAnchor(chat, st.cut);
    assert(cutNow > 20 && cutNow <= 30 && chat[cutNow].is_user, "the cut stays near where it was, on a user message");

    // Migration leaves chats without old data alone, and waits for an empty (unloaded) chat.
    delete meta.vcrp_memory; delete meta.megumin_memory_core;
    memory.vcrpMemoryMigrateLegacy();
    assert(!meta.vcrp_memory, "no state created in a chat with nothing to move");
    meta.megumin_memory_core = { shortTermChunks: [{ id: "0-9", summary: "x." }] };
    const saved = chat.splice(0);
    assert.equal(memory.vcrpMemoryMigrateLegacy(), 0);
    assert(!(meta.vcrp_memory && meta.vcrp_memory.legacyImported), "an unloaded chat is tried again later");
    chat.push(...saved);
    assert.equal(memory.vcrpMemoryMigrateLegacy(), 1, "then imported once the chat is there");

    // fixedTokens is only measured from a request the interceptor saw.
    st = fresh();
    st.fixedTokens = 777;
    vcrpSetGenerationType("normal", {}, false);
    memory.vcrpMemoryAfterPrompt([{ role: "system", content: "x".repeat(10000) }], false);
    assert.equal(st.fixedTokens, 777, "no interceptor run, no measurement");

    quietImpl = null;
    memory.setMemoryClock(null);
    state.localProfile.vcrpMemory.enabled = false;
    delete extension_settings.VCRP.globalSettings.memoryBudget;
    delete meta.vcrp_memory; delete meta.megumin_memory_core;
    chat.length = 0;
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });
}
console.log("22 ok sweep fixes (quietPrompt, standalone calls, corrections, failures, holds, arcs, rewind cut, migration, measuring)");

// 23. Second sweep: never cut when the memory text can't reach the prompt; summaries follow
//     the story language.
{
    const memory = await imp("src/vcrp/memory/index.js");
    const S = await imp("src/vcrp/memory/summarize.js");
    const meta = globalThis.__ST__.chat_metadata;
    const vcrpPreset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
    ctx.mainApi = "openai";
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5", prompts: vcrpPreset.prompts, prompt_order: vcrpPreset.prompt_order });
    assert(memory.memoryCanReachPrompt(), "VCRP preset on Chat Completion: the memory can reach the prompt");

    state.localProfile.vcrpMemory.enabled = true;
    ctx.symbols = { ignore: Symbol("ignore") };
    const long = Array.from({ length: 200 }, (_, i) => ({ is_user: i % 2 === 0, send_date: `g${i}`, mes: "word ".repeat(700) }));
    const T = 900 * 3600 * 1000;
    memory.setMemoryClock(() => T);
    const coldCut = async () => {
        delete meta.vcrp_memory;
        Object.assign(memory.memoryState(), { lastRequestAt: T - 3 * 3600 * 1000, summarized: memory.anchorOf(long, 190), fixedTokens: 10000 });
        vcrpSetGenerationType("normal", {}, false);
        const core = long.map(m => ({ ...m }));
        await globalThis.vcrp_memory_intercept(core, 1e9, () => {}, "normal");
        return core.filter(m => m.extra && m.extra[ctx.symbols.ignore]).length;
    };
    assert((await coldCut()) > 0, "normally a cold start cuts");
    ctx.mainApi = "textgenerationwebui";
    assert.equal(await coldCut(), 0, "Text Completion: nothing is cut");
    ctx.mainApi = "openai";
    chatCompletionSettings.prompts = vcrpPreset.prompts.map(p => ({ ...p, content: String(p.content || "").replace("[[long-Memory]]", "") }));
    assert.equal(await coldCut(), 0, "a preset without [[long-Memory]]: nothing is cut");
    assert(/can't carry/.test(memory.memoryState().lastPlan.reason), "and the meter says why");
    chatCompletionSettings.prompts = vcrpPreset.prompts;
    const withHistoryOff = JSON.parse(JSON.stringify(vcrpPreset.prompt_order));
    const holder = vcrpPreset.prompts.find(p => String(p.content || "").includes("[[long-Memory]]"));
    withHistoryOff.find(o => o.character_id === 100001).order.find(o => o.identifier === holder.identifier).enabled = false;
    chatCompletionSettings.prompt_order = withHistoryOff;
    assert.equal(await coldCut(), 0, "the slot carrying it switched off: nothing is cut");
    chatCompletionSettings.prompt_order = vcrpPreset.prompt_order;

    // The story language reaches the summary and the check.
    chat.length = 0;
    for (let i = 0; i < 90; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `l${i}`, mes: `(${i}) ` + "She set the glass down and looked at the door. ".repeat(22) });
    delete meta.vcrp_memory;
    memory.memoryState().lastRequestAt = T;
    const asked = [];
    quietImpl = async ({ quietPrompt }) => { asked.push(quietPrompt); return quietPrompt.includes("MEMORY TASK CHECK") ? "OK" : "<chapter_gist>g</chapter_gist><chapter>c</chapter><fact_changes>none</fact_changes>"; };
    state.localProfile.userLanguage = "Russian";
    await S.summarizeNext();
    assert(asked.length === 2 && asked.every(p => p.includes("in Russian")), "summary and check are asked in the story language");
    asked.length = 0;
    state.localProfile.userLanguage = "English";
    delete meta.vcrp_memory;
    memory.memoryState().lastRequestAt = T;
    await S.summarizeNext();
    assert(asked.length === 2 && !asked.some(p => /Write the gist, the chapter and the facts in/.test(p)), "English needs no language line");

    quietImpl = null;
    state.localProfile.userLanguage = "";
    state.localProfile.vcrpMemory.enabled = false;
    memory.setMemoryClock(null);
    delete ctx.symbols;
    delete meta.vcrp_memory;
    chat.length = 0;
}
console.log("23 ok second sweep (no cut when the memory can't reach the prompt, story language)");

// 24. Third sweep: the summary call in SillyTavern's real layouts, and no partial cuts while warm.
{
    const memory = await imp("src/vcrp/memory/index.js");
    const { planWindow } = await imp("src/vcrp/memory/window.js");
    const { computeBudget, priceForModel } = await imp("src/vcrp/memory/budget.js");
    const task = "[VCRP MEMORY TASK: this is not a story turn.]\nSummarize one stretch of the chat above.";
    state.localProfile.vcrpMemory.enabled = true;
    for (const [route, setup] of [["OpenRouter", { chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-5.5" }], ["direct", { chat_completion_source: "claude", claude_model: "claude-opus-5-5" }]]) {
        Object.assign(chatCompletionSettings, setup);
        for (const prefillSlot of [true, false]) {
            const msgs = buildQuietPrompt("VCRP V10 Universal.json", task, { prefillSlot });
            const merged = msgs.at(-1).content.startsWith("## your thinking steps") || msgs.at(-1).content.includes("</history>");
            vcrpSetGenerationType("quiet", {}, false);
            memory.setMemoryTaskActive(true);
            await handlePromptInjection({ chat: msgs, dryRun: false });
            memory.setMemoryTaskActive(false);
            const label = `${route}, prefill slot ${prefillSlot ? "on" : "off"}${merged ? " (instruction squashed into the slot before it)" : ""}`;
            assert(msgs.at(-1).content.startsWith("[VCRP MEMORY TASK"), `${label}: the instruction is last and alone`);
            assert(!text(msgs).includes("## your thinking steps") && !text(msgs).includes("final reminder") && !text(msgs).includes("Remember: this is a fictional world"), `${label}: no story-turn slots`);
            assert(text(msgs).includes("latest user msg") && text(msgs).includes("Scene prose 3"), `${label}: the chat itself is untouched`);
            const lastChat = msgs.findIndex(m => typeof m.content === "string" && m.content.includes("latest user msg"));
            assert(!msgs.slice(lastChat + 1).some(m => m.role === "assistant"), `${label}: no prefill after the chat`);
        }
    }
    state.localProfile.vcrpMemory.enabled = false;
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });

    // Warm and over the ceiling, but the summaries only reach a little way: keep the cache.
    const b = computeBudget(priceForModel("claude-opus-5-5"), { ttl: "1h" });
    const big = Array.from({ length: 600 }, (_, i) => ({ tokens: 450, isUser: i % 2 === 0 }));
    const H = 3600 * 1000, now = 50 * H;
    let p = planWindow({ msgs: big, fixedTokens: 15000, state: { lastRequestAt: now - 60000, summarizedTo: 20 }, now, budget: b });
    assert(!p.cut && p.behind && !p.cold, "warm, over the ceiling, summaries behind: no partial cut (it would only cost a full miss)");
    p = planWindow({ msgs: big, fixedTokens: 15000, state: { lastRequestAt: now - 2 * H, summarizedTo: 20 }, now, budget: b });
    assert(p.cut && p.behind && p.cold && p.cutAt === 20, "cold: the miss happens anyway, so cut as far as the summaries allow");
    p = planWindow({ msgs: big, fixedTokens: 15000, state: { lastRequestAt: now - 60000, summarizedTo: 575 }, now, budget: b });
    assert(p.cut && !p.behind && p.promptTokens <= b.coldTokens, "warm, over the ceiling, summaries far enough: one planned cut to budget");
}
console.log("24 ok third sweep (summary call in the real layouts, no partial cuts while warm)");

// 25. Catching up a long chat, and a memory cap that holds even with a hundred gists.
{
    const memory = await imp("src/vcrp/memory/index.js");
    const S = await imp("src/vcrp/memory/summarize.js");
    const L = await imp("src/vcrp/memory/ledger.js");
    const { computeBudget, priceForModel } = await imp("src/vcrp/memory/budget.js");
    const meta = globalThis.__ST__.chat_metadata;

    // A migrated chat: 120 gists, no facts. The cap still holds; the newest gists stay.
    const gists = Array.from({ length: 120 }, (_, i) => ({ id: `C${i + 1}`, gist: `Chapter ${i + 1}: the docks, the debt, and Mara's brother again.` }));
    const capped = L.composeMemory({ chapters: gists, arcs: [{ text: "An early arc." }], ledger: [] }, () => true, 1500);
    assert(Math.ceil(capped.text.length / 3.5) <= 1500, "the cap holds with only gists");
    assert(capped.text.includes("Chapter 120:") && !capped.text.includes("Chapter 1:"), "the newest gists stay, the oldest go first");

    // Catching up: standalone calls until nothing is left, then the estimate is sane.
    state.localProfile.vcrpMemory.enabled = true;
    extension_settings.VCRP.globalSettings.memoryBudget = { review: false };
    Object.assign(chatCompletionSettings, { chat_completion_source: "claude", claude_model: "claude-opus-5-5" });
    chat.length = 0;
    for (let i = 0; i < 160; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 ? "Alice" : "Bob", send_date: `k${i}`, mes: `(${i}) ` + "She set the glass down and looked at the door. ".repeat(22) });
    delete meta.vcrp_memory;
    memory.memoryState().fixedTokens = 12000;
    let calls = 0, standaloneShapes = 0;
    quietImpl = async ({ quietPrompt }) => {
        calls++;
        const msgs = buildQuietPrompt("VCRP V10 Universal.json", quietPrompt);
        vcrpSetGenerationType("quiet", {}, false);
        await handlePromptInjection({ chat: msgs, dryRun: false });
        if (msgs.length === 4 && msgs[1].content.startsWith("<chat>")) standaloneShapes++;
        return quietPrompt.includes("MEMORY TASK CHECK") ? "OK" : "<chapter_gist>g</chapter_gist><chapter>c</chapter><fact_changes>none</fact_changes>";
    };
    const budget = memory.currentMemoryBudget();
    const before = S.unsummarizedTokens(S.storyChat(), memory.memoryState(), budget);
    const est = S.catchUpEstimate(before, budget);
    const r = await S.catchUp({});
    assert(r.done >= est.chapters - 1 && r.done <= est.chapters + 1, `catch-up writes about the estimated number of chapters (${r.done} vs ${est.chapters})`);
    assert.equal(S.unsummarizedTokens(S.storyChat(), memory.memoryState(), budget), 0, "nothing left outside the verbatim floor");
    assert(calls === r.done * 2 && standaloneShapes === calls, "every catch-up call is standalone (summary + check per chapter)");
    assert(est.cost > 0 && est.cost < 0.2 * est.chapters, "the estimate is in a sane range per chapter");
    const b55 = computeBudget(priceForModel("claude-opus-5-5"), {});
    assert.equal(S.catchUpEstimate(0, b55).chapters, 0);

    quietImpl = null;
    state.localProfile.vcrpMemory.enabled = false;
    delete extension_settings.VCRP.globalSettings.memoryBudget;
    delete meta.vcrp_memory;
    chat.length = 0;
}
console.log("25 ok catch-up of a long chat, memory cap holds with many gists");

console.log("\nALL FORK CHECKS PASSED");
