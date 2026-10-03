// Builds the Megumin Original versions straight from Megumin Suite V10 itself, so not a word
// of the original is retyped by hand:
//
//   data/megumin.js                          the two engines, their thinking steps, the
//                                            original Enhanced Dialogue, and the original
//                                            wording of the shared texts VCRP reworded
//   Presets/VCRP V10 Megumin Original.json   the original preset text on VCRP's layout
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

// ── data/megumin.js ─────────────────────────────────────────────────────────
const engine = (base, meta) => `    {
        ${meta},
        megumin: true,
${["p1", "p2", "p3", "p4", "p5", "p6"].filter(k => base[k] !== undefined).map(k => `        ${k}: ${tl(base[k])},`).join("\n")}
    }`;
const obj = o => `{\n${Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${tl(v)},`).join("\n")}\n}`;

const js = `// ─────────────────────────────────────────────────────────────────────────────
// MEGUMIN ORIGINAL: Megumin Suite V10's own writing text, word for word.
//
// GENERATED FILE. Do not edit by hand; run:
//
//     node tools/gen_megumin.mjs
//
// Source: Megumin Suite V10, upstream commit ${UPSTREAM}. The engines and thinking steps
// are separate entries beside VCRP's. The tables below hold the original wording of the
// shared texts VCRP reworded (styles, add-ons, Story Config, Story Director), and
// src/engine/meguminOriginal.js swaps them in while a Megumin Original engine is active.
// ─────────────────────────────────────────────────────────────────────────────

export const MEGUMIN_UPSTREAM = "${UPSTREAM}";

export const modes_megumin = [
${engine(upUkiyo, `id: "v10-ukiyo-megumin", label: "V10 Ukiyo · Megumin Original", color: "#fb7185", isNew: true, isV10: true, isCoreClone: true`)},
${engine(upShura, `id: "v10-shura-megumin", label: "V10 Shura · Megumin Original", color: "#c084fc", isNew: true, isV10: true, isCoreClone: true`)},
];

export const cot_megumin = [
${cots.map(c => `    { id: "${c.id}", trigger: "[[COT]]", content: ${tl(c.content)}, prefill: ${tl(c.prefill)} },`).join("\n")}
];

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
console.log(`data/megumin.js: 2 engines, ${cots.length} thinking steps, ${Object.keys(styleRules).length} styles, ${Object.keys(addonTexts).length} add-ons, ${Object.keys(planTexts).length} director templates, ${Object.keys(cfgNotes).length} config notes, ${Object.keys(cfgValues).length} config values`);

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
    "Main 2": edit(upText("Main 2"), [
        ["[[prompt5]]\n\n[[death]]\n\n[[combat]]\n\n[[npc_events]]\n\n[[prompt6]]", "[[prompt5]]\n\n[[boldnpcs]]\n\n[[prompt6]]"],
        ["[[html]]\n\n<banlist>", "[[html]]\n\n[[knowledgebase_always]]\n\n<banlist>"],
    ], "Main 2"),
    "<lore>": upText("<lore>"),
    "</lore><user_persona>": upText("</lore><user_persona>"),
    // Removed features: Direct Language, Dice, Image Gen, MVU. Story Memory's recall and
    // VCRP's knowledgebase and anime mode go where VCRP's preset has them; each is empty
    // unless its feature is on.
    "Output RULES": edit(upText("Output RULES"), [
        ["Check the chat history.\n[[Direct]]\n[[DN]]", "Check the chat history.\n[[DN]]"],
        ["[[npc list]]\n\n[[dice]]\n\n[[img1]]\n\n[[blocks]]", "[[npc list]]\n\n[[story_recall]]\n\n[[knowledgebase]]\n\n[[ANIMEMODE]]\n\n[[blocks]]"],
        ["[[Language]]\n[[MVU]]\n", "[[Language]]\n"],
    ], "Output RULES"),
    "</history>": upText("</history>"),
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
