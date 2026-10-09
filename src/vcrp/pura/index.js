// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Pura Director engines.
//
// Pura's Director Preset (by Pura, https://platberlitz.github.io) as two engines:
//
//   ORIGINAL  Pura's text word for word (data/pura.js, generated from the preset), with
//             Pura's own controls for formatting, length, user control and voice. VCRP's
//             Story Config, writing style and "never write for {{user}}" rule stand aside.
//   ADAPTED   the same core, reworded only where it clashes with VCRP's modules: Story
//             Config owns genre, tone, POV, pace, length, friction and explicitness, and
//             VCRP's rule owns user control. Pura's panel keeps what VCRP has no answer to.
//
// Both run with everything else: Story Memory, Focus, Blocks (Pura's trackers among
// them), the NPC Bank, the knowledgebase, the Story Director, the ban list.
//
// Where each piece goes, for the cache:
//   [[prompt1]]      the main prompt, with every setting that only changes when the reader
//                    changes it (cached).
//   [[pura_system]]  HTML and Diegetic Stats, end of Main 2 (cached).
//   [[pura_late]]    everything that changes per request or is meant to come last: the
//                    Formatting rules, Grounded Prose, the randomisers, a random voice, the
//                    name randomiser, reasoning help. After the newest message, never cached.
// A text the reader writes (Director Instructions, a custom genre) goes late instead of
// into the main prompt when it carries a macro that changes per request ({{random}} etc.).
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { isPuraEngine, puraVariant } from "../../core/engines.js";
import {
    PURA_MAIN, PURA_SIMPLIFIED, PURA_VARS, PURA_USER_CONTROL, PURA_LENGTHS, PURA_VOICES,
    PURA_FORMATTING, PURA_TOGGLES, PURA_RANDOMISERS,
} from "../../../data/pura.js";

export const PURA_VOICE_LABELS = {
    "": "None",
    camus: "Conspiratorial Absurdity (Albert Camus)",
    kafka: "Bureaucratic Irony (Franz Kafka)",
    ligotti: "Cosmic Playbook (Thomas Ligotti)",
    hemingway: "Beige Undercurrents (Ernest Hemingway)",
    ellis: "Gossipy Voyeurism (Bret Easton Ellis)",
    maupassant: "Cruel Realism (Guy de Maupassant)",
    mccarthy: "Solemn Witness (Cormac McCarthy)",
    dickens: "Grand Satirical Stage (Charles Dickens)",
    random: "Randomised (a different one each reply)",
};
export const PURA_RANDOMISER_LABELS = {
    complication: "Grounded Complication",
    chaos: "Chaos Mode",
    genreLens: "Genre Randomiser",
    drivingForce: "Scene Driving Force",
    pressure: "Scene Pressure Cocktail",
    directorsCut: "Combined Director's Cut (all of the above in one)",
    deadDove: "Dead Dove Escalation",
    kink: "Intimacy & Kink Randomiser",
};
export const PURA_MAX_RANDOMISERS = 2;

export const PURA_DEFAULTS = {
    main: "full",            // Original: "full" | "simplified"
    userControl: "dont",     // Original: "dont" | "write" | "director"
    formatting: true,        // Original
    length: "flexible",      // Original: short | medium | long | flexible
    genreOn: true,           // Original
    genre: "",               // Original: "" = Pura's own genre text
    voice: "",
    friction: false, nsfw: false,          // Original (Adapted: Story Config)
    gooner: false, nightmare: false,
    director: "",
    groundedProse: false, html: false, diegeticStats: false, nameRandomiser: false,
    randomisers: [],
    reasoning: "",           // "" | "procedure" | "antiOverthinking"
};

/** The profile's Pura settings, complete. */
export function puraSettings() {
    const p = (localProfile && localProfile.pura) || {};
    const s = { ...PURA_DEFAULTS, ...p };
    s.randomisers = (Array.isArray(p.randomisers) ? p.randomisers : []).filter(k => PURA_RANDOMISERS[k]).slice(0, PURA_MAX_RANDOMISERS);
    if (s.randomisers.includes("directorsCut")) s.randomisers = ["directorsCut"];
    return s;
}

// A macro SillyTavern fills differently on every request (or every minute): text carrying
// one must never sit in the cached part of the prompt.
const VOLATILE = /\{\{\s*(random|roll|time|date|weekday|isotime|isodate|time_utc|idle_duration|lastMessage|lastUserMessage|lastCharMessage|lastMessageId|input)\b/i;
export const puraIsVolatile = text => VOLATILE.test(String(text || ""));

// Pura's {{#if .x}}…{{/if}} and {{getvar::x}}, rendered the way SillyTavern would.
export function puraFill(template, vars) {
    return String(template)
        .replace(/\{\{#if \.(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (m, k, inner) => (vars[k] ? inner : ""))
        .replace(/\{\{getvar::(\w+)\}\}/g, (m, k) => String(vars[k] || ""));
}

// ── ADAPTED: Pura's main prompt, reworded where VCRP's modules take over ───────
// Each swap names one sentence; a swap whose sentence is gone from Pura's text fails the
// tests, so an upstream rewrite cannot quietly leave a clash behind.
const FORMATTING_KEEP = /^- (No chapter headings\.|Never wrap narration in asterisks\.|Always wrap dialogue in quotation marks|Place translations for)/;
export const PURA_ADAPTED_SWAPS = [
    // VCRP's own rule keeps {{user}}'s hands off: no "user-control mode" to select.
    ["Follow the selected user-control mode; if none is supplied, leave {{user}}'s dialogue, decisions, actions, and thoughts to the director.",
        "Leave {{user}}'s dialogue, decisions, actions, and thoughts to the director."],
    // Story Config is where genre, tone, POV, pace, length, friction and explicitness live.
    ["- Genre changes atmosphere and conventions; narration voices change narrative delivery.",
        "- The story config sets genre, tone, point of view, pace, length, friction and explicitness: treat it as the frame of every scene.\n- Genre changes atmosphere and conventions; narration voices change narrative delivery."],
    ["- User-control rules apply across all modes. Current explicit director instructions", "- Current explicit director instructions"],
];
export function puraAdaptedMain() {
    let t = PURA_MAIN;
    for (const [a, b] of PURA_ADAPTED_SWAPS) t = t.split(a).join(b);
    // The house formatting rules VCRP has no setting for, word for word from Pura's
    // Formatting; the rest of it (POV, tense, language, length, user control) is Story
    // Config's and VCRP's now.
    const keep = PURA_FORMATTING.split("\n").filter(l => FORMATTING_KEEP.test(l));
    return t.replace("\n{{#if .genre}}", `\n\n# Formatting\n${keep.join("\n")}\n{{#if .genre}}`);
}

const voiceLine = text => `${text} Keep narration influential, unformatted, distinct, and seamless to the scene.`;
const directorVar = text => `\n### Director Instructions\n${String(text).trim()}\n`;

/**
 * [[prompt1]] for a Pura engine: the main prompt with every setting that holds still.
 * Anything that changes per request is left for [[pura_late]].
 */
export function puraMainPrompt(variant, s = puraSettings()) {
    if (variant === "original" && s.main === "simplified") return PURA_SIMPLIFIED;
    const director = String(s.director || "").trim();
    const genreText = String(s.genre || "").trim() ? `\n## Genre\n${String(s.genre).trim()}\n` : PURA_VARS.genre;
    const vars = {
        narration: s.voice && s.voice !== "random" && PURA_VOICES[s.voice] ? PURA_VOICES[s.voice] : "",
        gooner: s.gooner ? PURA_VARS.gooner : "",
        nightmare: s.nightmare ? PURA_VARS.nightmare : "",
        custom: director && !puraIsVolatile(director) ? directorVar(director) : "",
    };
    if (variant === "original") {
        Object.assign(vars, {
            genre: s.genreOn && !puraIsVolatile(genreText) ? genreText : "",
            nsfw: s.nsfw ? PURA_VARS.nsfw : "",
            friction: s.friction ? PURA_VARS.friction : "",
        });
        return puraFill(PURA_MAIN, vars);
    }
    return puraFill(puraAdaptedMain(), vars);
}

/** [[pura_system]]: Pura's standing toggles that belong with the system prompt (cached). */
export function puraSystemBlock(s = puraSettings()) {
    const parts = [s.html && PURA_TOGGLES.html, s.diegeticStats && PURA_TOGGLES.diegeticStats].filter(Boolean);
    return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/** Pura's Formatting rules, filled in (Original). */
export function puraFormatting(s = puraSettings(), language = "") {
    let t = PURA_FORMATTING
        .replace("{{getvar::writefor}}", () => PURA_USER_CONTROL[s.userControl] || PURA_USER_CONTROL.dont)
        .replace("{{getvar::length}}", () => PURA_LENGTHS[s.length] || PURA_LENGTHS.flexible)
        // Pura's own extension fills this; VCRP's Dialogue Colors add-on does the job here.
        .replace(/\n- \{\{dialoguecolors\}\}/, "");
    // VCRP's story language, where one is set (Global Toggles).
    if (language) t = t.replace("**English**", () => `**${language}**`);
    return t;
}

/**
 * [[pura_late]]: what goes after the newest message. `gen` is VCRP's generation kind: the
 * randomisers, the name randomiser and the reasoning help shape a fresh reply, so a
 * Continue goes without them; an Impersonate (the reader's own turn) goes without any.
 */
export function puraLateBlock(variant, gen = "reply", s = puraSettings(), { language = "" } = {}) {
    if (gen === "impersonate") return "";
    const fresh = gen === "reply";
    // Pura's Simplified prompt carries none of the main prompt's settings (voice, genre,
    // Director Instructions, Formatting); its separate toggles still apply.
    const full = !(variant === "original" && s.main === "simplified");
    const parts = [];
    if (s.groundedProse) parts.push(PURA_TOGGLES.groundedProse);
    if (variant === "original" && s.formatting && full) parts.push(puraFormatting(s, language));
    if (fresh && s.nameRandomiser) parts.push(PURA_TOGGLES.nameRandomiser);
    if (full && s.voice === "random") parts.push(voiceLine(PURA_VOICES.random));
    const director = String(s.director || "").trim();
    if (full && director && puraIsVolatile(director)) parts.push(`Consider this a source of truth for any plausible contradictory instructions:\n${directorVar(director)}`);
    if (variant === "original" && full && s.genreOn && String(s.genre || "").trim() && puraIsVolatile(s.genre)) parts.push(`## Genre\n${String(s.genre).trim()}`);
    if (fresh) for (const k of s.randomisers) parts.push(PURA_RANDOMISERS[k]);
    if (fresh && s.reasoning === "procedure") parts.push(PURA_TOGGLES.reasoningProcedure);
    if (fresh && s.reasoning === "antiOverthinking") parts.push(PURA_TOGGLES.antiOverthinking);
    return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/**
 * Called by the dict builder once the engine's slots are filled: a Pura engine writes its
 * own [[prompt1]] and its two tags, and stands VCRP's overlapping modules aside. Any other
 * engine gets the two tags empty.
 */
export function applyPuraEngine(dict, engine, gen = "reply") {
    if (!isPuraEngine(engine)) {
        dict["[[pura_system]]"] = "";
        dict["[[pura_late]]"] = "";
        return;
    }
    const variant = puraVariant(engine);
    const s = puraSettings();
    const language = localProfile && String(localProfile.userLanguage || "").trim();
    for (let i = 1; i <= 6; i++) { dict[`[[prompt${i}]]`] = ""; dict[`[prompt${i}]`] = ""; }
    dict["[[prompt1]]"] = puraMainPrompt(variant, s);
    dict["[prompt1]"] = dict["[[prompt1]]"];
    dict["[[pura_system]]"] = puraSystemBlock(s);
    dict["[[pura_late]]"] = puraLateBlock(variant, gen, s, { language });
    // Pura thinks Pura's way: no CoT script, no CoT prefill. Its voices replace the
    // writing style, and it carries no model acknowledgements.
    dict["[[COT]]"] = "";
    dict["[[prefill]]"] = "";
    dict["[[aiprompt]]"] = "";
    dict["[[AI1]]"] = "";
    dict["[[AI2]]"] = "";
    if (variant === "original") {
        // Pura's Formatting, genre and modes own what Story Config and the rule would say.
        dict["[[config]]"] = "";
        dict["[[user]]"] = "";
        if (s.formatting && s.main !== "simplified") dict["[[Language]]"] = "";
    }
}
