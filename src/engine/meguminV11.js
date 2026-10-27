// ──────────────────────────────────────────────────────────────────────────────
// Megumin Suite V11's preset sections, built the way V11 builds them.
//
// V11's preset is only slots: [[thinking]], [[formatting]], [[banned]], [[reminder]],
// [[content]] and [[addon_rules]] each bring their own heading or tag, so a section that is
// off takes its heading with it (upstream src/engine/presetSections.js, src/prompts/v11Rules.js).
// The words are V11's, generated into data/megumin.js. The V11 Тайна engines (turnFrame "v11")
// take its tagged wording: <formatting>, <final_check>, its own ban list. V11 Тайна Preview and
// every other engine take the older headings ("## your thinking steps:").
//
// Only the "VCRP V11 Megumin Original" preset carries these tags. VCRP's own sections stay
// VCRP's: the thinking is VCRP's [[THINK]], the colors carry VCRP's lock note, and Dice, Death,
// Combat, images and MVU are not in VCRP, so nothing of theirs is sent.
// ──────────────────────────────────────────────────────────────────────────────

import { MEGUMIN_V11 } from "../../data/megumin.js";

/** "v11" for an engine written on the V11 Тайна turn frame, else undefined. */
export const v11Frame = engine => (engine && engine.turnFrame === "v11" ? "v11" : undefined);

const filled = parts => parts.map(p => String(p || "").trim()).filter(Boolean);
// Same text, ignoring spacing: is this still the shipped default?
const sameText = (a, b) => String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();
// One check per line. A number the text already carries is dropped: the list is numbered here.
const checkLines = text => String(text || "").split(/\r?\n/).map(l => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
// A rule in a tag of its own; one already in a tag is left as it is.
const wrapAddon = (tag, text) => {
    const body = String(text || "").trim();
    if (!body) return "";
    return /^<[A-Za-z_]+>/.test(body) ? body : `<${tag}>\n${body}\n</${tag}>`;
};

/** [[thinking]]: the thinking, with its heading on the older frame; "" when there is none. */
export function thinkingSection(think, frame) {
    const body = String(think || "").trim();
    if (!body) return "";
    return frame === "v11" ? body : `${MEGUMIN_V11.thinkingHeader}\n${body}`;
}

/** [[formatting]]: the ratio, the colors and the dialogue tags (and, before V11 Тайна, its two rules). */
export function formattingSection({ dnratio, color, dn }, frame) {
    if (frame === "v11") {
        const parts = filled([dnratio, color, dn]);
        return parts.length ? `<formatting>\n${parts.join("\n")}\n</formatting>` : "";
    }
    const parts = filled([dnratio, color, MEGUMIN_V11.formattingRules, dn]);
    return `${MEGUMIN_V11.formattingHeader}\n\n${parts.join("\n")}`;
}

/** [[banned]]: the built-in list (V11 Тайна's own on its frame) and your phrases, in one <banlist>. */
export function bannedSection(additions, frame) {
    const parts = filled([frame === "v11" ? MEGUMIN_V11.banListV11 : MEGUMIN_V11.banList, additions]);
    return `<banlist>\n${parts.join(frame === "v11" ? "\n\n" : "\n")}\n</banlist>`;
}

/**
 * [[reminder]]: the final checks, numbered as they are built: the shared ones, the ban list's,
 * the engine's own, then the {{user}} rule (left out when `userLine` is empty).
 */
export function reminderSection({ presetChecks, userLine }, frame) {
    const lines = [
        ...checkLines(MEGUMIN_V11.finalChecks),
        MEGUMIN_V11.banlistCheck,
        ...checkLines(presetChecks),
        ...checkLines(userLine),
    ];
    const list = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
    return frame === "v11"
        ? `<final_check>\n${MEGUMIN_V11.finalCheckHead}\n${list}\n</final_check>`
        : `${MEGUMIN_V11.reminderHeader}\n${list}`;
}

/** V11 Тайна's Story settings: <story_settings> around the lines, then its <repetition> rule. */
export function storySettingsSection(lines, repetition) {
    const settings = lines.length ? `<story_settings>\n${MEGUMIN_V11.storySettingsPreamble}\n${lines.join("\n")}\n</story_settings>` : "";
    const rep = String(repetition || "").trim();
    return filled([settings, rep ? `<repetition>\n${rep}\n</repetition>` : ""]).join("\n\n");
}

/** V11 Тайна's language line: "Write the response in English." */
export function languageLine(lang) {
    const l = String(lang || "english").trim().toLowerCase();
    return MEGUMIN_V11.languageLine.replace("{{language}}", l.charAt(0).toUpperCase() + l.slice(1));
}

/**
 * [[addon_rules]]: the add-ons that go up top, each in its own tag. A shipped text gets V11's
 * wording; one you edited keeps yours, in a tag.
 * @param {{ onomato: string, onomatoShipped: string, styled: boolean, html: string }} parts
 */
export function addonRulesSection({ onomato, onomatoShipped, styled, html }) {
    const sound = String(onomato || "").trim()
        ? (sameText(onomato, onomatoShipped) ? (styled ? MEGUMIN_V11.soundStyled : MEGUMIN_V11.sound) : wrapAddon("sound", onomato))
        : "";
    return filled([sound, wrapAddon("render", html)]).join("\n\n");
}

/**
 * Fills the V11 preset's section tags in `dict`, from the parts already built there.
 * @param {object} dict      the tag table, its [[THINK]], [[DNRATIO]], [[COLOR]], [[DN]],
 *                           [[banlist]], [[user]], [[onomato]] and [[html]] done
 * @param {object} engine    the active engine
 * @param {{ gen: string, onomatoShipped: string, styled: boolean }} opts
 */
export function applyMeguminV11Sections(dict, engine, { gen = "reply", onomatoShipped = "", styled = false } = {}) {
    const frame = v11Frame(engine);
    // Thinking is for a fresh reply only (Continue and Impersonate drop it, generation.js).
    dict["[[thinking]]"] = gen === "reply" ? thinkingSection(dict["[[THINK]]"], frame) : "";
    dict["[[formatting]]"] = formattingSection({ dnratio: dict["[[DNRATIO]]"], color: dict["[[COLOR]]"], dn: dict["[[DN]]"] }, frame);
    dict["[[banned]]"] = bannedSection(dict["[[banlist]]"], frame);
    // Impersonate writes as {{user}}: the rule against it would argue with the request.
    dict["[[reminder]]"] = reminderSection({ presetChecks: engine && engine.reminderChecks, userLine: gen === "impersonate" ? "" : dict["[[user]]"] }, frame);
    dict["[[content]]"] = String((engine && engine.contentRules) || "");
    dict["[[addon_rules]]"] = addonRulesSection({ onomato: dict["[[onomato]]"], onomatoShipped, styled, html: dict["[[html]]"] });
    return dict;
}
