# VCRP

A SillyTavern extension + chat-completion presets for adult, uncensored roleplay: engines,
chain of thought, story configuration, tracker blocks, NPC bank, memory, knowledgebase and more,
all in one install.

**New here, or just updated?** The [quick guide](docs/quick-guide.md) walks through the newest
features in a few minutes: VCRP Quick, Tone Rules, reply length and costs, Pura's extras.

VCRP is based on **[Megumin Suite](https://github.com/Arif-salah/Megumin-Suite) V10 by
KazumaONIISAN**, used under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
(see `License`). VCRP is likewise non-commercial.

## What VCRP changes from Megumin Suite V10

- **Rebranded** to VCRP; settings are stored under the `VCRP` key (the key VCRP V8 used, so
  V8 profiles carry over). Works under any install folder name.
- **A safe NPC Bank** (Megumin Suite's own fix, `3600dc2`): every value on an NPC card is escaped
  and a portrait is drawn only when it is an image, so an imported pack, a shared chat or a
  dossier a model was steered into writing can never run code on the page.
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
  it and the model picks again. Some models (GLM above all) leave a color tag open or wrap the
  narration in it, and the color then runs over the narration and the paragraphs after it. So
  every reply's tags are mended as it arrives, and the model is told how to close them:
  - a closing tag written wrong (`</ font>`, `<\/font>`) is fixed;
  - each quoted line gets its own tag, and the narration around it is left plain;
  - a tag never closed stops at the end of its line.

  The thinking, the blocks, and styling that is not dialogue are left as written.
- **Sideways scrolling on mobile:** scrolling sideways on the blocks card, or on anything wide in
  a reply that scrolls (an HTML object, a table), no longer counts as a swipe (which regenerated
  the last reply). Swiping anywhere else works as before.
- **Tone Rules** (Global Toggles & Add-ons, and the Pura Director panel; the same text in both):
  your own rules for the story's overall tone, saved with each chat. While on, they go after your
  newest message on every reply and Continue (not Impersonate), with any engine, the Megumin
  Original ones included, and they win where Story Config's Narration Tone or the engine's own
  style disagree. With a Pura engine and Pura's Dead Dove Escalation rolled, they sit right under
  it; otherwise on their own. Focus's drift audits check the replies against them too (tone
  drift). No preset re-import needed.
- **VCRP Quick** (SillyTavern's wand menu, by the chat input): a small panel to switch this chat's
  Tone Rules and plot focus on or off, and, with a Pura engine, Pura's scene randomisers (Dead
  Dove Escalation among them, two at most), without opening the VCRP window. A SillyTavern
  without the wand menu gets a small button under VCRP's own instead.
- **Existing cast only** (VCRP Quick, per chat): for scenes that should stay with the characters
  and threads already in the story. While on, every reply is told not to introduce anyone new
  (unnamed background people may still be scenery), and reminded who is already there (the card's
  character or group, you, the NPC Bank). It goes after Pura's randomisers, so a twist that calls
  for someone new (Grounded Complication, Chaos Mode, the Director's Cut) uses an existing
  character instead, and Pura's Name Randomiser rests. Any engine; replies and Continue, not
  Impersonate.
- **One-shot direction** (VCRP Quick, "Next reply only"): a steer for the next reply alone ("she
  finally tells him about the ring"). It goes out after your message with any engine, never
  written into the chat, and empties once that reply arrives; a swipe, regenerate or Continue of
  that reply gets it again, and your next message starts clean.
- **Each reply's cost** (Memory tab → Reply length → "Show each reply's cost", on by default): a
  small estimate under each reply's avatar, green when the cache was warm, amber when it was cold.
  Tap it for the breakdown: read from the cache, written to it, sent fresh, written by the model.
  Works with Story Memory on or off; a Continue adds its part to the reply.
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
  plus their **Megumin Original** versions, Megumin Suite V11's four engines (**V11 Тайна**, its
  **Writers' Room** and **DeepSeek** versions, and **V11 Тайна Preview**) with its Author's
  Notebook, and the two **Pura Director** engines (below).
- **Presets:** VCRP V10 Universal, VCRP V10 Megumin Original, VCRP V11 Megumin Original.
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
sets the story's length (Story Config's Length) and the thinking's (Thinking Effort). The
**safety cap** is a hard limit in tokens: a reply can never go over it, thinking and blocks
included. While it is set, the model is told its room and the story's share of it in words
(after the thinking and what your blocks take), so it plans to finish inside it; the panel shows
that split. A reply that still reaches the cap mid-sentence ends on its last full sentence
(Continue writes the rest), and the next reply carries the last complete blocks. For a reply of
about 2,000 tokens: Story length 450–550 words, Thinking length 250 words, a cap of 2,000.

**Hold each reply to the target** (on by default, with Story Memory): input and output together
stay within the per-request target.
- **How:** each reply's prompt is priced as it goes out (read from the cache, written to it,
  sent fresh), and what is left of the target, in output tokens, becomes the request's limit.
- **During play** the room is wide; it goes on the request but is not told to the model, since a
  large number would only invite longer replies.
- **Right after a break**, when the whole prompt is written to the cache again, the room is about
  a reply and a quarter (Story Memory's cuts leave that much). The model is told it, with the
  story's share in words.
- **Never cut short of a whole reply:** the request's own limit is at least half again your usual
  reply, even when the room is less. A reply stopped at its room used to be stopped in its blocks,
  the last thing it writes; one that runs over now finishes, a few cents over the target at most.
- **The safety cap**, when lower, still wins: it is the one limit that stops a reply.
- **A prompt that alone nears the target** gets a minimum room of 1,500 tokens, and the panel
  says so.
- **A block a reply leaves out, or is cut off in,** is carried to the next reply from where it was
  last written whole (World State, Bonds, Character Sheet, Story Tracker), and the model is asked
  to write it in full again, so one bad reply doesn't drop it from every reply after.
- **VCRP's own background calls** (summaries and their checks, audits, the Story Director, NPC
  scans and updates, the ban list, style generators) are each limited to 8,000 output tokens,
  well above what they write, so none can run away. Other extensions' calls are left alone.

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

The **Focus** tab has three tools, each with its own switches.

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

**Every reply** (on by default): on each reply VCRP reads the last few replies itself, with no
call of its own and nothing to approve. Whatever it finds is sent with that one reply, in
`[[focus]]` after the chat history, so it never touches the cache. When it finds nothing, nothing
is sent; when it does, the note is a couple of hundred tokens at most.

- **Swipes take a new direction:** a swipe is shown how the versions it replaces began and ended,
  and asked for a fresh take rather than a reworded copy.
- **Repeats:** it names:
  - phrases reused across the last 6 replies (the card's own words and yours are left out);
  - the same opening word three replies running;
  - three replies running that end by handing the turn to you (a question, or someone waiting
    on you);
  - the "It wasn't X. It was Y." habit.
- **Writing for you:** lines in the last reply that speak, act or think for your character are
  quoted back. Lines that only repeat what you wrote yourself are left alone, and so are
  questions and italic thoughts. This is pattern matching, so it can miss a line or flag one
  wrongly. It is off on engines meant to write your character (Co-writer engines, Pura Original
  set to write for `{{user}}`).

Fresh replies only: a Continue, an Impersonate and background calls go without. The wording is
in Advanced: Edit Prompts.

**Drift audits:** long roleplays drift: characters lose their edges and start to sound alike,
the same smirk or scent comes back every reply, stock phrasing piles up. An audit runs every few
replies (20 by default) and writes the writer a short correction.

- **What it checks** (each can be switched off): character drift against the character card and
  how they have been written, repeated motifs (images, gestures, metaphors, scene endings), and slop.
  While a plot focus is on, plot drift; while the chat's Tone Rules are on, tone drift (the replies
  softening or straying from the rules).
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

### V11 Тайна (Megumin Suite V11)

Megumin Suite V11's engines, word for word, from its Beta repository (`Arif-salah/Megumin-Suite-Beta`,
commit `e8378fe`, its 25/10 update; generated by the same `node tools/gen_megumin.mjs`, which reads
it through a `megumin-beta` git remote). V11 left the V10 engines and their texts as they were, so
the V10 Megumin Originals above are unchanged.

- **The engines** (Megumin Originals, each keeping the Author's Notebook):
  - **V11 Тайна**: one storyteller writes the whole turn, plainly and with a voice of its own. The
    base for every model. Picks **CoT V11 Тайна**.
  - **V11 Тайна · Writers' Room**: the same story, worked by a room of five in the thinking. Picks
    **CoT V11 Тайна · Writers' Room**.
  - **V11 Тайна DeepSeek**: V11 Тайна with one more line, so DeepSeek stops treating the character as
    the player. DeepSeek tends to leave the blocks out; VCRP carries each one from where it was last
    written whole. Picks CoT V11 Тайна.
  - **V11 Тайна Preview**: the first V11 release, kept as it was (a writers' room of five, one overt
    narrator). Picks **CoT V11 Тайна Preview**; for models that over-think (GLM, Kimi, DeepSeek,
    Qwen), pick its **Thinking Cap**: five short lines of notes, no draft, no word count, and its
    rules said again as the last thing the model reads (after your message, never cached). As in
    Megumin Suite V11, no Thinking Cap (V10's included) is given the Thinking Effort word count.
- **The styles**: **V11 Default** (an overt narrator with a voice and opinions) and **V11 Inside**
  (the narration rides inside one character at a time, never yours). Picking a V11 engine picks V11
  Default unless V11 Inside is already in use; switching between the V11 engines keeps it.
- **The preset** `Presets/VCRP V11 Megumin Original.json`, on VCRP's layout. V11 keeps its words
  in the extension now and its preset is only slots: its rules up top (cached) and what changes each
  turn after the chat. VCRP builds the sections the way V11 does, from V11's words
  (`src/engine/meguminV11.js`): each engine's Content section, Story settings (with V11 Тайна's
  `<repetition>` rule), the thinking, the formatting, V11's ban list (V11 Тайна's own on its engines,
  your phrases under it) and the numbered final check. V11 Тайна and its versions take V11's tagged
  wording (`<story_settings>`, `<formatting>`, `<final_check>`, "Write the response in English."),
  the Preview its older headings. Story Config reads in V11's wording on every V11 engine (its point
  of view is the person only; whose head the narration follows is V11 Inside's). Only tags change
  from V11's preset: removed features out (dice, images, MVU), VCRP's in. The NPC list, the NPC
  dossier rules and the Story Director's plan ride after the chat, as in VCRP's own preset, because
  in VCRP they change turn to turn and would break the cache in the cached part. V11's Current Info
  and This Turn are VCRP's `[[blocks]]`, which carry the kept state the same way. **Re-import it**
  after updating: Setup Check names the old one. Your V10 presets need no re-import.
- **The {{user}} rule** is V11's wording on VCRP's engines and on V11 ("the response does not
  speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for"), the last
  line of each preset's final list (3 in VCRP's, 5 in V11's), and left out on Impersonate.
- Story Memory, Focus, Tone Rules, the one-shot direction, Existing cast only, the length limit,
  Dialogue Colors, the NPC Bank and every block work with them as with every VCRP engine.
  `node tools/test_cache.mjs` plays V11 turns on the Preview and on V11 Тайна and checks each one
  reads the last one's cached part back byte for byte.

### Author's Notebook

From Megumin Suite V11: the story keeps two or three hidden truths, plants small clues, and
reveals each one when the story earns it, instead of forgetting a secret or blurting it out.

- **On** by itself with V11 Тайна (its own text speaks of it); a switch in the Focus tab for any
  other engine. The model writes the truths in a `<Notebook>` block, then only what changes in a
  `<Notebook_Update>` block (a clue planted, who found out, what came out).
- **VCRP keeps the rules** (V11's): at most three live truths, ids that are VCRP's, a truth the
  model can never quietly rewrite, one clue per truth per reply, and a clue the reply never
  actually shows is marked "not found in the reply".
- **Kept in the replies.** Each turn the notebook is read back from the chat's own notebook
  blocks, so a swipe, an edit or a deleted message changes it exactly as it changed the story.
  Your own changes in the Focus tab (edit a truth, mark it revealed, delete it, activate a past one
  again) are kept with the chat.
- **The cache:** its fixed rules sit in the cached part (V11's own `[[notebook]]` slot, or with
  the block rules); the live truths and the setup or update rules ride with the blocks, after the
  chat. The notebook blocks are taken out of the history, the summaries and the audits like every
  block, and are never carried as "the blocks as they stood".
- **No spoilers:** each reply's notebook changes are a tab on its card, blurred until you hover or
  tap a line; the Focus tab keeps the live truths behind a warning.

### Characters on file

The blocks the model reads each turn are the last reply's, so a character who left the scene
dropped out of them. When your message or the last reply names someone who is not in those
blocks, their last World State entry and Bonds line are found in the chat (the part Story Memory
cut included) and sent with the block instructions, after the chat; nothing is sent otherwise.
Someone who walks out and comes back ninety messages later comes back as they left. On by default
(BLOCKS tab, under World State, or under Bonds without it). Pura's trackers already carry each
character's newest entry.

### The On/Off switch, lore for background calls

- **On / Off** on the top bar of the VCRP window: off, VCRP steps aside. The prompt goes out as
  SillyTavern builds it (a VCRP preset's own tags blanked), with no request limit, no cache
  markers and no Story Memory cut, and nothing runs after a reply. Cards and badges already in the
  chat still show; a button you press in the window still works. Setup Check says when it is off.
- **Lorebook entries for background calls** (on by default; Global Settings → Behaviour → *Lore
  for background calls*): the Story Director, NPC scans and Focus audits get the World Info entries
  the story has active, up to about 3,000 tokens a call, and an NPC update the entries that name
  that NPC. These calls build their own prompt, so the lorebook never reached them before, and
  they are never cached, so the cap keeps a big lorebook from costing much.

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
Randomiser, the scene randomisers (two at most) and Pura's optional reasoning help. Pura has no
CoT script: it opens each reply with its own `<think>` block like every engine (drawn in the
Thinking box, kept out of the history), with Pura's reasoning help, if picked, as what it works
through. The CoT switch still turns it on or off and Thinking length still caps it; the CoT scripts
themselves rest while a Pura engine is selected.

For the cache, VCRP assembles Pura's text itself instead of through `{{setvar}}` and `{{#if}}`:
everything that holds still sits in the cached part, and everything that changes per request (a
random voice, the randomisers, the name randomiser, Director Instructions with a `{{random}}` in
them) goes after your newest message, where it never touches the cache.

**Each reply's rolls:** Pura's randomisers, the random voice and the Name Randomiser are lists that
roll one pick per reply. VCRP rolls them itself on a real reply (the same uniform pick SillyTavern
would make) and adds what came up to that reply's Notes tab ("🎲 Rolled this reply"), never sent
back to the model. A Continue keeps the voice the reply began in. With **Swipes keep the rolls** on
(Pura Director panel), a swipe or regenerate of the latest reply writes it again with the same
rolls. A list in your own Director Instructions is left for SillyTavern to roll.

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
sets Pura's own length, and Thinking length caps Pura's `<think>` block. Dev Mode does not copy a Pura
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
- `node tools/test_cache.mjs`: plays real turns with everything on, the history built from the chat
  with the preset's own regex applied as SillyTavern does, and checks that each request reads back
  what the last one cached, byte for byte (swipes, Continue and Story Memory's summary calls too).
- `python tools/gen_skeleton.py`: regenerates `data/skeleton.js` (Dev Mode's layout view) after a preset edit.
- `node tools/gen_megumin.mjs`: regenerates `data/megumin.js` and the Megumin Original preset from
  Megumin Suite V10 itself, after VCRP rewords a shared text or changes its preset layout.
- `node tools/gen_pura.mjs`: regenerates `data/pura.js` (the Pura Director engines and trackers) from
  Pura's preset in `tools/upstream/pura/`.
- `node tools/sim_cost.mjs [--memory] [--npcs] [--model opus-4.6] [--direct]`: plays a 1000-message chat
  through the real prompt builder and prices every request under Claude's prompt caching.

VCRP-specific code lives in `src/vcrp/`; changes to upstream files are kept small and marked
`VCRP:` so future Megumin Suite updates can be merged.
