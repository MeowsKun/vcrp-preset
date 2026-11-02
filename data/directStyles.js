// Direct prose-style instructions (not tag-based).
// VCRP: the styles of the engines VCRP ships. V11 Default and V11 Inside are Megumin Suite V11's
// own, word for word (data/megumin.js); the V10 pair's are VCRP's wording (Megumin's in
// MEGUMIN_STYLE_RULES while a Megumin Original engine is active). The styles of the older
// generations (V7 to V9) and the generic ones were removed.
import { MEGUMIN_V11 } from "./megumin.js";

export const directStyles = [
    {
      id: "dir_v11",
      name: (MEGUMIN_V11 || {}).styleName,
      desc: (MEGUMIN_V11 || {}).styleDesc,
      rule: (MEGUMIN_V11 || {}).styleRule
    },
    {
      id: "dir_v11_inside",
      name: (MEGUMIN_V11 || {}).insideName,
      desc: (MEGUMIN_V11 || {}).insideDesc,
      rule: (MEGUMIN_V11 || {}).insideRule
    },
    {
      id: "dir_v10_ukiyo",
      name: "V10 Ukiyo Default",
      desc: "The register shifts scene to scene and never repeats the last turn's temperature.",
      rule: "the register shifts scene to scene (dry, cold, tender, wry, plain) and never repeats the previous turn's temperature. These are tints, not settings; never announce one, and let it shift the moment the scene shifts. Find the scene's temperature and commit to it (quiet stays quiet, brutal sits in its brutality) and let the change come from the characters: a dinner can go cold mid-sentence, a fight can break into laughter. Don't inject tension because you think the reader needs action. Wit lives here, never in a character's mouth."
    },
    {
      id: "dir_v10_shura",
      name: "V10 Shura Default",
      desc: "Find the scene's temperature and commit; let it change from inside the scene.",
      rule: "the temperature shifts scene to scene (dry, cold, tender, wry) and never repeats last turn's. Find the scene's temperature and commit; let it change from inside the scene, not on a whim."
    }
];
