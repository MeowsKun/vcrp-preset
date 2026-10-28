// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Megumin Suite V11's engines, adapted to VCRP's modules.
//
// The Megumin Originals (data/megumin.js) keep V11 word for word, Megumin's ban list and
// its wording of the shared texts included. These are the same engines run as VCRP engines:
// V11's engine text, thinking, Author's Notebook and turn frame, with
//   - VCRP's ban list (its dash rule, stripped articles, pattern descriptions and stock
//     phrases included) and VCRP's dash line in V11's final check (engine/meguminV11.js);
//   - the dash cleaner on;
//   - VCRP's own wording of the writing styles, add-ons, Story Config and Story Director.
// V11's story settings already win over its engine text ("Where one contradicts anything
// above, the setting wins"). The one rewording is for a writing style other than V11's own:
// it gets a lead-in of its own and wins over V11's narration section (buildBaseDict).
//
// Built from the originals as they load, so a new V11 release carries over. A lead-in that is
// gone from V11's text fails the tests, so an upstream rewrite cannot leave a clash behind.
// ─────────────────────────────────────────────────────────────────────────────

import { modes_megumin } from "../megumin.js";

/** [original id, adapted id, label]: the V11 Тайна engines (the Preview stays original only). */
export const V11_ADAPTED = [
    ["v11-voice-megumin", "v11-voice-adapted", "V11 Тайна · Adapted"],
    ["v11-writers-room-megumin", "v11-writers-room-adapted", "V11 Тайна · Writers' Room · Adapted"],
    ["v11-deepseek-megumin", "v11-deepseek-adapted", "V11 Тайна DeepSeek · Adapted"],
];

/**
 * V11's lead-ins to the writing style, and what they become for a style other than V11
 * Default or V11 Inside: those are written to follow "You narrate as", the others are not,
 * and they decide the narration where V11's own section says otherwise.
 */
export const V11_ADAPTED_STYLE_LEADS = [
    ["You narrate as [[aiprompt]]", "Your narration follows this style. Where anything below differs from it, the style wins.\n[[aiprompt]]"],
    ["JULIA is: [[aiprompt]]", "JULIA narrates in this style. Where anything below differs from it, the style wins.\n[[aiprompt]]"],
];

export const modes_v11_adapted = V11_ADAPTED.map(([from, id, label]) => {
    const m = modes_megumin.find(x => x.id === from);
    return m ? { ...m, id, label, megumin: false, adapted: from } : null;
}).filter(Boolean);
