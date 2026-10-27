// Builds the Megumin Original versions straight from Megumin Suite itself, so not a word of
// the original is retyped by hand:
//
//   data/megumin.js                          the V10 pair and V11 Тайна, their thinking steps,
//                                            the original Enhanced Dialogue, V11's Notebook
//                                            texts, and the original wording of the shared
//                                            texts VCRP reworded
//   Presets/VCRP V10 Megumin Original.json   V10's preset text on VCRP's layout
//   Presets/VCRP V11 Megumin Original.json   V11's preset text on VCRP's layout
//
// The source is the upstream commit VCRP forked from. Run from the repo root after VCRP
// rewords a shared text or changes its preset layout:
//
//     node tools/gen_megumin.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const UPSTREAM = "0376573";   // Megumin Suite V10, the commit before "Fork Megumin Suite V10 as VCRP"
const tmp = join(tmpdir(), "vcrp_gen_megumin");
mkdirSync(tmp, { recursive: true });

// A module from either side, with its imports stubbed out: the data files need none,
// and the two that have some only use them inside functions this script never calls.
async function load(source, tag) {
    const stubbed = source.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm,
        (_, names) => `const { ${names} } = {};`);
    const file = join(tmp, `${tag}.mjs`);
    writeFileSync(file, stubbed);
    return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}
const upstreamText = f => execSync(`git show "${UPSTREAM}:${f}"`, { encoding: "utf8", maxBuffer: 1e8 });
const up = f => load(upstreamText(f), "up_" + f.replace(/\W/g, "_"));
const cur = f => load(readFileSync(f, "utf8"), "cur_" + f.replace(/\W/g, "_"));

const fail = msg => { throw new Error(msg); };
const tl = s => "`" + String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";

// ── Engines, thinking steps, Enhanced Dialogue ──────────────────────────────
const upModes = await up("data/modes/v10.js");
const upUkiyo = upModes.modes_v10.find(m => m.id === "v10-core") || fail("upstream Ukiyo not found");
const upShura = upModes.modes_v10.find(m => m.id === "v10-shura") || fail("upstream Shura not found");
const upCot = (await up("data/cot/v10.js")).cot_v10;
const cotIds = {
    "cot-v10-ukiyo-english": "cot-meg-ukiyo-english",
    "cot-v10-ukiyo-cap-english": "cot-meg-ukiyo-cap-english",
    "cot-v10-shura-english": "cot-meg-shura-english",
    "cot-v10-shura-cap-english": "cot-meg-shura-cap-english",
};
const cots = Object.entries(cotIds).map(([from, to]) => {
    const c = upCot.find(x => x.id === from) || fail("upstream CoT missing: " + from);
    return { id: to, content: c.content, prefill: c.prefill || "" };
});

// ── Shared texts VCRP reworded: only the entries that actually differ ───────
const [upStyles, curStyles] = [(await up("data/directStyles.js")).directStyles, (await cur("data/directStyles.js")).directStyles];
const styleRules = {};
for (const s of upStyles) {
    const c = curStyles.find(x => x.id === s.id);
    if (c && c.rule !== s.rule) styleRules[s.id] = s.rule;
}

const [upAddons, curAddons] = [(await up("data/addons.js")).addons, (await cur("data/addons.js")).addons];
const addonTexts = {};
for (const a of upAddons) {
    const c = curAddons.find(x => x.id === a.id);
    if (c && c.content !== a.content) addonTexts[a.id] = a.content;
}

const upPlan = Object.values(await up("src/prompts/storyPlan.js"))[0];
const curPlan = Object.values(await cur("src/prompts/storyPlan.js"))[0];
const planTexts = {};
for (const k of ["injectionTemplate", "trackerTemplate"]) if (upPlan[k] !== curPlan[k]) planTexts[k] = upPlan[k];

// Story Config: an option is matched by its label, or by a label VCRP still lists as legacy.
const [upCfg, curCfg] = [(await up("src/features/storyconfig/config.js")).storyConfigFields, (await cur("src/features/storyconfig/config.js")).storyConfigFields];
const cfgNotes = {}, cfgValues = {};
const opt = o => typeof o === "string" ? { label: o, value: o, legacy: [] } : { legacy: [], ...o };
for (const f of curCfg) {
    const u = upCfg.find(x => x.key === f.key);
    if (!u) continue;
    if ((u.aiNote || "") !== (f.aiNote || "")) cfgNotes[f.key] = u.aiNote || "";
    for (const o of (f.options || []).map(opt)) {
        const names = [o.label, ...o.legacy].map(s => String(s).toLowerCase());
        const uo = (u.options || []).map(opt).find(x => names.includes(String(x.label).toLowerCase()));
        if (uo && uo.value !== o.value) cfgValues[o.value] = uo.value;
    }
}

// The onomatopoeia styling line lives inline in the slot builder. Taken as source text,
// escapes and all, and written back out the same way.
const onoRe = /onoRule \+= `([^`]*)`/;
const upOno = (upstreamText("src/engine/buildBaseDict.js").match(onoRe) || fail("upstream onomatopoeia line not found"))[1];
if (upOno.includes("${")) fail("the upstream onomatopoeia line has a placeholder; copy it by hand");

// ── V11 Тайна (Megumin Suite V11, from the Beta repository) ─────────────────
// Megumin-Suite-Beta: git remote add megumin-beta https://github.com/Arif-salah/Megumin-Suite-Beta.git
// V11 leaves the V10 engines, their thinking steps and the shared texts as they were; it adds
// its engines (the first one, now "V11 Тайна Preview", and V11 Тайна, its Writers' Room and its
// DeepSeek version), their thinking steps, its two writing styles, the Author's Notebook's
// texts, the words its preset's sections are built from, its Story Config wording, and its
// own preset (below).
const V11_UPSTREAM = "e8378fe";   // "25/10 update": three new V11 Тайна engines, V11 Inside, the preset in slots
const v11Text = f => execSync(`git show "${V11_UPSTREAM}:${f}"`, { encoding: "utf8", maxBuffer: 1e8 });
const v11 = f => load(v11Text(f), "v11_" + f.replace(/\W/g, "_"));
const upV11 = (await v11("data/modes/v11.js")).modes_v11.find(m => m.id === "v11-room") || fail("upstream V11 engine not found");
const v11Taina = await v11("data/modes/v11taina.js");
const upTaina = id => v11Taina.modes_v11taina.find(m => m.id === id) || fail("upstream V11 engine not found: " + id);
const v11CotMod = await v11("data/cot/v11.js");
const v11TainaCots = (await v11("data/cot/v11taina.js")).cot_v11taina;
const v11Cots = ["cot-v11-english", "cot-v11-cap-english", "cot-v11-voice-english", "cot-v11-wr-english"].map(id => {
    const c = [...v11CotMod.cot_v11, ...v11TainaCots].find(x => x.id === id) || fail("upstream V11 CoT missing: " + id);
    return { id, content: c.content, prefill: c.prefill || "" };
});
const v11Styles = (await v11("data/directStyles.js")).directStyles;
const v11Style = v11Styles.find(s => s.id === "dir_v11") || fail("upstream V11 style missing");
const v11Inside = v11Styles.find(s => s.id === "dir_v11_inside") || fail("upstream V11 Inside style missing");
const v11Render = await v11("src/state/modules/notebook/render.js");
const v11UserRule = (v11Text("data/slots.js").match(/fallback: \(\) => "(\d+\. The response does not speak[^"]*)"/) || fail("upstream V11 {{user}} rule not found"))[1];
// The words V11's preset sections are built from (src/prompts/presetFrame.js and v11Rules.js):
// the older headings for V11 Тайна Preview, the tags for the V11 Тайна turn frame.
const v11Frame = await v11("src/prompts/presetFrame.js");
const v11Rules = await v11("src/prompts/v11Rules.js");
const language = v11Rules.languageLine("zzz");
if (!language.includes("Zzz")) fail("upstream V11 language line changed shape");
const V11 = {
    notebookCraft: (await v11("src/prompts/notebook.js")).NOTEBOOK_CRAFT || fail("upstream notebook text missing"),
    notebookSetup: v11Render.renderNotebookSetup(),
    notebookUpdate: v11Render.renderNotebookUpdateRules({ newOnly: false }),
    capNudge: v11CotMod.V11_CAP_NUDGE || fail("upstream Thinking Cap nudge missing"),
    styleName: v11Style.name, styleDesc: v11Style.desc, styleRule: v11Style.rule,
    insideName: v11Inside.name, insideDesc: v11Inside.desc, insideRule: v11Inside.rule,
    userRule: v11UserRule,
    thinkingHeader: v11Frame.THINKING_HEADER,
    formattingHeader: v11Frame.FORMATTING_HEADER,
    formattingRules: v11Frame.FORMATTING_RULES,
    reminderHeader: v11Frame.REMINDER_HEADER,
    finalChecks: v11Frame.FINAL_CHECKS,
    banlistCheck: v11Frame.BANLIST_CHECK,
    banList: v11Frame.BUILTIN_BAN_LIST,
    banListV11: v11Taina.V11_BAN_LIST || fail("upstream V11 ban list missing"),
    banAdditions: v11Rules.BAN_ADDITIONS,
    storySettingsPreamble: v11Rules.STORY_SETTINGS_PREAMBLE,
    finalCheckHead: v11Rules.FINAL_CHECK_HEAD,
    languageLine: language.replace("Zzz", "{{language}}"),
    sound: v11Rules.ADDON_RULES_SPLIT.onomato,
    soundStyled: v11Rules.ADDON_RULES_SPLIT.onomatoStyled,
};
for (const [k, v] of Object.entries(V11)) if (typeof v !== "string" || !v.trim()) fail("upstream V11 text missing: " + k);

// V11's Story Config wording, for its engines: by the option VCRP holds (its label or a legacy
// one matching V11's label or legacy), and the field notes V11 changed.
const v11Cfg = (await v11("src/features/storyconfig/config.js")).storyConfigFields;
const v11CfgNotes = {}, v11CfgValues = {};
for (const f of curCfg) {
    const u = v11Cfg.find(x => x.key === f.key);
    if (!u) continue;
    if ((u.aiNote || "") !== (f.aiNote || "")) v11CfgNotes[f.key] = u.aiNote || "";
    for (const o of (f.options || []).map(opt)) {
        const names = [o.label, ...o.legacy].map(s => String(s).toLowerCase());
        const uo = (u.options || []).map(opt).find(x => [x.label, ...x.legacy].some(n => names.includes(String(n).toLowerCase())));
        if (uo && uo.value !== o.value) v11CfgValues[o.value] = uo.value;
    }
}

// ── data/megumin.js ─────────────────────────────────────────────────────────
// V11's engines carry their Content section, their final check and (the V11 Тайна turn frame)
// their repetition rule beside the engine text.
const engine = (base, meta) => `    {
        ${meta},
        megumin: true,
${["p1", "p2", "p3", "p4", "p5", "p6", "contentRules", "repetition", "reminderChecks"].filter(k => base[k] !== undefined).map(k => `        ${k}: ${tl(base[k])},`).join("\n")}
    }`;
const v11Meta = (m, id, label, color) => `id: "${id}", label: "${label}", color: "${color}", isNew: true, isV11: true, isCoreClone: true, notebook: true${m.turnFrame ? `, turnFrame: "${m.turnFrame}"` : ""}`;
const obj = o => `{\n${Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${tl(v)},`).join("\n")}\n}`;

const js = `// ─────────────────────────────────────────────────────────────────────────────
// MEGUMIN ORIGINAL: Megumin Suite V10's and V11's own writing text, word for word.
//
// GENERATED FILE. Do not edit by hand; run:
//
//     node tools/gen_megumin.mjs
//
// Source: Megumin Suite V10, upstream commit ${UPSTREAM}; V11 Тайна from the Beta repository,
// commit ${V11_UPSTREAM}. The engines and thinking steps are separate entries beside VCRP's.
// The tables below hold the original wording of the shared texts VCRP reworded (styles,
// add-ons, Story Config, Story Director), and src/engine/meguminOriginal.js swaps them in
// while a Megumin Original engine is active.
// ─────────────────────────────────────────────────────────────────────────────

export const MEGUMIN_UPSTREAM = "${UPSTREAM}";

export const modes_megumin = [
${engine(upUkiyo, `id: "v10-ukiyo-megumin", label: "V10 Ukiyo · Megumin Original", color: "#fb7185", isNew: true, isV10: true, isCoreClone: true`)},
${engine(upShura, `id: "v10-shura-megumin", label: "V10 Shura · Megumin Original", color: "#c084fc", isNew: true, isV10: true, isCoreClone: true`)},
${engine(upTaina("v11-voice"), v11Meta(upTaina("v11-voice"), "v11-voice-megumin", "V11 Тайна · Megumin Original", "#0ea5e9"))},
${engine(upTaina("v11-writers-room"), v11Meta(upTaina("v11-writers-room"), "v11-writers-room-megumin", "V11 Тайна · Writers' Room · Megumin Original", "#6366f1"))},
${engine(upTaina("v11-deepseek"), v11Meta(upTaina("v11-deepseek"), "v11-deepseek-megumin", "V11 Тайна DeepSeek · Megumin Original", "#4d6bfe"))},
${engine(upV11, v11Meta(upV11, "v11-room-megumin", "V11 Тайна Preview · Megumin Original", "#38bdf8"))},
];

export const cot_megumin = [
${[...cots, ...v11Cots].map(c => `    { id: "${c.id}", trigger: "[[COT]]", content: ${tl(c.content)}, prefill: ${tl(c.prefill)} },`).join("\n")}
];

// Megumin Suite V11 (Beta repository, commit ${V11_UPSTREAM}): the texts around its engines,
// and the words its preset's sections are built from (src/engine/meguminV11.js).
export const MEGUMIN_V11_UPSTREAM = "${V11_UPSTREAM}";
export const MEGUMIN_V11 = ${obj(V11)};

// Story Config in V11's wording, for its engines: field notes by key, option texts keyed by VCRP's.
export const MEGUMIN_V11_CONFIG = {
    notes: ${obj(v11CfgNotes).replace(/\n/g, "\n    ")},
    values: ${obj(v11CfgValues).replace(/\n/g, "\n    ")},
};

export const MEGUMIN_ENHANCED_DIALOGUE = ${tl(upModes.ENHANCED_DIALOGUE)};

// Writing styles by id: the original rule, for each style VCRP reworded.
export const MEGUMIN_STYLE_RULES = ${obj(styleRules)};

// Add-ons by id: the original text, for each add-on VCRP reworded.
export const MEGUMIN_ADDONS = ${obj(addonTexts)};

// Story Director templates VCRP reworded.
export const MEGUMIN_STORYPLAN = ${obj(planTexts)};

// Story Config: field notes by key, and option texts keyed by VCRP's wording.
export const MEGUMIN_CONFIG = {
    notes: ${obj(cfgNotes).replace(/\n/g, "\n    ")},
    values: ${obj(cfgValues).replace(/\n/g, "\n    ")},
};

// The onomatopoeia styling line.
export const MEGUMIN_ONOMATO_STYLING = \`${upOno}\`;
`;
writeFileSync("data/megumin.js", js);
console.log(`data/megumin.js: 6 engines, ${cots.length + v11Cots.length} thinking steps, ${Object.keys(styleRules).length} styles, ${Object.keys(addonTexts).length} add-ons, ${Object.keys(planTexts).length} director templates, ${Object.keys(cfgNotes).length} config notes, ${Object.keys(cfgValues).length} config values; V11: ${Object.keys(v11CfgNotes).length} config notes, ${Object.keys(v11CfgValues).length} config values`);

// ── The preset ──────────────────────────────────────────────────────────────
// VCRP's preset is the frame: slot order, roles, injection depths, the CoT Prefill
// slot VCRP decides per model, the bundled regex, the sampler settings. Those are what
// Story Memory and the cache depend on. Every slot of WRITING text is Megumin's own,
// from the Cache Friendly preset (the layout VCRP's is built on), with only the tags
// for features VCRP removed taken out and the tags for its own features put in.
const vcrp = JSON.parse(readFileSync("Presets/VCRP V10 Universal.json", "utf8"));
const upCF = JSON.parse(upstreamText("Presets/Megumin Suite V10 Universal Cache Friendly.json"));
const upText = name => (upCF.prompts.find(p => p.name === name) || fail("upstream slot missing: " + name)).content;

function edit(text, swaps, name) {
    for (const [a, b] of swaps) {
        const n = text.split(a).length - 1;
        if (n !== 1) fail(`${name}: expected one "${a.slice(0, 40)}", found ${n}`);
        text = text.replace(a, b);
    }
    return text;
}

const original = {
    // Removed features: Death, Combat and Organic NPCs. VCRP's Bold NPCs add-on sits where they
    // did, and its always-on knowledgebase entries before the ban list, where VCRP's preset has them.
    // The Pura engines' standing toggles and the tracker rules close the slot (both empty
    // unless something is on), as in VCRP's preset.
    "Main 2": edit(upText("Main 2"), [
        ["[[prompt5]]\n\n[[death]]\n\n[[combat]]\n\n[[npc_events]]\n\n[[prompt6]]", "[[prompt5]]\n\n[[boldnpcs]]\n\n[[prompt6]]"],
        ["[[html]]\n\n<banlist>", "[[html]]\n\n[[knowledgebase_always]]\n\n<banlist>"],
    ], "Main 2") + "[[pura_system]][[block_rules]]",
    "<lore>": upText("<lore>"),
    "</lore><user_persona>": upText("</lore><user_persona>"),
    // Removed features: Direct Language, Dice, Image Gen, MVU. Story Memory's recall and
    // VCRP's knowledgebase, anime mode and Focus go where VCRP's preset has them; each is
    // empty unless its feature is on.
    "Output RULES": edit(upText("Output RULES"), [
        ["Check the chat history.\n[[Direct]]\n[[DN]]", "Check the chat history.\n[[DN]]"],
        ["[[npc list]]\n\n[[dice]]\n\n[[img1]]\n\n[[blocks]]", "[[npc list]]\n\n[[story_recall]]\n\n[[knowledgebase]]\n\n[[ANIMEMODE]]\n\n[[focus]]\n\n[[blocks]]"],
        ["[[Language]]\n[[MVU]]\n", "[[Language]]\n"],
    ], "Output RULES"),
    // The Pura engines' per-turn text, then the plot focus (VCRP Focus), close the slot:
    // the last things the model reads.
    "</history>": upText("</history>") + "[[pura_late]][[plotfocus]]",
    // Off by default. The original, minus the one slur VCRP took out.
    "USER Consent": edit(upText("USER Consent"), [["gooner, nigga.....etc", "gooner.....etc"]], "USER Consent"),
};
// Main Prompt is VCRP's: the original's [[main]], [[control]] and [[OOC]] are blank on
// every V10 engine, so dropping them changes nothing the model reads.
const preset = JSON.parse(JSON.stringify(vcrp));
for (const [name, text] of Object.entries(original)) {
    const slot = preset.prompts.find(p => p.name === name) || fail("VCRP slot missing: " + name);
    slot.content = text;
}
for (const name of ["</user_persona>", "<history>"]) {
    if (upText(name) !== preset.prompts.find(p => p.name === name).content) fail(`${name} differs from the original; decide which to ship`);
}
writeFileSync("Presets/VCRP V10 Megumin Original.json", JSON.stringify(preset, null, 4).replace(/\n/g, "\r\n"));
console.log("Presets/VCRP V10 Megumin Original.json: " + Object.keys(original).length + " slots of original text on VCRP's layout");

// ── The V11 preset ──────────────────────────────────────────────────────────
// Megumin V11's own preset on the same VCRP frame. V11 keeps its words in the extension now
// and its preset is only slots: the rules up top (cached), what changes each turn after the
// chat. The sections are built in src/engine/meguminV11.js from V11's words (data/megumin.js).
// Only the tags change, as for V10: removed features out (dice, images, MVU), VCRP's in. Up top,
// V11's Main 2, Add-on rules and Ban list run together in VCRP's Main 2, and V11's Block rules
// are VCRP's: its block instructions travel with [[blocks]], and its [[block_rules]] (Pura's
// trackers) still closes Main 2. After the chat, in V11's order, in VCRP's Output RULES: V11's
// Current info is VCRP's per-turn notes (the Story Director's plan, the NPC dossier rules and
// list, recall, the knowledgebase, Anime mode, Focus: they change turn to turn), then the
// Content section, the Story settings, the thinking, and This turn, whose <Blocks> skeleton is
// VCRP's [[blocks]].
const upV11P = JSON.parse(v11Text("Presets/Megumin Suite V11 Universal.json"));
const v11Prompt = name => upV11P.prompts.find(p => p.name === name) || fail("upstream V11 slot missing: " + name);
const v11Is = (name, text) => { if (v11Prompt(name).content !== text) fail(`upstream V11 slot changed: ${name}; decide how to carry it`); };
v11Is("Add-on rules", "[[addon_rules]]\n\n[[storyplan_rules]]");
v11Is("Ban list", "[[banned]]");
v11Is("Block rules", "[[block_rules]]\n\n[[npc_rules]]\n\n[[dice_rules]]\n\n[[img_rules]]");
v11Is("Current info", "[[infoblockcurrent]]\n\n[[npc list]]\n\n[[storyplan_now]]");
v11Is("Content rule", "[[content]]");
v11Is("Story settings", "[[config]]");
v11Is("Thinking", "[[thinking]]");
const originalV11 = {
    "Main 2": edit(v11Prompt("Main 2").content, [
        ["[[prompt5]]\n\n[[prompt6]]", "[[prompt5]]\n\n[[boldnpcs]]\n\n[[prompt6]]"],
    ], "V11 Main 2") + "\n\n[[addon_rules]]\n\n[[knowledgebase_always]]\n\n[[banned]][[pura_system]][[block_rules]]",
    "<lore>": v11Prompt("<lore>").content,
    "</lore><user_persona>": v11Prompt("</lore><user_persona>").content,
    "Output RULES": [
        "[[storyplan]]\n\n[[npc_dossier]]\n\n[[npc list]]\n\n[[story_recall]]\n\n[[knowledgebase]]\n\n[[ANIMEMODE]]\n\n[[focus]]",
        "[[content]]",
        "[[config]]",
        "[[thinking]]",
        edit(v11Prompt("This turn").content, [
            ["[[this_turn]]", "[[blocks]]"],
            ["[[Language]]\n[[MVU]]\n", "[[Language]]\n"],
        ], "V11 This turn"),
    ].join("\n\n"),
    "</history>": v11Prompt("</history>").content + "[[pura_late]][[plotfocus]]",
};
const presetV11 = JSON.parse(JSON.stringify(vcrp));
for (const [name, text] of Object.entries(originalV11)) {
    const slot = presetV11.prompts.find(p => p.name === name) || fail("VCRP slot missing: " + name);
    slot.content = text;
}
for (const name of ["</user_persona>", "<history>"]) {
    if (v11Prompt(name).content !== presetV11.prompts.find(p => p.name === name).content) fail(`V11 ${name} differs from VCRP's; decide which to ship`);
}
// V11 has no consent or jailbreak slot any more: USER Consent goes. Its USER note goes in
// before the history (cached), where V11 has it.
const KEYS = ["identifier", "system_prompt", "enabled", "marker", "name", "role", "content", "injection_position", "injection_depth", "injection_order", "injection_trigger", "forbid_overrides"];
const pick = p => Object.fromEntries(KEYS.filter(k => k in p).map(k => [k, p[k]]));
const CONSENT = "753facc3-4171-4bc5-a005-ab9d1111e469";
if (!presetV11.prompts.some(p => p.identifier === CONSENT)) fail("VCRP slot missing: USER Consent");
presetV11.prompts = presetV11.prompts.filter(p => p.identifier !== CONSENT);
for (const o of presetV11.prompt_order) o.order = o.order.filter(x => x.identifier !== CONSENT);
const userNote = pick(v11Prompt("USER"));
presetV11.prompts.push(userNote);
for (const o of presetV11.prompt_order) {
    // The order SillyTavern uses (100001) must have the anchor; the default one may not list it.
    const at = o.order.findIndex(x => x.identifier === "b1e50687-f98d-41aa-9785-230879068ad1");
    if (at < 0 && o.character_id === 100001) fail(`VCRP order ${o.character_id} has no </user_persona>`);
    if (at >= 0) o.order.splice(at + 1, 0, { identifier: userNote.identifier, enabled: true });
}
writeFileSync("Presets/VCRP V11 Megumin Original.json", JSON.stringify(presetV11, null, 4).replace(/\n/g, "\r\n"));
console.log("Presets/VCRP V11 Megumin Original.json: " + (Object.keys(originalV11).length + 1) + " slots of V11's preset on VCRP's layout");
