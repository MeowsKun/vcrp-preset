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

console.log("\nALL FORK CHECKS PASSED");
