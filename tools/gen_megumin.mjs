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
// an engine, its thinking steps, its writing style, the Author's Notebook's texts, and its own
// preset (below).
const V11_UPSTREAM = "2935045";   // "18/10 update": V11 Тайна with its first fixes
const v11Text = f => execSync(`git show "${V11_UPSTREAM}:${f}"`, { encoding: "utf8", maxBuffer: 1e8 });
const v11 = f => load(v11Text(f), "v11_" + f.replace(/\W/g, "_"));
const upV11 = (await v11("data/modes/v11.js")).modes_v11.find(m => m.id === "v11-room") || fail("upstream V11 engine not found");
const v11CotMod = await v11("data/cot/v11.js");
const v11Cots = ["cot-v11-english", "cot-v11-cap-english"].map(id => {
    const c = v11CotMod.cot_v11.find(x => x.id === id) || fail("upstream V11 CoT missing: " + id);
    return { id, content: c.content, prefill: c.prefill || "" };
});
const v11Style = (await v11("data/directStyles.js")).directStyles.find(s => s.id === "dir_v11") || fail("upstream V11 style missing");
const v11Render = await v11("src/state/modules/notebook/render.js");
const v11UserRule = (v11Text("data/slots.js").match(/fallback: \(\) => "(\d+\. The response does not speak[^"]*)"/) || fail("upstream V11 {{user}} rule not found"))[1];
const V11 = {
    notebookCraft: (await v11("src/prompts/notebook.js")).NOTEBOOK_CRAFT || fail("upstream notebook text missing"),
    notebookSetup: v11Render.renderNotebookSetup(),
    notebookUpdate: v11Render.renderNotebookUpdateRules({ newOnly: false }),
    capNudge: v11CotMod.V11_CAP_NUDGE || fail("upstream Thinking Cap nudge missing"),
    styleName: v11Style.name, styleDesc: v11Style.desc, styleRule: v11Style.rule,
    userRule: v11UserRule,
};

// ── data/megumin.js ─────────────────────────────────────────────────────────
const engine = (base, meta) => `    {
        ${meta},
        megumin: true,
${["p1", "p2", "p3", "p4", "p5", "p6"].filter(k => base[k] !== undefined).map(k => `        ${k}: ${tl(base[k])},`).join("\n")}
    }`;
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
${engine(upV11, `id: "v11-room-megumin", label: "V11 Тайна · Megumin Original", color: "#0ea5e9", isNew: true, isV11: true, isCoreClone: true, notebook: true`)},
];

export const cot_megumin = [
${[...cots, ...v11Cots].map(c => `    { id: "${c.id}", trigger: "[[COT]]", content: ${tl(c.content)}, prefill: ${tl(c.prefill)} },`).join("\n")}
];

// Megumin Suite V11 (Beta repository, commit ${V11_UPSTREAM}): the texts around its engine.
export const MEGUMIN_V11_UPSTREAM = "${V11_UPSTREAM}";
export const MEGUMIN_V11 = ${obj(V11)};

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
console.log(`data/megumin.js: 3 engines, ${cots.length + v11Cots.length} thinking steps, ${Object.keys(styleRules).length} styles, ${Object.keys(addonTexts).length} add-ons, ${Object.keys(planTexts).length} director templates, ${Object.keys(cfgNotes).length} config notes, ${Object.keys(cfgValues).length} config values`);

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
// Megumin V11's own preset text on the same VCRP frame. V11 rewrote its preset around its
// engine: a new final check, its Content section (NORA's) and a USER note, and it retired
// USER Consent (its slot became "jealbreak plus", off). Only the tags change, as for V10:
// removed features out, VCRP's in. Three of V11's tags move for the cache, to ride after the
// chat in Output RULES as in VCRP's own preset: the NPC list (VCRP picks the NPCs a scene needs,
// every turn), the NPC dossier rules (they name the characters already known, and gain the
// update rules once the bank has someone) and the Story Director's plan. V11's Current Info
// ([[infoblockcurrent]]) is VCRP's [[blocks]], which carries the kept state the same way.
const upV11P = JSON.parse(v11Text("Presets/Megumin Suite V11 Universal.json"));
const v11Prompt = name => upV11P.prompts.find(p => p.name === name) || fail("upstream V11 slot missing: " + name);
const originalV11 = {
    "Main 2": edit(v11Prompt("Main 2").content, [
        ["[[prompt5]]\n\n[[death]]\n\n[[combat]]\n\n[[npc_events]]\n\n[[prompt6]]", "[[prompt5]]\n\n[[boldnpcs]]\n\n[[prompt6]]"],
        ["[[notebook]]\n\n[[img1]]\n\n[[npc_dossier]]\n\n[[html]]\n\n[[dice]]\n\n<banlist>", "[[notebook]]\n\n[[html]]\n\n[[knowledgebase_always]]\n\n<banlist>"],
    ], "V11 Main 2") + "[[pura_system]][[block_rules]]",
    "</lore><user_persona>": edit(v11Prompt("</lore><user_persona>").content, [["[[storyplan]]\n[[npc list]]\n", ""]], "V11 </lore><user_persona>"),
    "Output RULES": edit(v11Prompt("Output RULES").content, [
        ["[[config]] \n\n[[infoblockcurrent]]\n\n## your thinking steps:", "[[config]] \n\n## your thinking steps:"],
        ["[[Direct]]\n[[DN]]\n\n[[blocks]]", "[[DN]]\n\n[[storyplan]]\n\n[[npc_dossier]]\n\n[[npc list]]\n\n[[story_recall]]\n\n[[knowledgebase]]\n\n[[ANIMEMODE]]\n\n[[focus]]\n\n[[blocks]]"],
        ["[[Language]]\n[[MVU]]\n", "[[Language]]\n"],
    ], "V11 Output RULES"),
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
// V11's new slots, where V11 has them: USER before the history (cached), Content rule in the
// chat beside Output RULES. "jealbreak plus" takes USER Consent's place (the same id), off.
const KEYS = ["identifier", "system_prompt", "enabled", "marker", "name", "role", "content", "injection_position", "injection_depth", "injection_order", "injection_trigger", "forbid_overrides"];
const pick = p => Object.fromEntries(KEYS.filter(k => k in p).map(k => [k, p[k]]));
const consent = presetV11.prompts.findIndex(p => p.name === "USER Consent");
if (consent < 0) fail("VCRP slot missing: USER Consent");
presetV11.prompts[consent] = pick(v11Prompt("jealbreak plus"));
for (const [name, after] of [["USER", "b1e50687-f98d-41aa-9785-230879068ad1"], ["Content rule", "753facc3-4171-4bc5-a005-ab9d1111e469"]]) {
    const slot = pick(v11Prompt(name));
    presetV11.prompts.push(slot);
    // The order SillyTavern uses (100001) must have the anchor; the default one may not list it.
    for (const o of presetV11.prompt_order) {
        const at = o.order.findIndex(x => x.identifier === after);
        if (at < 0 && o.character_id === 100001) fail(`VCRP order ${o.character_id} has no ${after}`);
        if (at >= 0) o.order.splice(at + 1, 0, { identifier: slot.identifier, enabled: true });
    }
}
for (const o of presetV11.prompt_order) {
    const j = o.order.find(x => x.identifier === "753facc3-4171-4bc5-a005-ab9d1111e469");
    if (j) j.enabled = false;
}
writeFileSync("Presets/VCRP V11 Megumin Original.json", JSON.stringify(presetV11, null, 4).replace(/\n/g, "\r\n"));
console.log("Presets/VCRP V11 Megumin Original.json: " + (Object.keys(originalV11).length + 3) + " slots of V11's text on VCRP's layout");
