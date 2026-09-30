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
- **No Engine preset.** Background tasks (memory summaries, NPC scans, the ban list, Story
  Director, image prompts, style generators) build their own prompt; nothing ever switches your
  active preset.
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
  stock phrases; em dashes allowed only inside spoken NPC dialogue).
- User Consent block without the slur in its example list; Megumin's feedback form and donation
  details removed from the About card (it links to the original project instead).
- **Trimmed:** Side Panel, Image Generation (ComfyUI, incl. NPC portrait generation and NPC image
  tags), the Persona tab, the legacy V4–V9 engines and their CoTs, the Co-writer engines, and the
  Death, Combat, Direct Language, Dice, MVU and Organic NPCs & Events add-ons, and the V9 Lean/Full
  word limits. Saved settings that used any of them are
  cleaned up or moved to the V10 equivalent automatically.

## What's included

- **Engines:** V10 Ukiyo and V10 Shura (with Enhanced Dialogue), their CoTs and Thinking Cap variants.
- **Tabs:** Presets & CoT (with Story Config), Writing Style (+ Anime Mode), Global Toggles & Add-ons,
  Blocks, Story Director, Dynamic Ban List, NPCs Bank, Memory Core, Knowledgebase, Global Settings,
  plus Dev Mode.
- **Add-ons:** Bold NPCs, Immersive HTML, Dialogue Colors, Dialogue & Narration tags.

## Install

1. SillyTavern → Extensions → Install Extension → `https://github.com/MeowsKun/vcrp-preset`
   (branch `v10-fork` while in development).
2. Import one preset from `Presets/` in the AI Response Configuration panel and select it:
   - `VCRP V10 Universal.json`: the standard preset.
   - `VCRP V10 Universal Cache Friendly.json`: same content, ordered so APIs that discount
     cached input (Claude, Gemini, DeepSeek) can cache most of the prompt.
3. Extensions → Regex: make sure the preset's regex scripts are enabled.
4. Open VCRP with the wand button, pick an engine in **PRESETS & COT**, and play.

## Development

- `node tools/link_check.mjs`: loads every module against a stubbed SillyTavern (catches broken imports).
- `node tools/test_fork.mjs`: builds real prompts from both presets and checks the prompt interceptor.
- `node tools/test_ui.mjs`: renders every tab and clicks every button in a simulated browser
  (one-time setup: `cd tools && npm install`).
- `python tools/gen_skeleton.py`: regenerates `data/skeleton.js` (Dev Mode's layout view) after a preset edit.

VCRP-specific code lives in `src/vcrp/`; changes to upstream files are kept small and marked
`VCRP:` so future Megumin Suite updates can be merged.
