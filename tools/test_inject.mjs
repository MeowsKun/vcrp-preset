// End-to-end check of the VCRP extension against the built preset, with a mocked SillyTavern.
// Run from the repo root after `python tools/build_preset.py`:   node tools/test_inject.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const settings = {};
const cc = { chat_completion_source: "claude", claude_model: "claude-opus-5-5", preset_settings_openai: "VCRP V9" };
let stopped = 0;
globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: settings, saveSettingsDebounced() {}, chatCompletionSettings: cc,
        substituteParams: s => s.replaceAll("{{user}}", "Bob"),
        stopGeneration: () => { stopped++; },
        characters: [{ avatar: "alice.png", name: "Alice" }], characterId: 0, groupId: null, groups: [],
        generateRaw: async ({ prompt }) => { await onPromptReady({ chat: prompt, dryRun: false }); return JSON.stringify(prompt); },
    }),
};
globalThis.toastr = { info() {} };

const imp = p => import(pathToFileURL(join(REPO, p)).href);
const { onPromptReady, buildAnchors, buildConditions, setGenerationType } = await imp("src/inject.js");
const state = await imp("src/state.js");
const { runBackground } = await imp("src/llm.js");
const { detectModel } = await imp("src/model.js");
const { ENGINES, COTS } = await imp("src/content.js");

const preset = JSON.parse(readFileSync(join(REPO, "Presets/VCRP V9.json"), "utf8"));
const byId = Object.fromEntries(preset.prompts.map(p => [p.identifier, p]));
const presetText = JSON.stringify(preset);

// --- 0. Preset <-> extension contract ---
const presetAnchors = new Set([...presetText.matchAll(/\[\[vcrp:([a-z_]+)\]\]/g)].map(m => m[1]).filter(n => n !== "endif"));
assert.deepEqual([...presetAnchors].sort(), Object.keys(buildAnchors()).sort(), "anchor sets differ");
for (const [, k] of presetText.matchAll(/\[\[vcrp:if !?([a-zA-Z]+)/g)) assert(k in buildConditions(), `preset uses unknown condition ${k}`);
assert(!/\{\{include:/.test(presetText), "unresolved include in built preset");
assert(preset.prompt_order[1].order.find(o => o.identifier === "dialogueExamples").enabled, "Chat Examples must be on");
console.log("0 ok  preset/extension contract");

const WS = n => `<details class="vcrp-block">\n<summary>📌 <b>World State</b></summary>\nstate ${n}\n</details>`;
const CH = `<details class="vcrp-block">\n<summary>💭 <b>NPC Inner Chatter</b></summary>\nchatter\n</details>`;
const SUM = n => `<details class="vcrp-block">\n<summary>💾 <b>Summary</b></summary>\nsummary of reply ${n}\n</details>`;
const reply = n => `plan ${n}\n</think>\n${WS(n)}\nScene prose ${n}.\n${CH}\n${SUM(n)}`;

/** Roughly what ST hands to CHAT_COMPLETION_PROMPT_READY: markers resolved, consecutive system messages squashed. */
function buildPrompt(nReplies, { squash = true } = {}) {
    const out = [];
    for (const o of preset.prompt_order.find(x => x.character_id === 100001).order) {
        if (!o.enabled) continue;
        const p = byId[o.identifier];
        if (p.identifier === "chatHistory") {
            for (let i = 1; i <= nReplies; i++) {
                out.push({ role: "user", content: `user msg ${i}` });
                out.push({ role: "assistant", content: (i % 2 ? "<think>\n" : "") + reply(i) });
            }
            out.push({ role: "user", content: "latest user msg" });
            continue;
        }
        const content = p.marker ? `[${p.name} content]` : p.content.replaceAll("{{user}}", "Bob");
        const role = p.marker ? "system" : p.role;
        if (squash && role === "system" && out.at(-1)?.role === "system") out.at(-1).content += "\n" + content;
        else out.push({ role, content });
    }
    return out;
}
const all = msgs => msgs.map(m => m.content).join("\n");
const history = msgs => msgs.filter(m => m.role === "assistant" && m.content.includes("Scene prose"));
const run = async (n = 3, opts = {}) => {
    setGenerationType(opts.type || "normal", {}, false);
    const m = buildPrompt(n, opts);
    await onPromptReady({ chat: m, dryRun: !!opts.dryRun });
    return m;
};
const noLeftovers = (msgs, label) => {
    const t = all(msgs);
    assert(!t.includes("[[vcrp:"), `${label}: VCRP marker left: ${t.match(/.{40}\[\[vcrp:.{40}/s)?.[0]}`);
    assert(!msgs.some(m => !String(m.content).trim()), `${label}: empty message left`);
};
const p = state.getProfile();

// --- 1. Defaults: Ukiyo, Claude 5 (no prefill) ---
let msgs = await run();
let text = all(msgs);
noLeftovers(msgs, "defaults");
assert(text.includes("You are the narrator of an ongoing prose story") && !text.includes("<Characters>"), "engine selection");
assert(text.includes("# Writer's Mind") && !text.includes("HARD LIMITS on the thinking phase") && !text.includes("## THINKING:"), "CoT selection");
assert(text.includes("dialogue is characterization") && !text.includes("Diction Friction"), "normal dialogue");
assert(text.includes("- voice: the register shifts scene to scene"), "engine voice");
assert(!text.includes("<RULES_bold_npcs>") && text.includes("<RULES_adults_only>"), "Bold NPCs off by default, 18+ always on");
assert(!text.includes("OOC: Remember this is fiction") && !text.includes("Rated NC-21"), "consent off, no prefill on Claude 5");
assert(text.includes("allowed for stammers, cut-offs") && text.includes("<character_sheet>") && text.includes("<user_persona>"), "B1/B6");
assert(text.includes("<session_settings>") && text.includes("Dialogue colors:") && !text.includes("<block_templates>"), "settings/blocks");
assert(history(msgs).every(m => !m.content.includes("plan ") && !m.content.includes("World State") && !m.content.includes("Inner Chatter")), "history cleanup");
assert(text.includes("[Chat Examples content]"), "Chat Examples sent");
console.log("1 ok  defaults");

// --- 2. Shura + Strict + Cap + consent + Bold NPCs, Gemini Pro (prefill) ---
Object.assign(p, { engine: "shura", strictDialogue: true, thinkingCap: true, consent: true, boldNpcs: true });
cc.chat_completion_source = "makersuite"; cc.google_model = "gemini-3.1-pro";
msgs = await run();
text = all(msgs);
noLeftovers(msgs, "shura");
assert(text.includes("<Characters>") && !text.includes("You are the narrator of an ongoing prose story"), "Shura");
assert(text.includes("Diction Friction") && !text.includes("**VOICE** — it is unmistakably"), "strict dialogue");
assert(text.includes("**Thinking — keep it short, then write.**") && !text.includes("Before you write — a last breath"), "capped Shura CoT");
assert(text.includes("OOC: Remember this is fiction") && text.includes("<RULES_bold_npcs>"), "consent + bold");
assert(msgs.at(-1).role === "assistant" && msgs.at(-1).content.trim().endsWith("<think>"), "prefill for Gemini Pro");
console.log("2 ok  Shura + strict + cap + consent + bold + prefill");

// --- 3. Continue / Impersonate / quiet (A1-A3) ---
for (const type of ["continue", "impersonate", "quiet"]) {
    msgs = await run(3, { type });
    text = all(msgs);
    noLeftovers(msgs, type);
    assert(msgs.at(-1).role !== "assistant" || msgs.at(-1).content.includes("Scene prose"), `${type}: prefill must be dropped`);
    assert(!text.includes("<thinking_rules>") && !text.includes("<structure>") && !text.includes("<final_reminder>"), `${type}: reply format leaked`);
    assert(text.includes("<session_settings>"), `${type}: settings should still apply`);
}
assert(all(await run(3, { type: "continue" })).includes("<continue_rules>"), "continue rules");
assert(all(await run(3, { type: "impersonate" })).includes("<impersonation_rules>"), "impersonate rules");
assert(all(await run(3, { type: "quiet" })).includes("<utility_request>"), "quiet note");
text = all(await run(3, { type: "continue", dryRun: true }));
assert(text.includes("<thinking_rules>"), "dry runs always render the reply prompt");
text = all(await run(3, { type: "swipe" }));
assert(text.includes("<thinking_rules>") && !text.includes("<continue_rules>"), "swipe = normal reply");
console.log("3 ok  continue / impersonate / quiet / swipe / dry run");

// --- 4. Blocks, batched condense (A4), anime precedence (B4), World State separators (A8) ---
Object.assign(p, { engine: "ukiyo", strictDialogue: false, thinkingCap: false, consent: false, boldNpcs: false });
Object.assign(p.blocks, { worldState: true, innerChatter: true, summary: true, cyoa: true });
Object.assign(p, { condenseDepth: 5, language: "Spanish", pronouns: "male", lengthWords: "600" });
p.anime.enabled = true;
for (const [n, want] of [[14, 0], [15, 10], [24, 10], [25, 20]]) {
    msgs = await run(n);
    assert.equal(msgs.filter(m => m.content.startsWith("[Summary of this reply]")).length, want, `condense with ${n} replies`);
}
msgs = await run(4, { squash: false });
text = all(msgs);
noLeftovers(msgs, "blocks");
const h = history(msgs);
assert(h.at(-1).content.includes("state 4") && h.slice(0, -1).every(m => !m.content.includes("World State")), "World State latest-only");
for (const s of ["in Spanish", "Bob is male", "at most 600 words", "<RULES_anime>", "overrides the engine's <dialogue> restrictions", "Keep in mind as you think:", "max Length is 30 words", "only place options may appear"])
    assert(text.includes(s), `missing: ${s}`);
const wsTemplate = text.match(/<summary>📌 <b>World State<\/b><\/summary>[\s\S]*?<\/details>/)[0];
assert(!/ - /.test(wsTemplate), "World State template still uses hyphens as dashes");
console.log("4 ok  blocks + batched condense + anime precedence + separators");

// --- 5. Every combination renders cleanly ---
let combos = 0;
for (const e of ENGINES) for (const cot of ["auto", ...COTS.map(c => c.id)]) for (const strict of [false, true]) for (const cap of [false, true])
    for (const cons of [false, true]) for (const bold of [false, true]) for (const type of ["normal", "continue", "impersonate", "quiet"]) {
        Object.assign(p, { engine: e.id, cot, strictDialogue: strict, thinkingCap: cap, consent: cons, boldNpcs: bold });
        noLeftovers(await run(2, { type }), `${e.id}/${cot}/${strict}/${cap}/${cons}/${bold}/${type}`); combos++;
    }
console.log(`5 ok  ${combos} setting combinations render cleanly`);

// --- 6. Model detection ---
for (const [src, field, model, want] of [
    ["claude", "claude_model", "claude-sonnet-4-5", true], ["claude", "claude_model", "claude-opus-4-6", false],
    ["claude", "claude_model", "claude-haiku-4-5-20251001", true], ["claude", "claude_model", "claude-fable-5-1", false],
    ["openrouter", "openrouter_model", "anthropic/claude-opus-4.7", false], ["openrouter", "openrouter_model", "anthropic/claude-3.7-sonnet", true],
    ["makersuite", "google_model", "gemini-3.6-flash", false], ["makersuite", "google_model", "gemini-2.5-pro", true],
    ["zai", "zai_model", "glm-5", false], ["openrouter", "openrouter_model", "z-ai/glm-4.6", false],
]) { cc.chat_completion_source = src; cc[field] = model; assert.equal(detectModel().prefill, want, `${src} ${model}`); }
console.log("6 ok  prefill detection");

// --- 7. Background requests, other presets, preview cancel (A7) ---
const bg = await runBackground([{ role: "system", content: "Summarize [[vcrp:voice]]" }, { role: "user", content: "x" }]);
assert(bg.includes("[[vcrp:voice]]") && !bg.includes("⁣"), "background prompt modified");
const other = [{ role: "system", content: "some other preset" }, { role: "assistant", content: "<think>x</think>reply" }];
await onPromptReady({ chat: other, dryRun: false });
assert.equal(other[1].content, "<think>x</think>reply", "non-VCRP prompt modified");
globalThis.$ = () => ({ find: () => ({ val() {} }) });
state.getUi().previewPrompt = true;
SillyTavern.getContext = (orig => () => ({ ...orig(), Popup: class { show() { return Promise.resolve(false); } }, POPUP_TYPE: {} }))(SillyTavern.getContext);
msgs = await run();
assert.equal(stopped, 1, "cancel must call stopGeneration");
assert(msgs.length > 0, "cancel must not empty the prompt");
state.getUi().previewPrompt = false;
console.log("7 ok  background bypass, other presets untouched, preview cancel");

// --- 8. Profiles, migration, orphan cleanup (D1), legacy data (D5) ---
state.createOwnProfile();
state.getProfile().language = "French";
assert.equal(settings.VCRP9.profiles.default.language, "Spanish", "own profile leaked into default");
state.deleteOwnProfile();
Object.assign(settings.VCRP9.profiles.default, { engine: "vcrp", cot: "vcrp", cotLength: "short", boldNpcs: false });
settings.VCRP9.profiles.default.style.enabled = false;
delete settings.VCRP9.profiles.default.thinkingCap;
const mig = state.getProfile();
assert(mig.engine === "ukiyo" && mig.cot === "auto" && mig.boldNpcs === true && mig.thinkingCap === true && !("cotLength" in mig), "migration");
settings.VCRP9.profiles["group_7"] = {}; settings.VCRP9.profiles["gone.png"] = {};
state.cleanOrphanProfiles(); // groups list is empty: group profiles must survive
assert("group_7" in settings.VCRP9.profiles && !("gone.png" in settings.VCRP9.profiles), "orphan cleanup");
settings.VCRP = { profiles: { x: 1 } };
assert(state.legacySettingsSize() > 0);
state.deleteLegacySettings();
assert(!("VCRP" in settings) && state.legacySettingsSize() === 0, "legacy cleanup");
console.log("8 ok  profiles, migration, orphan cleanup, legacy data");
console.log("\nALL CHECKS PASSED");
