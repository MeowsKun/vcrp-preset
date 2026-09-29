// Default text the extension injects into the preset's [[vcrp:*]] anchors.
// The preset owns the core prose; this file owns everything that depends on a setting.

/**
 * The engines the preset ships. Each has its own prompt slot in the preset, kept only when selected.
 * `voice` is the default narration voice ([[vcrp:voice]]) used when the profile has no custom one.
 * `cot` is the chain of thought paired with the engine when the CoT setting is "auto".
 */
export const ENGINES = [
    {
        id: "ukiyo",
        label: "Ukiyo (V10)",
        description: "The storyteller. Mood, texture, scenes told for their own sake. Most creative, may show the odd AI-ism.",
        cot: "ukiyo",
        voice: "the register shifts scene to scene — dry, cold, tender, wry, plain — and never repeats the previous turn's temperature. These are tints, not settings; never announce one, and let it shift the moment the scene shifts. Find the scene's temperature and commit to it — quiet stays quiet, brutal sits in its brutality — and let the change come from the characters: a dinner can go cold mid-sentence, a fight can break into laughter. Don't inject tension because you think the reader needs action. Wit lives here, never in a character's mouth.",
    },
    {
        id: "shura",
        label: "Shura (V10)",
        description: "The director's cut. Every character is the protagonist of their own story; no villains, only conflicting values. Tighter, cleaner prose.",
        cot: "shura",
        voice: "the temperature shifts scene to scene — dry, cold, tender, wry — and never repeats last turn's. Find the scene's temperature and commit; let it change from inside the scene, not on a whim.",
    },
];

export const COTS = [
    { id: "ukiyo", label: "Writer's Mind (Ukiyo)" },
    { id: "shura", label: "Seven Rules (Shura)" },
];

export const getEngine = id => ENGINES.find(e => e.id === id) || ENGINES[0];

export const DEFAULT_ANIME_PROMPT = `Write the roleplay as a scene from an anime or manga. This is not light flavor: it must visibly reshape dialogue, narration, and plot movement wherever the scene allows. While active, this heightened framing overrides the grounded, low-melodrama narration defaults. Play it straight, never as winking parody.

DIALOGUE:
- Anime speech rhythm: characters blurt feelings when flustered, drop into quiet vulnerability when exposed, and snap into sharp outbursts when caught off guard ("I- you- what?!").
- In-character affectations where they fit: honorifics (-chan, -kun, -senpai, -sama), interjections ("eh?!", "mou~", "uso!", "haaah?", "d-dummy!"), a signature catchphrase or verbal tic per character.
- Tsundere deflection, dramatic declarations, comedic over-explanation, dense obliviousness to obvious feelings. Embody the tropes; never announce them.

REACTIONS:
- Exaggerate cues the way anime frames them, as described action: furious blushing, comedic tears, jaw-drops, sweat-drops, going board-stiff, sparkling eyes, the dramatic stumble, steam from the ears.
- Scale emotion to anime size: small embarrassment becomes a full-body meltdown; a confession freezes the world for a beat.

NARRATION:
- Frame scenes like manga panels: hard cuts to a telling detail, a held beat before a big line, close-ups on a hand, an eye, a trembling lip.
- Slow-motion on emotional or action peaks. Internal monologue can cut in as sharp present-tense intrusion.
- Translate anime visual beats into prose: wind catching hair, petals or light flaring, the static hush before impact.

PLOT & PACING:
- Episodic momentum, rising rivalries, slow-burn romance with charged near-moments, dramatic reveals, cliffhanger beats, and comedic timing that punctures tension.

DEPICTION (SFW and NSFW):
- Outfits and transformations: loving detail on how fabric sits, clings, and moves; uniforms, frills, ribbons; transformation flair when fitting.
- Hypnosis and trance: spiral or heart-shaped pupils, a glazed, pliant expression, a sing-song or echoing trigger, the slow droop into blank obedience.
- Sex scenes: ecchi/hentai style. Heightened expressive reactions, flushed and dramatized framing, exaggerated sensation and sound, the genre's vocabulary and visual emphasis. Vivid and fully in-genre.`;

// Appended to whatever anime text is in use (default or custom), so the precedence always holds.
export const ANIME_PRECEDENCE = "While Anime mode is on, its dialogue and reaction style overrides the engine's <dialogue> restrictions on catchphrases, declarations, punchlines, and polish. Everything in <banlist> still applies.";

/**
 * Optional response blocks. Each one adds:
 *  - a line in the reply structure (before or after the scene prose),
 *  - a template the model fills in (plus an optional note shown above it),
 *  - a history policy, applied by the extension to past replies before they are sent:
 *      "strip"   remove from every past reply (saves context)
 *      "latest"  keep only in the most recent reply (the model sees the current state)
 *      "condense" keep while recent; beyond `condenseDepth` replace the whole reply with this block
 * `title` is what the extension looks for inside <summary>…</summary> to find the block again.
 */
export const BLOCKS = [
    {
        id: "worldState",
        label: "World State",
        title: "World State",
        position: "before",
        history: "latest",
        description: "Status panel: date and time, location, PC and NPC outfits, moods, agendas, secrets, off-screen NPCs, open threads, story phase.",
        template: `<details class="vcrp-block">
<summary>📌 <b>World State</b></summary>

**🗓 Date & Time:** [In-world date, weekday, approximate time]
**📍 Location:** [Specific place: room, street, building] | [City/Region]
**🌡 Weather & Atmosphere:** [Weather, temperature feel, lighting]

---

**🧍 [PC Name]:**
* *Outfit:* [Current clothing, accessories, state of dress]
* *Position:* [Posture, where in the space]
* *Visible Condition:* [Injuries, exhaustion, intoxication, sweat: what a camera would catch]
* *Carrying:* [Hands, pockets, bag, if known]

---

**👥 NPCs Present:**
**[NPC Name]:**
* *Outfit:* [Current clothing]
* *Position:* [Where, posture, what they're doing]
* *Mood:* [Visible emotional surface]
* *Agenda:* [What they want right now]
* *Secret:* [What they know or want that the PC doesn't]

*[Repeat for each NPC in the scene]*

---

**💡 Off-Screen:**
* [NPC Name]: [What they're plausibly doing right now, and where]

---

**🔥 Unresolved Threads:** [3 to 5 max, one line each. Drop resolved ones.]
**🌱 Planted Seeds:** [Setup element] → [what it hints at] | [replies since planted]
**⏳ Consequence Timers:** [PC action or inaction] → [expected ripple] | [replies remaining]
**🎯 Arc Phase:** [Setup / Escalation / Complication / Crisis / Resolution]
**🎦 Scene Phase:** [Simmer / Building / Peak / Breather]
</details>`,
        cotStep: "the World State carries over from the last one, changing only what actually changed.",
    },
    {
        id: "innerChatter",
        label: "NPC Inner Chatter",
        title: "NPC Inner Chatter",
        position: "after",
        history: "strip",
        description: "NPC private thoughts the PC never hears: crushes, resentment, scheming, anxiety. Max 30 words (Megumin V10 standard).",
        // Content and the 30-word cap follow Megumin Suite V10's NPC_Inner_Chatter block.
        template: `<details class="vcrp-block">
<summary>💭 <b>NPC Inner Chatter</b></summary>

[Unfiltered internal layer hidden from the PC. Reveals what NPCs truly think, feel, and say when the player isn't meant to hear.
- If multiple NPCs are present: render this as private dialogue between them, spoken behind the PC's back. They drop their public masks and reveal their real opinions, motives, alliances, and grudges.
- If only one NPC is present: render this as raw, unspoken thought inside that character's head: stray feelings, regrets, judgments, and memories.
- max Length is 30 words.
Tone is honest and unguarded, contrasting with whatever the character shows on the surface.
Example (single NPC, the father):
"NPC NAME: What a disappointment of a son... I miss my wife. She'd know what to say to him. I never did."]
</details>`,
        cotStep: null,
    },
    {
        id: "cyoa",
        label: "Choices (CYOA)",
        title: "Choices",
        position: "after",
        history: "strip",
        description: "Four short suggestions for what the PC could do next. Suggestions only; never acted on by the AI.",
        note: "This panel is the only place options may appear. The scene itself still never offers a menu or asks what {{user}} does next.",
        template: `<details class="vcrp-block" open>
<summary>🎲 <b>Choices</b></summary>

1. [Short suggestion for the PC's next move]
2. [A different direction]
3. [A bolder or riskier option]
4. [A wildcard]
</details>`,
        cotStep: null,
    },
    {
        id: "summary",
        label: "Summary",
        title: "Summary",
        position: "after",
        history: "condense",
        description: "Short factual recap of this reply. Past replies older than the condense depth are replaced by their summary to save context.",
        template: `<details class="vcrp-block">
<summary>💾 <b>Summary</b></summary>

[Only what happened in this reply. Max 100 words. Facts, no interpretation.]
</details>`,
        cotStep: null,
    },
];

/** Wraps the global-settings lines; used for every generation type (reply, continue, impersonate). */
export const SETTINGS_WRAPPER = lines => `<session_settings>\n${lines}\n</session_settings>`;

export const LENGTH_TEXT = (type, words) =>
    `- Length: ${type === "min" ? "at least" : "at most"} ${words} words of scene prose (the <think> block and info blocks don't count).`;

export const LANGUAGE_TEXT = (lang) =>
    `- Language: write everything except the <think> block in ${lang}.`;

export const PRONOUN_TEXT = {
    male: "- {{user}} is male. Always portray and address him as such.",
    female: "- {{user}} is female. Always portray and address her as such.",
};

export const DIALOGUE_COLOR_TEXT = `- Dialogue colors: give every character a distinct, readable hex color and wrap all their spoken lines in it: <font color="#HEXCODE">"Dialogue here"</font>. A character's color is locked for the whole story.`;

export const DIRECT_LANGUAGE_TEXT = `- Explicit vocabulary: in sex scenes, call body parts and acts by their blunt, direct names ("dick", "pussy", "ass", "cum"). No coy euphemisms like "member", "core", or "folds".`;
