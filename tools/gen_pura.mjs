// Builds data/pura.js from Pura's Director Preset itself, so not a word of it is retyped
// by hand:
//
//   tools/upstream/pura/preset.json    Pura's Director Preset 16.0 (SillyTavern build)
//   tools/upstream/pura/regexes.json   its tracker renderers (the same set the preset bundles)
//
// Every text comes out exactly as Pura wrote it, minus SillyTavern's own comment and trim
// macros ({{// ...}}, {{trim}}) and the {{setvar::name::...}} wrapper around a value.
// VCRP assembles the pieces itself instead of through {{setvar}}/{{getvar}}/{{#if}}, so
// they no longer depend on the order SillyTavern evaluates a preset in.
//
// The only text changed here is for the cache: the skill-check roll ({{roll:1d100}}) is
// taken out of the tracker's rules, which sit in the cached part of the prompt, and goes
// with the per-turn block instructions instead. The renderers drop a portrait lookup that
// only exists in Neconyan (Pura's own frontend); the card shows the initial instead, as
// Pura's own notes say it does elsewhere.
//
// Run from the repo root after updating the upstream files:   node tools/gen_pura.mjs
import { readFileSync, writeFileSync } from "node:fs";

const preset = JSON.parse(readFileSync("tools/upstream/pura/preset.json", "utf8"));
const regexes = JSON.parse(readFileSync("tools/upstream/pura/regexes.json", "utf8"));
const fail = msg => { throw new Error(msg); };

if (JSON.stringify(regexes) !== JSON.stringify(preset.extensions.regex_scripts)) {
    fail("regexes.json differs from the set bundled in preset.json; decide which to ship");
}

const byName = name => (preset.prompts.find(p => p.name === name) || fail("upstream prompt missing: " + name)).content || "";
// SillyTavern's comment and trim macros: gone before anything else is read.
const clean = s => String(s).replace(/\{\{\/\/[\s\S]*?\}\}/g, "").replace(/\s*\{\{trim\}\}\s*/g, "");
// The value inside {{setvar::name::value}}, exactly.
function setvar(text, name) {
    const m = clean(text).match(/^\{\{setvar::(\w+)::([\s\S]*)\}\}$/);
    if (!m) fail(`expected a {{setvar}} wrapper: ${name}`);
    return m[2];
}
function swap(text, a, b, name) {
    const n = text.split(a).length - 1;
    if (n !== 1) fail(`${name}: expected one "${a.slice(0, 50)}", found ${n}`);
    return text.replace(a, () => b);
}

// ── The engine text ──────────────────────────────────────────────────────────
const MAIN = byName("Director Main Prompt");
for (const v of ["genre", "narration", "nsfw", "gooner", "friction", "nightmare", "custom"]) {
    if (!MAIN.includes(`{{#if .${v}}}`)) fail("main prompt no longer reads ." + v);
}
const SIMPLIFIED = clean(byName("Simplified Director Main Prompt"));

const vars = {
    friction: setvar(byName("Friction Mode"), "friction"),
    nightmare: setvar(byName("Nightmare Difficulty Increase"), "nightmare"),
    nsfw: setvar(byName("NSFW Mode"), "nsfw"),
    gooner: setvar(byName("Gooner Mode"), "gooner"),
    genre: setvar(byName("Genre"), "genre"),
};
const userControl = {
    dont: setvar(byName("Don’t Write for User"), "writefor"),
    write: setvar(byName("Write for User"), "writefor"),
    director: setvar(byName("User Is Not A Character"), "writefor"),
};
const lengths = {
    short: setvar(byName("Short"), "length"),
    medium: setvar(byName("Medium"), "length"),
    long: setvar(byName("Long"), "length"),
    flexible: setvar(byName("Flexible"), "length"),
};
const voiceNames = {
    camus: "Voice: Conspiratorial Absurdity (Albert Camus)",
    kafka: "Voice: Bureaucratic Irony (Franz Kafka)",
    ligotti: "Voice: Cosmic Playbook (Thomas Ligotti)",
    hemingway: "Voice: Beige Undercurrents (Ernest Hemingway)",
    ellis: "Voice: Gossipy Voyeurism (Bret Easton Ellis)",
    maupassant: "Voice: Cruel Realism (Guy de Maupassant)",
    mccarthy: "Voice: Solemn Witness (Cormac McCarthy)",
    dickens: "Voice: Grand Satirical Stage (Charles Dickens)",
};
const voices = Object.fromEntries(Object.entries(voiceNames).map(([k, n]) => [k, setvar(byName(n), "narration")]));
voices.random = setvar(byName("Voice: Randomised"), "narration");
if (!voices.random.startsWith("{{random::")) fail("Voice: Randomised is no longer a {{random}}");
// Pura's own example instruction, shown as a placeholder (it is a {{random}}, so it never goes out as is).
const directorExample = setvar(byName("Optional User Instructions"), "custom");

const formatting = clean(byName("Formatting"));
for (const t of ["{{getvar::writefor}}", "{{getvar::length}}", "{{dialoguecolors}}", "**English**"]) {
    if (!formatting.includes(t)) fail("Formatting no longer carries " + t);
}

const toggles = {
    groundedProse: clean(byName("Grounded Prose Rules (Post-History Instructions)")),
    html: clean(byName("HTML Toggle")),
    diegeticStats: clean(byName("Diegetic Stats Mode")),
    nameRandomiser: clean(byName("Name Randomiser + Banned Names")),
    reasoningProcedure: clean(byName("Reasoning Encouragement")),
    antiOverthinking: clean(byName("Experimental Anti-Overthinking Prefill")),
};

const randomisers = {
    complication: clean(byName("Grounded Complication")),
    chaos: clean(byName("Chaos Mode")),
    genreLens: clean(byName("Genre Randomiser")),
    drivingForce: clean(byName("Scene Driving Force")),
    pressure: clean(byName("Scene Pressure Cocktail")),
    directorsCut: clean(byName("Combined Director’s Cut (Combination of all the above. Choose only this if you want the above ones.)")),
    deadDove: clean(byName("Dead Dove Escalation")),
    kink: clean(byName("Intimacy & Kink Randomiser")),
};

// ── The trackers ─────────────────────────────────────────────────────────────
// The roll is a fresh {{roll:1d100}} on every request; the rules it sits in are cached.
let skillChoices = clean(byName("CYOA Choices with Skill Checks"));
const ROLL = "For this response, the hidden d100 roll is: {{roll:1d100}}.";
skillChoices = swap(skillChoices, ROLL, "For this response, the hidden d100 roll is the one given with the skill-check choices block.", "CYOA Choices with Skill Checks");

const trackers = {
    npc: clean(byName("NPC Profile Sheets")),
    choices: clean(byName("CYOA Choices (User-Focused)")),
    skillChoices,
    directions: clean(byName("Direction Menu (Narrative-Focused)")),
    relationship: clean(byName("Relationship Tracker")),
    scene: clean(byName("Scene Tracker")),
    time: clean(byName("Time Tracker")),
    events: clean(byName("Pending Events Tracker")),
    achievements: clean(byName("Achievements Tracker")),
    reputation: clean(byName("Reputation Tracker")),
    items: clean(byName("Item Tracker")),
    status: clean(byName("Status and Conditions Tracker")),
    secrets: clean(byName("Secrets Tracker")),
    parallel: clean(byName("Parallel Off-Screen Tracker")),
    world: clean(byName("World Detail Tracker")),
    stats: clean(byName("Persona-Based Stat Generator (Turn Off After Running Once)")),
    levelUp: clean(byName("Level-Up Companion")),
};
for (const [k, v] of Object.entries(trackers)) if (/\{\{(random|roll|pick)\b/.test(v)) fail(`tracker ${k} still carries a per-request macro`);

// ── The renderers ────────────────────────────────────────────────────────────
// Prompt-side trims are VCRP's job now (it keeps every block out of the history the
// same way, turn after turn); only the display renderers come along.
const PORTRAIT = "<span style=\"position:absolute;inset:0;border-radius:50%;background:url(&quot;/thumbnail/portrait?name=$2&amp;char={{char}}&quot;) center 18%/cover no-repeat\"></span>";
const renderers = regexes.filter(r => r.markdownOnly && !r.promptOnly && !r.disabled).map(r => {
    const m = r.findRegex.match(/^\/([\s\S]*)\/([a-z]*)$/);
    if (!m) fail("unreadable regex: " + r.scriptName);
    let replace = r.replaceString;
    if (replace.includes(PORTRAIT)) replace = replace.split(PORTRAIT).join("");
    return { name: r.scriptName, source: m[1], flags: m[2], replace };
});
if (!renderers.some(r => r.name === "Replace Relationship Bond")) fail("Relationship Bond renderer missing");

// ── Writing the file ─────────────────────────────────────────────────────────
const tl = s => "`" + String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
const obj = o => "{\n" + Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${tl(v)},`).join("\n") + "\n}";

const js = `// ─────────────────────────────────────────────────────────────────────────────
// GENERATED by tools/gen_pura.mjs from Pura's Director Preset ${"16.0"} (by Pura,
// https://platberlitz.github.io). Do not edit by hand: change the upstream file and
// run the generator again.
// ─────────────────────────────────────────────────────────────────────────────

/** The Director Main Prompt, with its own {{#if .x}} / {{getvar::x}} slots. */
export const PURA_MAIN = ${tl(MAIN)};

/** The Simplified Director Main Prompt, for small models. */
export const PURA_SIMPLIFIED = ${tl(SIMPLIFIED)};

/** The values Pura's toggles set for the main prompt's slots. */
export const PURA_VARS = ${obj(vars)};

export const PURA_USER_CONTROL = ${obj(userControl)};
export const PURA_LENGTHS = ${obj(lengths)};
export const PURA_VOICES = ${obj(voices)};
export const PURA_DIRECTOR_EXAMPLE = ${tl(directorExample)};

/** The Formatting prompt, with its {{getvar::writefor}}, {{getvar::length}} and {{dialoguecolors}}. */
export const PURA_FORMATTING = ${tl(formatting)};

export const PURA_TOGGLES = ${obj(toggles)};
export const PURA_RANDOMISERS = ${obj(randomisers)};
export const PURA_TRACKERS = ${obj(trackers)};

/** The tracker renderers, in Pura's order: { name, source, flags, replace }. */
export const PURA_RENDERERS = ${JSON.stringify(renderers, null, 4)};
`;
writeFileSync("data/pura.js", js);
console.log(`data/pura.js: main + simplified, ${Object.keys(vars).length} modes, ${Object.keys(voices).length} voices, ${Object.keys(randomisers).length} randomisers, ${Object.keys(trackers).length} trackers, ${renderers.length} renderers`);
