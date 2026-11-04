// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Model Setup (Megumin Suite V11's loadouts, in VCRP's terms). The settings tested for
// each model family, and the rows that read and write them. Pure: the page (ui.js) hands in
// what needs SillyTavern (the Story Config length sentences, the global settings). A loadout
// recommends, it never locks.
// ─────────────────────────────────────────────────────────────────────────────

import { meguminCotForMode, models, isThinkingCap } from "../../../data/cot/index.js";
import { directStyles } from "../../../data/directStyles.js";
import { lockedStyleIdFor } from "../../core/engines.js";
import { hardcodedLogic } from "../../../data/database.js";

// The Story Config length options a loadout picks, by their label (storyconfig/config.js).
export const LENGTH_FLEXIBLE = "flexible";
export const LENGTH_SHORT = "250–350 words, longer for fights and sex";

// The engines the Engine row offers (whatever engine you are on is listed too).
export const ENGINE_CHOICES = ["v11-voice-megumin", "v11-writers-room-megumin", "v11-voice-adapted", "v11-writers-room-adapted", "v10-core", "v10-shura", "pura-original", "pura-adapted"];

// One row per setting. `tab` is the tab the row's button opens (and whose Global sync a
// change on the page follows). read/write work on a profile object; a `global` row works on
// the global settings through ctx.global (the page provides it) and is written once.
// ctx = { lengthLabel, lengthValue, global: { prefill, setPrefill, replyCap, setReplyCap, helperBlocks, setHelperBlocks } }.
export const SETTINGS = [
    {
        key: "mode", label: "Engine", tab: "PRESETS & COT",
        read: p => p.mode,
        write: (p, id) => pickEngine(p, id),
    },
    {
        key: "thinking", label: "Chain of Thought", tab: "PRESETS & COT",
        desc: "VCRP's own visible thinking before the reply. A model that reasons on its own (Gemini 4, Claude) does its planning there already.",
        read: p => p.cotEnabled !== false,
        write: (p, on) => { p.cotEnabled = Boolean(on); },
    },
    {
        // Comes after "mode" in a loadout's settings, so it caps the thinking of the engine just picked.
        key: "thinkingCap", label: "Thinking Cap", tab: "PRESETS & COT",
        desc: "Keeps the custom thinking to a few short lines, for a model that thinks too long. Works only with Chain of Thought on.",
        read: p => isThinkingCap(p.model),
        write: (p, on) => setCap(p, on),
    },
    {
        key: "length", label: "Story length", tab: "PRESETS & COT",
        read: (p, ctx) => ctx.lengthLabel(p.storyConfig && p.storyConfig.length),
        write: (p, label, ctx) => {
            if (!p.storyConfig) p.storyConfig = {};
            p.storyConfig.length = ctx.lengthValue(label);
        },
    },
    { key: "html", label: "Immersive HTML", tab: "Global Toggles & Add Ons", ...addonRow("html") },
    {
        // Only the Gemini loadouts have this row; using any other loadout switches it off.
        key: "geminiJB", label: "Gemini JB", tab: "Global Toggles & Add Ons", ...addonRow("gemini_jb"), offElsewhere: true,
        desc: "Helps Gemini through gritty and heavy NSFW scenes without cutting the reply off.",
    },
    {
        key: "prefill", label: "CoT prefill", tab: "Global Settings", global: true,
        desc: "Auto prefills only the models that take one (older Gemini); newer Claude and Gemini refuse it.",
        read: (p, ctx) => ctx.global.prefill(),
        write: (p, v, ctx) => ctx.global.setPrefill(v),
    },
    {
        key: "replyCap", label: "Safety cap", tab: "Memory", global: true,
        desc: "A hard limit on a reply's tokens. 0 is off: on a model that reasons before it writes, its reasoning counts against the cap.",
        read: (p, ctx) => ctx.global.replyCap(),
        write: (p, v, ctx) => ctx.global.setReplyCap(v),
    },
    {
        key: "helper", label: "Helper writes the blocks", tab: "Helper", global: true,
        desc: "A second model writes the blocks after each reply, so the story model writes only the story. Needs a connection in the Helper tab.",
        read: (p, ctx) => ctx.global.helperBlocks(),
        write: (p, on, ctx) => ctx.global.setHelperBlocks(on),
    },
];

// A row that switches one add-on (Global Toggles & Add Ons) on or off.
function addonRow(id) {
    return {
        read: p => Array.isArray(p.addons) && p.addons.includes(id),
        write: (p, on) => {
            const list = (Array.isArray(p.addons) ? p.addons : []).filter(a => a !== id);
            if (on) list.push(id);
            p.addons = list;
        },
    };
}

export const settingFor = key => SETTINGS.find(s => s.key === key);

/** The engine's own thinking, or its Thinking Cap when it has one. */
function setCap(p, on) {
    const cot = meguminCotForMode(p.mode, "english");
    if (!cot) return;
    const capped = cot.replace(/-english$/, "-cap-english");
    p.model = on && models.some(m => m.id === capped) ? capped : cot;
}

/**
 * Picks an engine the way the PRESETS & COT tab does: its thinking comes with it (a Thinking
 * Cap stays on when the new engine has one too), and its built-in writing style when it
 * locks one (V11 Default for V11, Ukiyo's or Shura's for V10; Pura keeps yours).
 */
export function pickEngine(p, id) {
    const wasCapped = isThinkingCap(p.model);
    p.mode = id;
    const cot = meguminCotForMode(id, "english");
    if (cot) p.model = cot;
    if (wasCapped) setCap(p, true);
    const engine = [...(hardcodedLogic.modes || [])].find(m => m.id === id) || { id };
    const styleId = lockedStyleIdFor(engine);
    const ds = styleId && directStyles.find(s => s.id === styleId);
    if (ds) {
        p.activeStyleId = ds.id;
        p.aiRule = ds.rule;
    }
}

const PRICE_NOTE = { tone: "gold", text: "<b>Story Memory needs the model's price</b> to budget each request (Memory tab, custom price), unless it is a Claude model VCRP knows." };
const HELPER_NOTE = { tone: "gold", helper: true, text: "<b>The helper is off here.</b> If the blocks come back cut off or missing, switch it on (Helper tab) and give it a second model to write them." };

export const LOADOUTS = [
    {
        id: "gemini-pro", name: "Gemini Pro", icon: "fa-gem", models: "Gemini 4 Argon, Gemini 3.1 Pro, 2.5 Pro",
        why: "What Megumin's engines were built on. Gemini plans in its own reasoning, so Chain of Thought stays off on Gemini 4; the Gemini JB add-on gets it through heavy scenes; the Safety cap stays off, since the reasoning would count against it.",
        notes: [
            { tone: "gold", text: "<b>Gemini 4:</b> keep Chain of Thought off (it reasons on its own). <b>Gemini 3.1 Pro and 2.5 Pro:</b> turn it on. The prefill: Auto gives none to Gemini 3.5 and newer, which refuse it." },
            HELPER_NOTE, PRICE_NOTE,
        ],
        settings: { mode: "v11-voice-megumin", thinking: false, length: LENGTH_FLEXIBLE, geminiJB: true, prefill: "auto", replyCap: 0, helper: false },
    },
    {
        id: "gemini-flash", name: "Gemini Flash", icon: "fa-gem", models: "Gemini 3.5 – 3.8 Flash",
        why: "Set up like Gemini Pro, with Chain of Thought on: Flash plans the reply better when it writes its thinking out.",
        notes: [
            { tone: "gold", helper: true, text: "<b>Gemini 3.8 Flash writes the blocks fine</b>, but in heavy NSFW scenes it can cut them off. If that happens, let the helper write them (Helper tab)." },
            PRICE_NOTE,
        ],
        settings: { mode: "v11-voice-megumin", thinking: true, thinkingCap: false, length: LENGTH_FLEXIBLE, geminiJB: true, prefill: "auto", replyCap: 0, helper: false },
    },
    {
        id: "claude", name: "Claude", icon: "fa-feather", models: "Claude Opus 4.6, Opus 5.5, Sonnet 4.6",
        why: "The best prose of any model tested. Megumin's loadout keeps the custom thinking off on Claude (it keeps its thinking to itself; asked to write it out, replies could get blocked). VCRP's prices for Claude are built in, and Story Memory's cache work was made for it.",
        notes: [
            { tone: "gold", text: "<b>Chain of Thought:</b> Megumin's tested setting is off. VCRP has run Claude with it on for weeks without trouble; turn it on if you want to read the planning." },
            { tone: "gold", text: "<b>The prefill:</b> Auto gives none to Claude 4.6 and newer, which reject it." },
            HELPER_NOTE,
        ],
        settings: { mode: "v11-voice-megumin", thinking: false, length: LENGTH_FLEXIBLE, prefill: "auto", replyCap: 0, helper: false },
    },
    {
        id: "big-open", name: "Big open models", icon: "fa-dragon", models: "GLM 5.3, GLM 5.3 Flash",
        why: "GLM writes plainer dialogue with the custom thinking off, and the short length keeps it from redrafting. Immersive HTML leaks into its replies, so it stays off.",
        notes: [
            { tone: "gold", helper: true, text: "<b>GLM 5.3 Flash</b> can forget a block now and then. If it does, let the helper write the blocks." },
            { tone: "gold", text: "<b>Keep the prefill off:</b> GLM thinks on its own and does not need it." },
            PRICE_NOTE,
        ],
        settings: { mode: "v11-voice-megumin", thinking: false, thinkingCap: false, length: LENGTH_SHORT, html: false, prefill: "off", replyCap: 0, helper: false },
    },
    {
        id: "fast", name: "Fast models", icon: "fa-bolt", models: "DeepSeek",
        why: "Fast and cheap, and good at the story. Megumin gives DeepSeek an engine of its own with one more line (so it does not treat the character as the player); VCRP does not carry it, so this uses V11 Тайна.",
        notes: [
            { tone: "red", helper: true, text: "<b>DeepSeek needs the helper.</b> It leaves out everything after the story: the blocks and the scene list. The helper writes them for it (Helper tab: pick a connection, then Test)." },
            PRICE_NOTE,
        ],
        settings: { mode: "v11-voice-megumin", thinking: true, thinkingCap: false, length: LENGTH_SHORT, html: false, prefill: "off", replyCap: 0, helper: true },
    },
];

export const loadoutById = id => LOADOUTS.find(l => l.id === id);

/** What Use this loadout writes: the loadout's settings, plus off for every offElsewhere row it lacks (Gemini JB on a non-Gemini loadout). */
export function loadoutWrites(settings) {
    const off = SETTINGS.filter(s => s.offElsewhere && !(s.key in settings)).map(s => [s.key, false]);
    return { ...settings, ...Object.fromEntries(off) };
}

/**
 * Writes a loadout's settings into one profile (or `settings`, the loadout's settings as
 * changed on the page before using it). `skipGlobal`: leave out the rows stored once for
 * every character (written once, through the page).
 */
export function applyLoadout(p, loadout, ctx, settings = loadout.settings, { skipGlobal = false } = {}) {
    for (const [key, value] of Object.entries(loadoutWrites(settings))) {
        const s = settingFor(key);
        if (!s) continue;
        if (!(skipGlobal && s.global)) s.write(p, value, ctx);
    }
    p.loadout = loadout.id;
}

/**
 * What Use this loadout would change on one profile, before it runs: [{ key, label, from,
 * to }] in the loadout's order, values as the rows read them; plus { key: "style" } when the
 * engine brings its own writing style. Empty: nothing would change. Nothing is touched.
 */
export function loadoutChanges(p, loadout, ctx, settings = loadout.settings) {
    const after = JSON.parse(JSON.stringify(p));
    // The global rows are read through a copy of the globals, so the preview writes nothing.
    const globals = ctx.global ? { ...ctx.global } : null;
    const shadow = globals ? shadowGlobals(ctx.global) : null;
    const previewCtx = shadow ? { ...ctx, global: shadow } : ctx;
    applyLoadout(after, loadout, previewCtx, settings);
    const out = [];
    for (const key of Object.keys(loadoutWrites(settings))) {
        const s = settingFor(key);
        if (!s) continue;
        const from = s.read(p, ctx);
        const to = s.read(after, previewCtx);
        if (from !== to) out.push({ key, label: s.label, from, to });
    }
    if ((after.activeStyleId || "") !== (p.activeStyleId || "")) {
        out.push({ key: "style", label: "Writing style", from: p.activeStyleId || "", to: after.activeStyleId || "" });
    }
    return out;
}

// A copy of the global settings' readers and writers that only remembers what was written.
function shadowGlobals(g) {
    const v = { prefill: g.prefill(), replyCap: g.replyCap(), helperBlocks: g.helperBlocks() };
    return {
        prefill: () => v.prefill, setPrefill: x => { v.prefill = x; },
        replyCap: () => v.replyCap, setReplyCap: x => { v.replyCap = x; },
        helperBlocks: () => v.helperBlocks, setHelperBlocks: x => { v.helperBlocks = Boolean(x); },
    };
}

/** The keys whose value differs from the loadout this profile last used. Empty when it used none, or another one. */
export function changedFromLoadout(p, loadout, ctx) {
    if (!loadout || p.loadout !== loadout.id) return [];
    return Object.entries(loadout.settings)
        .filter(([key, value]) => { const s = settingFor(key); return s && s.read(p, ctx) !== value; })
        .map(([key]) => key);
}
