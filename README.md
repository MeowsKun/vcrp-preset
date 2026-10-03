# VCRP

A SillyTavern extension + chat-completion presets for adult, uncensored roleplay: engines,
chain of thought, story configuration, tracker blocks, NPC bank, memory, knowledgebase and more,
all in one install.

VCRP is based on **[Megumin Suite](https://github.com/Arif-salah/Megumin-Suite) V10 by
KazumaONIISAN**, used under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
(see `License`). VCRP is likewise non-commercial.

## What VCRP changes from Megumin Suite V10

- **Rebranded** to VCRP; settings are stored under the `VCRP` key (the key VCRP V8 used, so
  V8 profiles carry over). Works under any install folder name.
- **No Engine preset.** Background tasks (NPC scans, the ban list, Story Director, style
  generators) build their own prompt; nothing ever switches your active preset. Story Memory's
  summaries instead reuse the roleplay prompt itself, so they read it from cache.
- **Model-aware CoT prefill.** The preset's prefill slot is sent only to models that accept a
  prefill. Newer Claude (Opus/Sonnet 4.6+, Claude 5) and the newest Gemini Flash reject one.
  Setting: Global Settings → CoT Prefill (Auto / Always on / Always off).
- **Continue, Impersonate, and other extensions' background requests** get a fitting prompt:
  no fresh thinking block, no tracker blocks, no dice lines, no prefill.
- **Knowledgebase** tab (from VCRP V8): rule/lore entries, always-on or keyword-triggered; per-character
  and shared (all characters) entries; import/export.
- **Anime Mode** (from VCRP V8): in the Writing Style sidebar under DN Ratio.
- **Bold NPCs** add-on (from VCRP V8).
- **Setup Check** (Global Settings): flags a non-VCRP preset, preset regex not allowed/off, or the wrong API type,
  and puts a red dot on the VCRP button while a problem stands.
- **Backup & Restore** (Global Settings): all VCRP settings in one file.
- **Token breakdown** in the Prompt Payload Preview: what each part of the prompt costs.
- **Merged ban list:** V10's list plus VCRP's rules (stripped articles, pattern descriptions,
  stock phrases; no em dashes except at the end of a spoken line that gets cut off).
- **Clean Em Dashes** (Global Settings, on by default): takes the em dashes out of each new reply,
  a comma in narration and an ellipsis in speech, leaving the thinking, trackers and blocks alone.
  English stories only. **Clean This Chat** does the same for every earlier reply in the open chat.
- User Consent block without the slur in its example list; Megumin's feedback form and donation
  details removed from the About card (it links to the original project instead).
- **Trimmed:** Side Panel, Image Generation (ComfyUI, incl. NPC portrait generation and NPC image
  tags), the Persona tab, the legacy V4–V9 engines and their CoTs, the Co-writer engines, and the
  Death, Combat, Direct Language, Dice, MVU and Organic NPCs & Events add-ons, and the V9 Lean/Full
  word limits. Saved settings that used any of them are
  cleaned up or moved to the V10 equivalent automatically.

## What's included

- **Engines:** V10 Ukiyo and V10 Shura (with Enhanced Dialogue), their CoTs and Thinking Cap variants,
  plus their **Megumin Original** versions (below).
- **Tabs:** Presets & CoT (with Story Config), Writing Style (+ Anime Mode), Global Toggles & Add-ons,
  Blocks, Story Director, Dynamic Ban List, NPCs Bank, Memory (Story Memory), Knowledgebase,
  Global Settings, plus Dev Mode.
- **Add-ons:** Bold NPCs, Immersive HTML, Dialogue Colors, Dialogue & Narration tags.

## Install

1. SillyTavern → Extensions → Install Extension → `https://github.com/MeowsKun/vcrp-preset`
   (branch `v10-fork` while in development).
2. Import `Presets/VCRP V10 Universal.json` in the AI Response Configuration panel and select it.
   Everything that changes from turn to turn sits after the chat history, so providers that
   discount cached input (Claude, Gemini, DeepSeek) can reuse the rest of the prompt.
3. Extensions → Regex: make sure the preset's regex scripts are enabled.
4. Open VCRP with the wand button, pick an engine in **PRESETS & COT**, and play.

## Long chats on Claude: Story Memory

Story Memory (the **Memory** tab) keeps every request under a dollar target, however long the
chat runs. While you play nothing is dropped, so every turn reads the prompt from cache. After
a break the cache has expired anyway, and that is when older messages leave the prompt in one
cut, covered by chapters (one-line gists plus full text, recalled when the scene touches them)
and a fact ledger. New chapters wait for your review by default.

It relies on prompt caching. Set up once:

1. **Context Size** (AI Response Configuration): the model's maximum. Below what VCRP sends,
   SillyTavern trims the oldest message itself every turn and nothing is ever cached.
2. **Caching:** in SillyTavern's `config.yaml`, under `claude:`, set `cachingAtDepth: 0` and
   `extendedTTL: true`, then restart. On OpenRouter you can tick **Mark the cache from VCRP**
   in the Memory tab instead.
3. **OpenRouter:** put Anthropic first in the provider list and turn off fallbacks, so the chat
   never moves to a provider without your cache.

Global Settings → Setup Check flags anything missing. Existing Memory Core summaries become
chapters the first time each chat is opened.

To see it work without waiting for a break, use **Testing** in the Memory tab: **Cut now** takes
what the approved chapters cover out of the prompt (the next reply costs full price once),
**Undo cut** puts it back, **Preview recall** shows which chapters your last messages plus the
message box would bring back, and the memory text the prompt carries is shown in full.

## Megumin Original

For RP that reads exactly the way it did on Megumin Suite, with Story Memory and everything else
VCRP adds still working:

- **Engines** "V10 Ukiyo · Megumin Original" and "V10 Shura · Megumin Original": Megumin Suite
  V10's own engine text, thinking steps (and Thinking Cap variants) and Enhanced Dialogue, word
  for word. While one is selected, your writing style, add-ons, Story Config and Story Director
  are sent in Megumin's wording too (a text you edited yourself is sent as you wrote it), and the
  dash cleaner pauses.
- **Preset** `Presets/VCRP V10 Megumin Original.json`: Megumin's own preset text (ban list,
  Output RULES, lore and persona wrappers) on VCRP's layout, which is what Story Memory, the
  cache and the model-aware CoT prefill depend on. Only tags for features VCRP removed are gone,
  and the slur is still out of the (off by default) User Consent block.

Import the preset like the other one and pick a Megumin Original engine in PRESETS & COT. Setup
Check notes a mismatched pair. Both versions are generated from the upstream commit by
`node tools/gen_megumin.mjs`.

## Development

- `node tools/link_check.mjs`: loads every module against a stubbed SillyTavern (catches broken imports).
- `node tools/test_fork.mjs`: builds real prompts from the preset and checks the prompt interceptor.
- `node tools/test_ui.mjs`: renders every tab and clicks every button in a simulated browser
  (one-time setup: `cd tools && npm install`).
- `python tools/gen_skeleton.py`: regenerates `data/skeleton.js` (Dev Mode's layout view) after a preset edit.
- `node tools/gen_megumin.mjs`: regenerates `data/megumin.js` and the Megumin Original preset from
  Megumin Suite V10 itself, after VCRP rewords a shared text or changes its preset layout.
- `node tools/sim_cost.mjs [--memory] [--npcs] [--model opus-4.6] [--direct]`: plays a 1000-message chat
  through the real prompt builder and prices every request under Claude's prompt caching.

VCRP-specific code lives in `src/vcrp/`; changes to upstream files are kept small and marked
`VCRP:` so future Megumin Suite updates can be merged.
