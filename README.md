# VCRP

A SillyTavern extension + chat-completion preset for adult, uncensored roleplay.
The preset holds the engines, rules, and chain of thought; the extension switches
parts of it on and off and fills in everything that depends on your settings, per character.

> **Status:** V9 rebuild in progress (`v9-rebuild` branch).

VCRP is derived from [Megumin Suite](https://github.com/Arif-salah/Megumin-Suite) by
KazumaONIISAN, licensed [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
The Ukiyo and Shura engines, their chains of thought, the strict dialogue rules, the ban
list, and the consent block are ported from Megumin Suite V10. VCRP has been substantially
rewritten (injection engine, preset layout, UI) and is likewise non-commercial.

## Contents

| Path | What it is |
| --- | --- |
| `index.js`, `src/`, `style.css`, `manifest.json`, `img/` | The extension |
| `Presets/VCRP V9.json` | The roleplay preset (import this and select it) |
| `preset-src/` | Editable source text for every preset prompt |
| `tools/build_preset.py` | Rebuilds `Presets/VCRP V9.json` from `preset-src/` |
| `tools/test_inject.mjs` | End-to-end test of the extension against the built preset |
| `tools/render_prompt.mjs` | Writes the exact prompt for each engine to `tools/out/` |

## Features

- **Engines:** Ukiyo (the storyteller) or Shura (the director's cut), each with its own chain of thought.
- **Thinking:** visible `<think>` block, shown collapsed in chat and removed from past replies before
  sending. Optional Thinking Cap. The CoT prefill is used only for models that accept one.
- **Strict dialogue**, **Bold NPCs**, and **User consent** toggles.
- **Response blocks:** World State, NPC Inner Chatter, Choices, Summary (old copies are removed from
  context automatically; old replies can be condensed to their summaries).
- **Global settings:** language, your character's gender, length limit, dialogue colors, explicit vocabulary.
- **Writing style:** custom narration voice, Anime mode.
- Per-character or per-group settings, with a global default.
- Continue, Impersonate, and other extensions' background requests each get a fitting prompt
  (no fresh `<think>`, no blocks, no prefill).

## Install

1. SillyTavern → Extensions → Install Extension → `https://github.com/MeowsKun/vcrp-preset`
2. Import `Presets/VCRP V9.json` in the AI Response Configuration panel and select it.
3. Make sure the preset's two **VCRP · Think box** regex scripts are enabled (Extensions → Regex).
4. Open the settings with the floating wand button or Extensions menu → VCRP.

Chat Completion APIs only (the preset format does not apply to Text Completion).

## Prompt caching (saves money on long chats)

Everything that stays the same for the whole chat is sent before the chat history; everything
that can change per turn comes after it, so the API can reuse the cached start of the prompt.

- **Gemini, DeepSeek:** caching is automatic.
- **Claude** (direct or via OpenRouter): SillyTavern only caches when you enable it. In
  `SillyTavern/config.yaml` set:
  ```yaml
  claude:
    cachingAtDepth: 1
  ```
  Everything after the history is merged into the final user message, so depth 1 puts the cache
  mark on the last story reply. Restart SillyTavern after editing the file.

## How the preset and extension fit together

The preset contains two kinds of markers, resolved by the extension just before sending:

- `[[vcrp:name]]` is replaced with text built from your settings, or removed with its line.
- `[[vcrp:if condition]] … [[vcrp:endif]]` keeps a section only when the condition holds
  (e.g. `engine=shura`, `strictDialogue`, `gen=continue`; `!` negates).

Prompts from any other preset are never touched.

## Editing the preset text

1. Edit the `.md` files in `preset-src/` (`{{include:file.md}}` pulls in another file).
2. Run `python tools/build_preset.py`. It refuses to build if a condition or marker is wrong.
3. Run `node tools/test_inject.mjs` to check nothing broke.
4. Re-import `Presets/VCRP V9.json` in SillyTavern.
