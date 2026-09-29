// Fills the preset's [[vcrp:*]] anchors and cleans past replies right before a prompt is sent.
// Runs on CHAT_COMPLETION_PROMPT_READY, after SillyTavern has built and macro-substituted the prompt.
//
// Preset syntax (see tools/build_preset.py):
//   [[vcrp:name]]                         replaced with generated text, or removed with its line
//   [[vcrp:if cond]] … [[vcrp:endif]]     kept only when cond is true (nestable; "!" negates)

import { getProfile, getUi } from "./state.js";
import { consumeBackgroundTag } from "./llm.js";
import { shouldPrefill } from "./model.js";
import {
    BLOCKS, DEFAULT_ANIME_PROMPT, ANIME_PRECEDENCE, getEngine,
    SETTINGS_WRAPPER, LENGTH_TEXT, LANGUAGE_TEXT, PRONOUN_TEXT, DIALOGUE_COLOR_TEXT, DIRECT_LANGUAGE_TEXT,
} from "./content.js";

const ctx = () => SillyTavern.getContext();

// Summaries are condensed in batches so the history only changes once every CONDENSE_BATCH replies.
// Condensing one reply per turn would change the history every turn and defeat prompt caching.
const CONDENSE_BATCH = 10;

const MARK = "[[vcrp:";
const ANCHOR_RE = /\[\[vcrp:([a-z_]+)\]\]/g;
// Innermost if/endif pair (its body contains no other "if"), so nested pairs resolve inside-out.
const INNER_IF_RE = /[ \t]*\[\[vcrp:if ([^\]]+)\]\][ \t]*\r?\n?((?:(?!\[\[vcrp:if )[\s\S])*?)[ \t]*\[\[vcrp:endif\]\][ \t]*\r?\n?/;
const THINK_RE = /^\s*(?:<think>)?[\s\S]*?<\/think>\s*/;

let lastPreviewAt = 0;

// ---------------------------------------------------------------------------
// Generation type
// ---------------------------------------------------------------------------

// What kind of generation is being built. Set from GENERATION_STARTED, which SillyTavern emits
// before building the prompt. Continue, Impersonate and quiet (utility) generations must not
// get the reply format: no fresh <think>, no blocks, no prefill.
let currentGen = "reply";

/** GENERATION_STARTED handler: (type, params, dryRun). */
export function setGenerationType(type, _params, dryRun) {
    if (dryRun) return; // token counting; never changes what the next real request is
    currentGen = ["continue", "impersonate", "quiet"].includes(type) ? type : "reply";
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Values the preset's [[vcrp:if …]] conditions are tested against. */
export function buildConditions(p = getProfile(), gen = "reply") {
    const engine = getEngine(p.engine);
    return {
        engine: engine.id,
        cot: p.cot === "auto" ? engine.cot : p.cot,
        gen,
        strictDialogue: !!p.strictDialogue,
        thinkingCap: !!p.thinkingCap,
        consent: !!p.consent,
        boldNpcs: !!p.boldNpcs,
        prefill: gen === "reply" && shouldPrefill(p),
    };
}

function testCondition(expr, cond) {
    expr = expr.trim();
    const negate = expr.startsWith("!");
    if (negate) expr = expr.slice(1).trim();
    let result;
    if (expr.includes("=")) {
        const [key, value] = expr.split("=").map(s => s.trim());
        result = String(cond[key]) === value;
    } else {
        result = !!cond[expr];
    }
    return negate ? !result : result;
}

function resolveConditions(text, cond) {
    for (let guard = 0; guard < 200 && text.includes("[[vcrp:if "); guard++) {
        const next = text.replace(INNER_IF_RE, (_, expr, body) => (testCondition(expr, cond) ? body : ""));
        if (next === text) break; // unbalanced markers: leave the rest for the cleanup below
        text = next;
    }
    return text;
}

// ---------------------------------------------------------------------------
// Anchor content
// ---------------------------------------------------------------------------

function enabledBlocks(p) {
    return BLOCKS.filter(b => p.blocks[b.id]);
}

function buildStructure(p) {
    const blocks = enabledBlocks(p);
    const lines = ["<think>…</think>: your thinking (see <thinking_rules>)."];
    blocks.filter(b => b.position === "before").forEach(b => lines.push(`The ${b.label} block (template in <block_templates>).`));
    lines.push("The scene: narration and dialogue.");
    blocks.filter(b => b.position === "after").forEach(b => lines.push(`The ${b.label} block (template in <block_templates>).`));
    return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

function buildBlockTemplates(p) {
    const blocks = enabledBlocks(p);
    if (!blocks.length) return "";
    const body = blocks.map(b => `${b.label}:${b.note ? ` ${b.note}` : ""}\n${b.template}`).join("\n\n");
    return `<block_templates>\nReproduce each block exactly as shown (same HTML, same emoji, same field names) and replace every [bracketed] note with real content.\n\n${body}\n</block_templates>`;
}

function buildCotExtra(p) {
    const steps = [];
    enabledBlocks(p).forEach(b => { if (b.cotStep) steps.push(b.cotStep); });
    if (p.anime.enabled) steps.push("this reply should read distinctly anime (see <RULES_anime>), not just flavored.");
    if (!steps.length) return "";
    // One sentence, not a checklist: V10's CoTs and the Thinking Cap explicitly forbid checklists.
    return `Keep in mind as you think: ${steps.join(" Also, ")}`;
}

function buildSettings(p) {
    const lines = [];
    const lang = p.language.trim();
    if (lang) lines.push(LANGUAGE_TEXT(lang));
    if (PRONOUN_TEXT[p.pronouns]) lines.push(PRONOUN_TEXT[p.pronouns]);
    const words = String(p.lengthWords).trim();
    if (words) lines.push(LENGTH_TEXT(p.lengthType, words));
    if (p.dialogueColors) lines.push(DIALOGUE_COLOR_TEXT);
    if (p.directLanguage) lines.push(DIRECT_LANGUAGE_TEXT);
    return lines.length ? SETTINGS_WRAPPER(lines.join("\n")) : "";
}

/** Everything the extension would put into the preset right now, keyed by anchor name. */
export function buildAnchors(p = getProfile()) {
    return {
        structure: buildStructure(p),
        blocks: buildBlockTemplates(p),
        cot_extra: buildCotExtra(p),
        settings: buildSettings(p),
        voice: p.style.text.trim() || getEngine(p.engine).voice,
        anime: p.anime.enabled ? `<RULES_anime>\n${(p.anime.text.trim() || DEFAULT_ANIME_PROMPT)}\n\n${ANIME_PRECEDENCE}\n</RULES_anime>` : "",
        knowledgebase: "",
        memory: "",
        npcs: "",
    };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function getText(msg) {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) return msg.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    return "";
}

/** Applies fn to every text part of a message. */
function mapText(msg, fn) {
    if (typeof msg.content === "string") msg.content = fn(msg.content);
    else if (Array.isArray(msg.content)) msg.content.forEach(c => { if (c.type === "text") c.text = fn(c.text); });
}

function hasNonText(msg) {
    return Array.isArray(msg.content) && msg.content.some(c => c.type !== "text");
}

/** Resolves conditions, fills anchors, and removes anything left over. */
function renderTemplate(text, anchors, cond) {
    text = resolveConditions(text, cond);
    // A line holding only an empty anchor disappears completely.
    text = text.replace(/^[ \t]*\[\[vcrp:([a-z_]+)\]\][ \t]*\r?\n?/gm, (line, name) => (anchors[name] ? line : ""));
    text = text.replace(ANCHOR_RE, (_, name) => anchors[name] ?? "");
    // Stray markers (e.g. an unbalanced if from a hand-edited preset) must never reach the model.
    text = text.replace(/\[\[vcrp:[^\]]*\]\]/g, "");
    return text.replace(/(?:\r?\n[ \t]*){3,}/g, "\n\n");
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockRegex(title) {
    const notEnd = "(?:(?!<\\/summary>)[\\s\\S])*?";
    return new RegExp(`<details[^>]*>\\s*<summary[^>]*>${notEnd}${escapeRegex(title)}${notEnd}<\\/summary>([\\s\\S]*?)<\\/details>\\s*`, "gi");
}

/**
 * Cleans past assistant replies: removes the <think> block and applies each info block's history policy.
 * @param {object[]} history assistant messages from chat history, oldest first
 */
function cleanHistory(history, p) {
    const n = history.length;
    // The oldest `condenseCount` replies are condensed; it grows in whole batches only.
    const condenseCount = Math.max(0, Math.floor((n - p.condenseDepth) / CONDENSE_BATCH) * CONDENSE_BATCH);
    history.forEach((msg, i) => {
        const depth = n - 1 - i; // 0 = most recent reply
        mapText(msg, text => {
            if (text.includes("</think>")) text = text.replace(THINK_RE, "");
            for (const b of BLOCKS) {
                if (!text.includes(b.title)) continue;
                const re = blockRegex(b.title);
                if (b.history === "latest" && p.blocks[b.id] && depth === 0) continue;
                if (b.history === "condense" && i < condenseCount) {
                    const m = re.exec(text);
                    if (m) { text = `[Summary of this reply] ${m[1].trim()}`; break; }
                    continue;
                }
                text = text.replace(re, "");
            }
            return text.trim();
        });
    });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onPromptReady(eventData) {
    const messages = eventData?.chat;
    if (!Array.isArray(messages)) return;
    if (consumeBackgroundTag(messages)) return;

    // Only touch prompts built from the VCRP preset.
    if (!messages.some(m => getText(m).includes(MARK))) return;

    const p = getProfile();
    // A dry run (token counting, prompt inspector) always shows the normal reply prompt.
    const cond = buildConditions(p, eventData.dryRun ? "reply" : currentGen);
    // SillyTavern's macro pass has already run, so {{user}} etc. inside our text must be resolved here.
    const { substituteParams } = ctx();
    const anchors = Object.fromEntries(Object.entries(buildAnchors(p)).map(([k, v]) => [k, v ? substituteParams(v) : v]));

    // 1. Clean past replies. Preset messages (they carry VCRP markers) are never history.
    cleanHistory(messages.filter(m => m.role === "assistant" && !getText(m).includes(MARK)), p);

    // 2. Render every preset message; drop the ones that end up empty (e.g. a disabled engine or prefill).
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!getText(msg).includes(MARK)) continue;
        mapText(msg, t => renderTemplate(t, anchors, cond));
        if (!getText(msg).trim() && !hasNonText(msg)) messages.splice(i, 1);
    }

    // 3. Optional preview before sending (real replies only, not utility calls).
    if (!eventData.dryRun && cond.gen !== "quiet" && getUi().previewPrompt && Date.now() - lastPreviewAt > 2000) {
        lastPreviewAt = Date.now();
        const ok = await showPreview(messages);
        if (!ok) {
            // Abort through SillyTavern itself; emptying the message list would send an empty request.
            ctx().stopGeneration();
            toastr.info("Generation cancelled.", "VCRP");
        }
    }
}

async function showPreview(messages) {
    const { Popup, POPUP_TYPE } = ctx();
    const text = messages.map(m => {
        const body = Array.isArray(m.content)
            ? m.content.map(c => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
            : m.content;
        return `========== ${String(m.role).toUpperCase()} ==========\n${body}`;
    }).join("\n\n");
    const $content = $(`<div class="vcrp-preview"><p>This is exactly what will be sent to the model.</p><textarea readonly></textarea></div>`);
    $content.find("textarea").val(text);
    const popup = new Popup($content, POPUP_TYPE.CONFIRM, "", { okButton: "Send", cancelButton: "Cancel", wide: true, large: true });
    return await popup.show();
}
