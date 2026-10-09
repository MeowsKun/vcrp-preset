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
  and shared (all characters) entries; import/export. Keywords match whole words (`hypno*` for word
  starts) in the last few messages (adjustable). Always-on entries sit before the chat, so they are
  cached; keyed ones go after it, only on the turns they fire. "What fires now?" previews which
  entries your last messages plus the message box would send.
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
- **Dialogue Colors that stay put:** each character keeps the color they first spoke in for the
  whole chat. The add-on asks for the speaker's name on each colored line, tells the model the
  colors already taken (after the chat, so never cached), and corrects a reply that gives a known
  character another color. The Megumin Original engines keep Megumin's own wording. A color is
  made readable as it is locked: lightened or darkened until it reads against your theme, and
  turned when it is all but the same as a color already taken. While the add-on is on, Global
  Toggles & Add-ons lists this chat's colors: change one (kept exactly as you set it), or forget
  it and the model picks again.
- **Sideways scrolling on mobile:** scrolling sideways on the blocks card, or on anything wide in
  a reply that scrolls (an HTML object, a table), no longer counts as a swipe (which regenerated
  the last reply). Swiping anywhere else works as before.
- **Tone Rules** (Global Toggles & Add-ons, and the Pura Director panel; the same text in both):
  your own rules for the story's overall tone, saved with each chat. While on, they go after your
  newest message on every reply and Continue (not Impersonate), with any engine, the Megumin
  Original ones included, and they win where Story Config's Narration Tone or the engine's own
  style disagree. With a Pura engine and Pura's Dead Dove Escalation rolled, they sit right under
  it; otherwise on their own. No preset re-import needed.
- **Tense** in Story Config: present or past. Left on default it sends nothing and each engine
  keeps its own (Megumin's Story Config has no tense, so the Megumin Original engines only get one
  if you pick it).
- User Consent block without the slur in its example list; Megumin's feedback form and donation
  details removed from the About card (it links to the original project instead).
- **Trimmed:** Side Panel, Image Generation (ComfyUI, incl. NPC portrait generation and NPC image
  tags), the Persona tab, the legacy V4–V9 engines and their CoTs, the Co-writer engines, and the
  Death, Combat, Direct Language, Dice, MVU and Organic NPCs & Events add-ons, and the V9 Lean/Full
  word limits. Saved settings that used any of them are
  cleaned up or moved to the V10 equivalent automatically.

## What's included

- **Engines:** V10 Ukiyo and V10 Shura (with Enhanced Dialogue), their CoTs and Thinking Cap variants,
  plus their **Megumin Original** versions, and the two **Pura Director** engines (below).
- **Tabs:** Presets & CoT (with Story Config), Writing Style (+ Anime Mode), Global Toggles & Add-ons,
  Blocks, Story Director, Dynamic Ban List, Focus, NPCs Bank, Memory (Story Memory), Knowledgebase,
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
2. **Caching:** on **OpenRouter + Claude**, VCRP marks the cache itself (Memory tab, "Mark the
   cache from VCRP", on by default): on your last two replies, which line up from one turn to the
   next on every provider, Bedrock included. This **needs** `cachingAtDepth: -1` under `claude:`
   in SillyTavern's `config.yaml` (then restart), so SillyTavern adds none of its own markers:
   with both, a request can carry more markers than Claude accepts and fail with a 400 error.
   If you can't change `config.yaml`, untick "Mark the cache from VCRP" and pin OpenRouter to
   Anthropic instead. On the **direct Anthropic** API, set `cachingAtDepth: 0` and
   `extendedTTL: true` there.
3. **OpenRouter:** put Anthropic first in the provider list and turn off fallbacks, so the chat
   never moves to a provider without your cache.

Global Settings → Setup Check flags anything missing. Existing Memory Core summaries become
chapters the first time each chat is opened.

**Reply length** (Memory tab): a reply's length is most of what it costs once the cache works.
The panel shows your recent replies' measured size (Story Memory's budget plans for it), and
sets the story's length (Story Config's Length) and the thinking's (Thinking Effort). A safety
cap in tokens stops a runaway reply; set it well above a normal one, since a reply that reaches
it is cut off.

**Pin** a fact or a chapter (the pin button beside it) to keep it in the memory text for good:
the size cap never trims it and a pinned chapter is never folded into an arc. The meter also
keeps a running **spend estimate** for the chat (replies and background calls, from VCRP's own
token counts; hidden reasoning SillyTavern never sees is not included).

**Background calls** (Story Director, NPC scans and updates, the ban list, style generators) send
a prompt of their own that is never cached, so on a long chat one can cost more than a few
replies. Each shows what it will send and roughly what it costs beside its button (the NPC
update's on its button's tooltip), and the spend estimate counts them apart from replies. With
Story Memory on and chapters written, the Story Director reads the story memory (arcs, the
gists before its window, the facts) and the last 30 messages instead of 100 raw ones or the
whole chat. If the approved chapters end further back (some still waiting for review), it reads
from where they end, so nothing falls in between. NPC Bank → Scanner Settings → **Only New Messages** (on by default): a scan reads
only the messages since the last scan, plus four before them for context, up to the scan depth.
An NPC update still reads the full scan depth.

To see it work without waiting for a break, use **Testing** in the Memory tab: **Cut now** takes
what the approved chapters cover out of the prompt (the next reply costs full price once),
**Undo cut** puts it back, **Preview recall** shows which chapters your last messages plus the
message box would bring back, and the memory text the prompt carries is shown in full.

**Cache check** (Memory tab → Testing, and Setup Check): every prompt is compared with the one
before it. When something before the chat history changes from one turn to the next (a lorebook
entry switching on and off, a `{{time}}` or `{{random}}` macro), the cache can only be read up to
that point and the rest is written again at double price on every request. The check names the
message where the prompt first changed and shows the text before and after.

## Keeping long stories on track: Focus

The **Focus** tab has two tools, each with its own switch.

**Plot focus:** write what the story should revolve around ("the ring Mara pawned, and the
people who want it back") and pick how hard it steers: a background thread, central, or
driving. While it is on, it goes out with every reply as the last thing the model reads, right
after your message (`[[plotfocus]]` closes the `</history>` slot in both presets). That part of
the prompt is never cached, so it costs only its own hundred tokens or so, and the cache never
notices it. It stays until you switch it off; "End after" can make it last a set number of
replies instead (a swipe of the last one still gets it). Story Memory's recall looks for it too,
so old chapters about it come back while it is on; drift audits check the story stays on it;
the Story Director plans around it. Impersonate goes without it, and Story Memory's summaries
never see it.

**Drift audits:** long roleplays drift: characters lose their edges and start to sound alike,
the same smirk or scent comes back every reply, stock phrasing piles up. An audit runs every few
replies (20 by default) and writes the writer a short correction.

- **What it checks** (each can be switched off): character drift against the character card and
  how they have been written, repeated motifs (images, gestures, metaphors, scene endings), and slop.
- **What it reads:** the replies since the last audit and your messages between them, the card,
  and the list of what earlier audits flagged. Each audit says which of those came back, so a
  motif that survives a correction is counted and named more firmly the next time.
- **Review first:** the audit's findings and correction wait in the Focus tab. Edit the correction
  if you like, then **Approve and use**, or **Discard**. Automatic audits hold while one waits.
- **Where it goes:** the approved correction rides with every reply in the per-turn rules
  (`[[focus]]` in Output RULES, both presets), after the chat history, so it never touches the
  cache. It stays until the next approved audit replaces it; edit or remove it in the tab. An
  Impersonate (the AI writing your turn) goes without it: it corrects the replies, not your voice.
- **Edit the wording:** Focus → Advanced: Edit Prompts, like the Story Director's: the auditor,
  each check, the correction's and the plot focus's text, and what each plot strength says.
  Your edits are used while the editor's switch is on; a blank field falls back to the built-in
  text, and Reset All Defaults puts it all back.
- **Repeat offenders** (on by default): up to three findings that came back after a correction
  (flagged in two audits or more) stay in the prompt under every new correction, so what an
  earlier one fixed does not creep back when the next one leaves it out. Taking the correction
  out of the prompt takes them out too; forgetting a finding drops it from the list.
- **Cost:** each audit is a call of its own to your model, never cached, priced beside **Audit
  now** and counted in the spend estimate: about $0.15 to $0.30 on Claude Opus at 20 replies.
  Two failed audits in a row pause the automatic ones until an **Audit now** works.

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

## Pura Director

Pura's Director Preset 16.0, by **Pura** ([platberlitz.github.io](https://platberlitz.github.io)),
as two engines in PRESETS & COT, working with everything VCRP adds:

- **Pura Director · Original:** Pura's writing text word for word, with Pura's own controls for
  formatting, length, user control and genre. Story Config, the writing style and VCRP's "never
  write for {{user}}" rule stand aside while it is selected.
- **Pura Director · Adapted:** the same core, reworded only where VCRP's modules take over: Story
  Config sets genre, tone, POV, tense, pace, length, friction and explicitness, and VCRP's rule keeps
  {{user}} yours. Tense left on default stays Pura's present tense, and Pura's rotating inner
  thoughts come along when Story Config's point of view is third omniscient (the limited ones
  forbid changing heads mid-scene). The rewordings are listed in `src/vcrp/pura/index.js`.

Every Pura setting is in **PRESETS & COT → Pura Director**, shown while a Pura engine is selected:
narration voices (one of eight, or a random one each reply), Friction, NSFW, Gooner and Nightmare
modes, Director Instructions, Grounded Prose Rules, HTML objects, Diegetic Stats, the Name
Randomiser, the scene randomisers (two at most) and Pura's optional reasoning help. Pura thinks
without a CoT script, so the Reasoning (CoT) settings rest while it is selected.

For the cache, VCRP assembles Pura's text itself instead of through `{{setvar}}` and `{{#if}}`:
everything that holds still sits in the cached part, and everything that changes per request (a
random voice, the randomisers, the name randomiser, Director Instructions with a `{{random}}` in
them) goes after your newest message, where it never touches the cache.

**Pura's trackers** are in the BLOCKS tab, in a group of their own, for any engine: NPC sheets,
choices (plain or with hidden skill checks), the direction menu, the dating-sim relationship card,
scene, time, pending events, achievements, reputation, inventory, status, secrets, off-screen,
world detail, your stats and level-ups. They are drawn with Pura's own card designs. Their full
rules go once in the cached part; each reply's block carries only their format. Most of them write
only when something changes, so VCRP hands the model the newest entry of each from the whole chat
every turn (an open event stays until it is resolved, a relationship card until it is severed).
With Pura's NPC Sheets in the block, the NPC Bank and Pura work as one: the sheets become the
bank's records (and the bank stops asking for dossiers of its own), Pura is told every turn who
never gets a sheet (the card's own cast, you, the bank's ignored names) and who the bank already
has, a tier upgrade fills in what a record still lacks without overwriting it, and a relationship
change updates its "Read on the PC"; both show in the chat card and can be undone there.

Pura's own text puts some trackers in the story (a sheet right after an NPC's introduction, the
scene at the top); here each of those sentences names the tracker's block instead. A tracker the
model still writes in the story is moved into its block as the reply arrives (the thinking is left
alone, nothing is added twice, and a forgotten closing tag is added), and older replies reach the
model without it. Only a tracker that starts its own line moves ("[TIME]" inside a sentence is the
story's), and a reply cut off inside a block is left as it is until a Continue finishes it. With a Pura
engine, a note out of character (`((OOC: …))`, which the Kink randomiser asks for) goes to a Notes
tab of the card, unless your own message was out of character: then the answer stays in the story.

**What it costs:** the Pura panel shows, at the top, what Pura's text comes to with your settings
(tokens cached and sent fresh every reply, priced on your model), and under each extra, mode,
randomiser and voice what it adds when on. In BLOCKS, each Pura tracker in the block shows its
cost per reply: its format and carried state (sent fresh), what it writes (measured from the
chat's last 20 replies; output is the dearest part), and its rules (cached). A randomiser counts
as one average roll, not the whole list it rolls from.

Where one of VCRP's blocks and a Pura tracker do the same job (Bonds and Relationships, World State
and Scene or Time, CYOA and Choices, Character Sheet and Your Stats), both can be on, but the BLOCKS
tab points it out: the model writes both every reply. The Pura panel does the same for VCRP's
Immersive HTML add-on and Pura's HTML objects. Under Pura Original, the Memory tab's Reply length
sets Pura's own length, and Thinking length rests (Pura has no CoT). Dev Mode does not copy a Pura
engine: its text is built from the Pura Director panel.

Both engines and the trackers are generated from Pura's own preset file by
`node tools/gen_pura.mjs` (the upstream files are in `tools/upstream/pura/`). The only text
changed is for the cache (the skill-check roll moves out of the cached rules), the sentences that
place a tracker in the story (they name its block instead), and a portrait lookup that only Pura's
own frontend has (cards show the initial instead).

## Development

- `node tools/link_check.mjs`: loads every module against a stubbed SillyTavern (catches broken imports).
- `node tools/test_fork.mjs`: builds real prompts from the preset and checks the prompt interceptor.
- `node tools/test_ui.mjs`: renders every tab and clicks every button in a simulated browser
  (one-time setup: `cd tools && npm install`).
- `python tools/gen_skeleton.py`: regenerates `data/skeleton.js` (Dev Mode's layout view) after a preset edit.
- `node tools/gen_megumin.mjs`: regenerates `data/megumin.js` and the Megumin Original preset from
  Megumin Suite V10 itself, after VCRP rewords a shared text or changes its preset layout.
- `node tools/gen_pura.mjs`: regenerates `data/pura.js` (the Pura Director engines and trackers) from
  Pura's preset in `tools/upstream/pura/`.
- `node tools/sim_cost.mjs [--memory] [--npcs] [--model opus-4.6] [--direct]`: plays a 1000-message chat
  through the real prompt builder and prices every request under Claude's prompt caching.

VCRP-specific code lives in `src/vcrp/`; changes to upstream files are kept small and marked
`VCRP:` so future Megumin Suite updates can be merged.
