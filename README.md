# VCRP

A SillyTavern extension + preset suite for roleplay. VCRP provides an in-chat
settings UI for tuning roleplay behavior (core engine, persona, writing style,
chain-of-thought, and more) together with importable presets that carry the
CoT scaffolding and response format.

> VCRP is a fork of [Megumin Suite Beta](https://github.com/Arif-salah/Megumin-Suite-Beta)
> by KazumaONIISAN. Full credit to the original author for the base suite.

## Components

- **Extension** (`index.js`, `style.css`, `manifest.json`, `example.html`,
  `data/`) - the third-party SillyTavern extension. Adds a floating button that
  opens a tabbed settings modal.
- **Presets** (`Presets/`) - importable SillyTavern completion presets holding
  the chain-of-thought and response-format prompts:
  - `VCRP V8.json` - **main roleplay preset** (V8 engine). Self-contained world/NPC/story
    rules. Still hooks into the extension via `Main 2`'s macros (`[[prompt3]]`,
    `[[COT]]`, `[[COLOR]]`, etc.). For DS4/GLM: disable "Main 3", enable "Main 3 DS4 + GLM".
    For Gemini: enable the "Prefill" slot.
  - `VCRP Engine.json` - utility engine preset (targeted by the extension as
    `TARGET_PRESET_NAME` for story planner, ban list, memory, etc.).
  - `VCRP Image.json` - preset used for image-generation prompt writing.
  - `VCRP V7.5 Gemini.json` / `VCRP V7.5 DS4 + GLM.json` - legacy V7.5 presets
    (superseded by V8, kept for reference).

## Settings tabs

Core Engine · Persona & Toggles · Writing Style · Global Settings ·
Add-ons & Blocks · Chain of Thought · Story Planner · Dynamic Ban List ·
Image Generation · NPCs Bank · Memory Core

## Install

**Option A - Install from URL (recommended):** In SillyTavern, open
Extensions → Install Extension and paste
`https://github.com/MeowsKun/vcrp-preset`. It installs into
`third-party/vcrp-preset` and works as-is - no renaming needed.

**Option B - Manual:** Copy the extension folder into
`SillyTavern/public/scripts/extensions/third-party/`. Any folder name works
(e.g. `vcrp-preset` or `VCRP`); the extension detects its own path at runtime.

Then:

1. Restart / reload SillyTavern. Enable **VCRP** in Extensions.
2. Import the preset(s) from `Presets/` via the SillyTavern preset panel.
