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
- **Knowledgebase** tab (from VCRP V8): rule/lore entries, always-on or keyword-triggered.
- **Anime Mode** (from VCRP V8): in the Writing Style sidebar under DN Ratio.
- **Bold NPCs** add-on (from VCRP V8).
- **Merged ban list:** V10's list plus VCRP's rules (stripped articles, pattern descriptions,
  stock phrases; em dashes allowed only inside spoken NPC dialogue).
- User Consent block without the slur in its example list; Megumin's feedback form and donation
  details removed from the About card (it links to the original project instead).

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

VCRP-specific code lives in `src/vcrp/`; changes to upstream files are kept small and marked
`VCRP:` so future Megumin Suite updates can be merged.
