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
  Tone Rules and plot focus on or off, send the next beat you queued (Plot tab) and, with a Pura
  engine, pick Pura's scene randomisers (Dead Dove Escalation among them, two at most), without
  opening the VCRP window. A SillyTavern
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
- **Facts that hold** (10.0.0-vcrp.19; details under Story Memory below): a **Canon sheet** of
  this chat's never-changing facts, sent in the cached part of the prompt (Memory tab); a
  **continuity check** by the helper model, with a line under a reply that contradicts the sheet
  or the scene and a one-tap corrected swipe; chapters that know the **story's date and place**,
  and **bond milestones** kept as facts, both read from the blocks with no call; and the helper's
  **recall pick**, so an old chapter comes back when the scene returns to it in other words. Any
  engine. No preset re-import needed.
- **The blocks editor** (10.0.0-vcrp.22; `src/vcrp/blocksEditor.js`): the blocks under your latest
  reply are the state the next reply is handed, so a mistake in them is copied forward (someone
  still listed who left an hour ago, a number that jumped). The pencil on a reply's blocks card,
  or *Edit the blocks as they stand* in the BLOCKS tab, opens them for editing: each block in a
  box of its own (World State, Bonds, the sheets, the scene list, your custom blocks), one tap to
  **take a character out of the scene** (off the scene list, out of the World State's cast and
  noted off-screen there; their Bonds line stays) and a box to bring one in. Saving writes them
  under your latest reply, and the next prompt carries them. What opens is the blocks as they
  stand: a block the latest reply left out is shown from where it was last written whole, and
  when the latest reply wrote none, the ones before it. No model call. Megumin Suite keeps a
  state store with a journal for this; VCRP reads the chat, so the chat is where the edit goes.
- **A tidier settings window** (10.0.0-vcrp.22; layout only, nothing moved between tabs and no
  setting renamed): the tabs sit under three headings, after Megumin Suite's 1 Nov dock:
  **Story** (Presets & CoT, Writing Style, Toggles & Add-ons, Blocks, Notebook), **Long stories**
  (Memory, Knowledgebase, Focus, Plot) and **Helpers** (Helper, NPC Bank, Ban List, Story
  Director), with Model Setup first and Global Settings pinned last. On a phone the bar of pills
  starts with **All tabs**: every tab under its heading in one list, and the bar scrolls to the
  tab you open. On a desktop the rail fits a 768-pixel-high window and scrolls if it must, with
  Global Settings always in sight. Also: description text is small and muted in every panel (it
  was only styled inside a settings row, and came out as large white text everywhere else), a
  tab's badge drops under its title on a narrow screen instead of squeezing it, and a button
  with no variant named is no longer drawn as the browser's own white button.
- **The Plot tab** (10.0.0-vcrp.21; details under *The plot in your hands* below): **arcs** (a
  genre, a tone and a premise for the stretch of the story that starts now, written by you or
  picked from three pitches, with Story Memory closing the arc that ends), a **beat queue** (plot
  points lined up ahead, fired on a tap or after some replies) and a **thread ledger** (the open
  threads, seeds and timers the World State lists, with their real ages, and a reminder to the
  model when one has waited too long). Any engine. No preset re-import needed.
- **Characters that stay themselves** (10.0.0-vcrp.20; details under Focus below): **voice
  anchors**, each character's own earliest lines, sent for whoever is in the scene; a **drift
  meter** that counts how a character's latest lines differ from their earliest and decides
  when a drift audit runs; and audits whose **small corrections apply by themselves**, with Undo
  in the Focus tab. Read from the speaker names Dialogue Colors puts on the dialogue: no call
  of its own. Any engine. No preset re-import needed.
- **Tense** in Story Config: present or past. Left on default it sends nothing and each engine
  keeps its own (Megumin's Story Config has no tense, so the Megumin Original engines only get one
  if you pick it).
- User Consent block without the slur in its example list; Megumin's feedback form and donation
  details removed from the About card (it links to the original project instead).
- **Trimmed:** Side Panel, Image Generation (ComfyUI, incl. NPC portrait generation and NPC image
  tags), the Persona tab, the legacy V4–V9 engines and their CoTs, the Co-writer engines, and the
  Death, Combat, Direct Language, Dice, MVU and Organic NPCs & Events add-ons, and the V9 Lean/Full
  word limits. Since 10.0.0-vcrp.9, after a sweep of every feature on every engine: the writing
  styles written for the V7–V9 engines and the five generic ones (the four of the engines VCRP
  ships remain), the "Gemini Thinking Override" (three `<think>` lines, from the Gemini 2 era),
  V11 Тайна Preview (the first V11 engine, with its thinking) and the V11 Тайна DeepSeek pair.
  Saved settings that used any of them are cleaned up or moved to the V10 or V11 equivalent
  automatically (a profile on a removed style takes its engine's own style).

## What's included

- **Engines:** V10 Ukiyo and V10 Shura (with Enhanced Dialogue), their CoTs and Thinking Cap variants,
  plus their **Megumin Original** versions, Megumin Suite V11's **V11 Тайна** and its **Writers'
  Room** (each with its thinking and a Thinking Cap) with V11's Author's Notebook, **Adapted**
  versions of both (VCRP's writing rules on V11), and the two **Pura Director** engines (below).
- **Presets:** VCRP V10 Universal, VCRP V10 Megumin Original, VCRP V11 Megumin Original.
- **Tabs:** Model Setup; under *Story*: Presets & CoT (with Story Config), Writing Style (+ Anime
  Mode), Global Toggles & Add-ons, Blocks, Notebook; under *Long stories*: Memory (Story Memory),
  Knowledgebase, Focus, Plot; under *Helpers*: Helper, NPCs Bank, Dynamic Ban List, Story
  Director; Global Settings; plus Dev Mode.
- **Add-ons:** Bold NPCs, Immersive HTML, Dialogue Colors, Dialogue & Narration tags, Gemini JB
  (Megumin Suite V11's, for Gemini's content filter).

## Install

1. SillyTavern → Extensions → Install Extension → `https://github.com/MeowsKun/vcrp-preset`
   (branch `v10-fork` while in development).
2. Import `Presets/VCRP V10 Universal.json` in the AI Response Configuration panel and select it.
   Everything that changes from turn to turn sits after the chat history, so providers that
   discount cached input (Claude, Gemini, DeepSeek) can reuse the rest of the prompt.
3. Extensions → Regex: make sure the preset's regex scripts are enabled.
4. Open VCRP with the wand button, pick an engine in **PRESETS & COT**, and play.

## Long chats: Story Memory (Claude, Gemini and others)

Story Memory (the **Memory** tab) sizes every request to a dollar target ($0.20 a reply by
default), however long the chat runs. While you play nothing is dropped, so every turn reads the
prompt from cache. After a break the cache has expired anyway, and that is when older messages
leave the prompt in one cut, covered by chapters (one-line gists plus full text, recalled when the
scene touches them) and a fact ledger. A cut always lands where a chapter ends, so every message
it hides is told by a chapter in the memory text. Messages you hide yourself (SillyTavern's
`/hide`) are not taken for a rewind: the chapters that cover them stay, and a chapter whose
messages are all hidden has its line in the memory text from the next request on. (You no longer
need to hide old messages to keep the prompt small: the cut does that.) Summaries are read however the model dresses
them up (Gemini's bold labels, numbered fact lines, "**OK**").

**Chapters approve themselves when their check passes.** Every chapter is checked against the
messages it covers by a second call. One the check finds accurate is approved as written, so the
prompt can be cut without waiting for you. One the check had to correct or could not read, or one
that changes a pinned fact, waits for your review in the Memory tab, and so do the chapters
behind it (they follow on from one another); approving it lets the accurate ones behind it follow
by themselves. A chat that came with such chapters already waiting (written before this, each
passed by its check) has them approved after its next reply, and a note says how many. While
reviews wait, nothing past them can be cut, and the Memory tab says what
that costs on each request after a break. Switches: *Review chapters before they count*, and
*Approve accurate chapters by themselves* (both on by default). **Summarize now** works through
everything not yet summarized in one run, however much there is: a one-off catch-up on a long
chat in progress may cost a couple of dollars, and nothing limits it.

It needs the model's price: Claude's is built in; for any other model (Gemini, DeepSeek, GLM)
enter it under Custom price in the Memory tab, once per model. Without a price nothing is
summarized or cut.

**On Gemini** (OpenRouter, e.g. Gemini 4 Argon: $2 in, $10 out, $0.10 cached, per million):
Gemini caches a repeated prompt start by itself, for about 3 to 5 minutes, with nothing to set
up. OpenRouter folds every system message into Gemini's one system instruction, so VCRP sends
everything after the chat as user messages and the instruction stays the same from turn to turn
(without that, nearly nothing was cached). Story Memory counts Gemini's cache as 5 minutes, with
no write surcharge, and never lets the prompt grow past what a full-price request can afford, so
a reply after any pause stays within the target. In a simulated session about 90% of each
prompt is read from the cache. Pin OpenRouter's provider to Google AI Studio (the price you
entered; other providers cost more and keep their own caches).

On Claude it relies on prompt caching you set up once:

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
about 2,000 tokens: Story length 450–550 words, Thinking length 250 words, a cap of 2,000. On a
model that reasons before it writes (Gemini, DeepSeek, GLM; Claude with a reasoning effort set)
that reasoning is paid for in the request's output limit without being part of the reply, so
there the cap stands for the reply you see: the request's limit is the cap plus room for the
reasoning (half again the most this chat's recent replies used, by the API's own count, and
never less than 6,000). A request limited to the cap itself was used up by the reasoning on
a hard turn, and the reply came back with nothing in it. A reply can run a little over the cap
when the model reasons less than the room it was given; Setup Check shows the number.

**The target is a goal; the ceiling is the one hard stop** (Memory → Reply length and cost):
- **The target** ($0.20 a reply by default) sizes the prompt a break leaves, and nothing else. A
  reply that comes to more than it, $0.25 say, is never cut off, shortened or stopped for it.
  (Until 10.0.0-vcrp.18 *Hold each reply to the target* made what was left of the target the
  request's limit. It is gone.)
- **The ceiling** ($0.50 by default; 0 = none): no regular reply's request can cost more. Each
  reply's prompt is priced as it goes out (read from the cache, written to it, sent fresh), and
  what the ceiling leaves after it, in output tokens, is the request's limit. That is usually far
  more than SillyTavern's own Max Response Length, which then stands. When the room is tight the
  model is told it, with the story's share in words.
- **A prompt that leaves no room for a usual reply under the ceiling is not sent.** Sending it
  would pay for most of the ceiling and get a reply cut short (or, on a model that reasons out of
  sight, nothing at all). A note gives the numbers and the way forward: Summarize now and Cut
  now in the Memory tab, the chapters waiting for review, or a higher ceiling.
- **The safety cap**, when lower, still wins, with its room for reasoning out of sight (above).
- **Background calls are never limited:** a summary or its check, an audit, the Story Director,
  an NPC scan or update, the ban list, the call for missing blocks, another extension's request.
  The 8,000-token limit VCRP used to put on its own is gone.
- **It needs the model's price** (Story Memory itself may be off). Without one no reply is limited
  by cost, and Setup Check says so. Setup Check also warns when SillyTavern's Max Response Length
  is under 8,000 on a model that reasons out of sight.
- **What a reply really cost** (`src/vcrp/replyCost.js`): the badge by each reply prices the
  prompt from the API's own token counts when the answer carried them (what was read from the
  cache, written to it, sent fresh) as well as the output with its reasoning, and then shows the
  figure without its "≈": green when most of the prompt came from the cache, amber when it did
  not. The panel reads the whole chat back: the average a reply, how many came to more than the
  target, how often the cache helped, how much of the output is reasoning you never see, and
  **Copy cost report** for the same lines as text.
- **How each reply ended** (`src/vcrp/generationTrace.js`): VCRP reads the answer to each of
  SillyTavern's chat-completion requests as it passes (a copy of the response, read alongside;
  the request and what SillyTavern reads are untouched) and stamps the reply with the provider's
  stop reason (OpenRouter's native one, such as Gemini's `MAX_TOKENS` or `PROHIBITED_CONTENT`,
  and OpenRouter's own word beside it), the output as billed, reasoning counted, and the limit
  the request went out with and what set it. The answer is read as it arrives, so the stamp also
  says how long the reply took and when its first text or reasoning came, how much of what
  arrived was reply text and how much reasoning, and how the stream itself ended: with its end
  marker, closed with none, stopped on this side, or broken. (SillyTavern's server prints nothing
  of a streamed answer, only "Streaming request in progress" and "finished".) From it, the
  blank-reply note says what really happened, a cut is known for certain rather than guessed from
  the reply's size, the cost badge and Story Memory count the output as billed, and Setup Check
  lists how the last five replies ended.
- **A block a reply leaves out, or is cut off in,** is carried to the next reply from where it was
  last written whole (World State, Bonds, Character Sheet, Story Tracker), and the model is asked
  to write it in full again, so one bad reply doesn't drop it from every reply after.
- **Missing blocks are asked for again** (`src/vcrp/blockRepair.js`): a reply that arrives without
  its blocks, or stops inside them, or lacks a block it had to write (every block in the stack that
  is written each turn; Pura's state-carrying trackers and the Notebook's updates are optional),
  gets a quiet second call on the roleplay prompt as it stands: the reply in the history, the cache
  warm from the request that wrote it, the block instructions the last thing read, no thinking and
  no prefill. The `<Blocks>` it answers with is merged into the reply (an envelope that was whole but
  short of a block keeps its own extras), the reply is saved and redrawn, and the NPC capture and
  the Story Director's tracker read it again. Once per reply, never for a blank one, after the other
  handlers; the switch is in the BLOCKS tab (*Ask again for missing blocks*, on by default).
- **A reply SillyTavern's Reasoning Auto-Parse swallowed is put back** (`src/vcrp/replyRescue.js`).
  With Auto-Parse on (Advanced Formatting → Reasoning), SillyTavern moves a streamed reply that
  opens with its template's prefix into the Thinking box until it meets the template's suffix to
  the letter (in the DeepSeek template: a line break, then `</think>`). A reply that closes its
  thinking any other way (`...done.</think>` on one line, `</thinking>`, a space or a `^` before
  the tag), or never closes it, stayed there whole, story and all, and the message came back
  empty: nothing failed, nothing was filtered, and the terminal shows a stream that finished. As
  the reply arrives, before anything else reads it, VCRP looks again: closed another way, the
  story goes back into the message and the thinking stays in its box; never closed, the text goes
  back into the message as it came. A reply that closed its thinking and wrote nothing after is
  told from one that never closed it by what the model itself sent, and left alone. Setup Check
  says when Auto-Parse is on beside Chain of Thought, and counts the replies put back. (Found by
  running a real SillyTavern against a scripted provider; without Auto-Parse the preset's own
  regex draws the thinking box and takes any of those closings.)
- **A blank reply is told apart** (`src/vcrp/blankReply.js`): nothing at all, stopped inside its
  thinking, all thinking with no story, a model that reasoned and never wrote, or only blocks. A
  toast says which and what to do, from the answer itself when it was read (the output limit,
  named with what set it; a stream that closed, or a connection that broke, before the model had
  finished; the reader's own Stop; an error; a content-policy stop) and from the reply's shape
  otherwise.
  **A content-policy stop named in the API's answer is the provider's decision:** VCRP says so, in
  the API's own words (OpenRouter's `finish_reason` and the provider's own word), and leaves the
  request as it was. It does not send it again, and nothing in a later request changes because a
  reply came back empty. Only a word that names a content-policy stop is called one: Gemini's
  `OTHER` ("unknown reason" in Google's own reference) is said as no reason given, a broken tool
  call (`MALFORMED_FUNCTION_CALL`) as the model's slip.
  **A reply that nothing explains** (the model ended its turn with nothing written and no reason,
  reasoned and never wrote, slipped into a tool call, the stream closed before it had finished,
  or the answer could not be read) **is sent once more, as it was:** SillyTavern's own Auto-swipe
  passes an empty reply on purpose (so a broken API cannot loop it), so VCRP swipes once a
  moment after the reply lands, with SillyTavern's own auto-swipe call (the plain right swipe or
  the swipe button on a SillyTavern without it; when it cannot, it says so). Never a second time
  for one message, never for a reply a limit stopped (the same limit would stop it again), never
  for one the provider ended without a reason, never for one the reader stopped; off in Global
  Settings.
  **A stream that goes quiet is said** (`src/vcrp/streamStall.js`). SillyTavern's server does not
  notice a provider connection that drops mid-reply: it neither ends the reply nor reports an
  error (its terminal shows "Streaming request in progress" and never "finished"), and the page
  waits with an empty message until Stop is pressed. When nothing has arrived for 90 seconds on
  OpenRouter (four minutes elsewhere, where a model may reason in silence), a notice says so and
  stays until data comes again; a tap stops the reply and sends the same request again.
  **How a reply ended stays under the reply** (`src/vcrp/finishNote.js`): a reply that did not
  end normally carries a small line ("No reply: the output limit was used up before the story",
  "No reply: the model reasoned and wrote nothing", "No reply: the stream closed before the model
  had finished", "No reply: the API's answer names a content-policy stop (PROHIBITED_CONTENT)",
  "Cut short by the output limit"); tap it for the stop reason as the API gave it, who served the
  request, what was written and read, the limit and what set it, how long it took and how much of
  what arrived was reply text. A reply that ended on its own with its story has none.
  **Setup Check reads the open chat's empty replies back** from the stamps saved with them: by
  cause, with the provider that served each (OpenRouter names it) and the generation's id; *Copy
  empty-reply details* on the card copies the setup and one line per empty reply as text. Such a
  reply is not measured as a reply (it would shrink the room every reply is given), the one-shot
  direction stays for the swipe, no rolls note is added to it and no blocks are asked for.
- **VCRP's own background calls** (summaries and their checks, audits, the Story Director, NPC
  scans and updates, the ban list, style generators) carry no limit of VCRP's since
  10.0.0-vcrp.18: only a regular reply is limited (above). One that never answers is still given
  up on after six minutes. Other extensions' calls are left alone.
- **A background job's prompt is its own, and only its own** (`src/core/activeRequests.js`,
  `TASK_MARKERS`): each job sends its marker as its quiet prompt, SillyTavern puts that text in
  the prompt it builds for the job, and VCRP swaps a job's prompt in only for the prompt that
  carries its marker. A reply sent while a job is still running (or after one hung) carries none
  and stays a story prompt; a Story Memory call's prompt is told the same way, by the instruction
  it carries. A background call that never answers is given up on after six minutes
  (`src/st.js`): it fails like any other, and nothing it was holding stays held.

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
message where the prompt first changed and shows the text before and after. It reports on your
last reply's request, and keeps that finding when a background call (a summary, a check) goes out
after it (10.0.0-vcrp.23; before, the background call's own comparison took its place within
seconds). A line you add to or take off the Canon sheet is said as what it is, not as a fault:
the sheet sits in the cached part on purpose, so the request after a change is written in full
once, and the one after that reads from the cache again.

### Facts that hold: the Canon sheet, the continuity check, story dates, the helper's recall pick

Four things that keep a long story true to itself (10.0.0-vcrp.19). None of them can cut a reply
off or hold one back: the two that call a model ask the helper, and those are background calls,
outside the ceiling like every other.

- **The Canon sheet** (Memory tab, with Story Memory on or off; `src/vcrp/canon.js`): this chat's
  facts that never change, a line each: who people are to one another, what the world allows,
  what was promised. You write them, or take them from the offers under the sheet (Story
  Memory's pinned facts, then the ones that have stood longest unchanged, people and their ties
  first). A fact taken from there is pinned in the fact ledger too, so no summary rewords it
  without your review. Nothing is added by itself. The sheet is sent with every reply in the
  cached part of the prompt (the always-on Knowledgebase slot, before the chat), under a line
  that says nothing in a reply contradicts these facts and that they outrank anything else
  remembered of the story. After the first request a line costs a fraction of its price; a change
  to the sheet is paid for once, when the next request writes its prompt in full. A preset from
  before that slot gets the sheet after the chat, at full price every turn, and the panel says
  so. Kept with the chat. Past 30 lines the panel says the sheet is getting long: the more lines
  there are, the less each one weighs.
- **The continuity check** (`src/vcrp/continuity.js`; Helper tab → *Continuity check*, on while
  the helper is on): as each reply lands, the helper reads it against the Canon sheet and the
  scene as it stood before the reply (the last World State). It is told to report only what
  cannot both be true: a change the reply itself shows happening is not a contradiction, and
  neither is something the facts do not mention. A reply it finds one in gets a line under it.
  A tap shows the quote and the fact, with **Swipe with the correction** (the facts go to that
  one swipe as its direction, beside any direction or beat the reply was written with; whatever
  waits in VCRP Quick's *Next reply only* box stays there for your next message), **It is fine**
  (takes the line away) and Close. The check runs after the reply is on screen and holds nothing
  up, and it reads the story only: the reply's blocks may be written while it waits its turn (the
  helper does one job at a time) and its finding stands. One that fails says nothing; with an empty sheet and no World State before the reply there
  is nothing to read against, and nothing is asked. It costs a few thousand tokens in and a line
  or two out on every reply, which is why only the helper does it: without a helper no check
  runs, and the story model is never asked by itself. The helper can be wrong, and the dialog
  says so.
- **Story dates and bond milestones** (`src/vcrp/storyTime.js`), read from the blocks the story
  already writes, with no model call: each chapter keeps where the story's clock and place stood
  as it ended (the World State's Time and Loc), so the memory text lists its chapters as a
  timeline (`- [Day 3, noon · The harbor] The vault.`) and a recalled chapter says when it was.
  When a Bonds meter crosses a quarter, half or three quarters of its scale over a chapter, up
  or down, that is kept as a fact in the ledger: "Mara's Affection toward Bob rose past 50% (31
  to 55 of 100), Day 3, noon · The harbor. Earlier: rose past 25%, Day 2, morning · The
  Lantern." One fact per character and meter, the latest crossing first, taken back out with
  its chapter if a rewind deletes it. Chapters written before this release carry no date, and a
  chat without those blocks gets neither.
- **The helper's recall pick** (`src/vcrp/memory/smartRecall.js`; Helper tab → *Recall picks*):
  Story Memory brings an old chapter back when the scene shares rare words with it, so a scene
  that returned to something in other words ("the thing you promised my sister", for a chapter
  about Mara and the ring) found nothing. With a helper on a connection profile of its own, the
  helper is shown the old chapters' one-line gists, with their dates, beside the newest messages
  before each reply, and names up to three the reply will need. Those come back first; matching
  words fills what room is left. The reply waits four seconds at most for the pick, the time the
  question spends behind the helper's other jobs included (the helper does one at a time, and a
  question still in line at four seconds is dropped, never sent). Late, missing or unusable, and
  matching words stands alone, as before. One question a turn: a swipe keeps the pick it was
  given. It needs at least two chapters outside the prompt. The Memory tab's recall line says
  which chapters the helper picked.

## Keeping long stories on track: Focus

The **Focus** tab has four tools, each with its own switches.

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

**Voices** (10.0.0-vcrp.20; `src/vcrp/voice.js`; on by default, no call of its own): the card
says who a character is; it does not say how this story has been writing them. Their own lines
do. Dialogue Colors puts the speaker's name on every spoken line, so the chat already holds each
character's lines in order, and VCRP reads them there.

- **Voice anchors:** each character's earliest lines of some length (five to forty words; four
  kept, two sent), in their own words. For the characters in the scene (the scene list; without
  one, whoever spoke in the last three replies; four at most) they go with each reply in
  `[[focus]]`, after the chat, never cached: about 30 tokens a line. A line is sent once it lies
  16 messages back; nearer than that the model can still see it. In the tab you can write a
  character's lines yourself (sent at once, first), hide a line (the next of their early lines
  takes its place) or leave a character out. Never for an Impersonate. Replies you have hidden
  since (SillyTavern's `/hide`) are read too: in a long chat the hidden part is where a
  character's first lines are.
- **The drift meter:** a character's latest 30 lines counted against their earliest 30: how long
  the lines run, contractions, questions and exclamations, trailing off, reassuring and harsh
  words, and the words they open and close a line on. Each measure is weighed against how much
  that character's own lines differ among themselves (Welch's t), and counts only past what
  chance explains, so someone whose lines always varied needs a large change to register. It
  reads 0 to 100: steady, shifting from 35, drifting from 55. It needs 40 named lines for a
  character. It counts and does not read, so it cannot tell a character who has grown from one
  who has worn down: it decides nothing by itself, only when the audit looks (below).
  Measured on real chats with `tools/voice_calibrate.mjs` (numbers only, no text): the same
  lines split at random read "drifting" about once in a hundred times, one speaker's lines
  against another's four times in five, and a speaker's earliest lines against their latest a
  third of the time. Two stretches side by side early in a story read it one time in seven: a
  scene unlike the one before it is a change too, which is one more reason the meter only
  calls the audit and the audit decides.
- **"This is their voice now":** when the story has changed a character for good, their first
  lines would pull them back. One tap takes that character's voice from their last dozen lines
  on, for their anchors and for the meter, which reads them again once they have spoken forty
  lines since. *Back to their first lines* undoes it.
- **Without names on the lines** (Dialogue Colors off, or a model that leaves the names out)
  there is nothing to read, and both stay quiet; a line you write yourself still goes out. A
  line with a color and no name is its speaker's when exactly one character has that color
  (replies from before the add-on asked for names).

**Drift audits:** long roleplays drift: characters lose their edges and start to sound alike,
the same smirk or scent comes back every reply, stock phrasing piles up. An audit reads the
latest replies and writes the writer a short correction.

- **When it runs:** every few replies (20 by default). While the drift meter has someone to
  read, the meter decides instead: an audit runs when a character newly reads as drifting (never
  within 10 replies of the last one), and otherwise half as often (every 40), because repeated
  motifs and slop are not the meter's to find. A character an audit has already looked at does
  not call the next one by the same reading, so someone the story changed for good does not call
  an audit every few replies. The tab says which it is and when the next one is due. Switch:
  Focus → Voices → *The drift meter decides when to audit*. A swipe, a regenerate or a Continue
  of the reply an audit ended on calls no second audit: the reply counts as read.

- **What it checks** (each can be switched off): character drift against the character card and
  how they have been written, repeated motifs (images, gestures, metaphors, scene endings), and slop.
  While a plot focus is on, plot drift; while the chat's Tone Rules are on, tone drift (the replies
  softening or straying from the rules).
- **What it reads:** the replies since the last audit and your messages between them, the card,
  and the list of what earlier audits flagged. Each audit says which of those came back, so a
  motif that survives a correction is counted and named more firmly the next time. For character
  drift it also reads how each character first spoke (their voice anchors) and what the meter
  counted since, marked as a pointer and not a finding.
- **Small corrections apply by themselves** (on by default): a correction about how the story
  is written (character drift, repeated motifs, slop), no longer than an audit is asked to
  write, goes into the prompt as the audit lands. The tab shows it under *Applied by itself*
  with what it found: **Undo** puts the prompt's correction and the flagged list back as they
  were and leaves the audit waiting for your review; **Keep it** dismisses the card. One level
  of Undo, for the last audit that applied itself.
- **What still waits for you:** a correction about where the story goes (a finding about your
  plot focus or your Tone Rules, new or come back), a long one, and every audit with the switch
  off. Its findings and correction wait in the Focus tab: edit the correction if you like, then
  **Approve and use**, or **Discard**. Automatic audits hold while one waits.
- **Where it goes:** the correction in use rides with every reply in the per-turn rules
  (`[[focus]]` in Output RULES, both presets), after the chat history, so it never touches the
  cache. It stays until the next correction replaces it; edit or remove it in the tab. An
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
  It is a background call, so no ceiling applies to it. With the meter deciding, a story whose
  characters hold steady pays for half as many. Two failed audits in a row pause the automatic
  ones until an **Audit now** works.

## The plot in your hands: arcs, beats, open ends

The **Plot** tab (10.0.0-vcrp.21) is for steering where a long story goes without writing it
yourself. Three tools; everything in them is kept with the chat.

**Arc** (`src/vcrp/arc.js`): a long story is not one story. The heist ends, and what follows is
a slow romance, or a haunting. An arc is you saying so: a name, a genre, a tone and a premise for
the stretch that starts now.

- **In the prompt:** while an arc runs, it goes with every reply as the last thing the model
  reads (`[[plotfocus]]`, after your newest message, outside the cache; a few dozen tokens): its
  name, genre, tone and premise, and that everything established carries over unchanged. The
  plot focus, when on, follows it: the arc is what the story is about, the plot focus one thing
  to revolve around inside it. An Impersonate goes without. The Story Director, when you use
  it, is told the arc and plans within it.
- **Starting one:** write the premise yourself, or press **Pitch three arcs**: one background
  call that reads the story as the Story Director would (the story memory and the latest
  messages, or its usual window without Story Memory), the Canon sheet, the open threads, the
  cast and the arc now ending, with your genre, tone and wish, and proposes three arcs that
  each grow out of something already in the story. It is priced beside the button; like every
  background call it carries no ceiling, and it goes to the helper when the Story Director's
  job does. *Start this arc* takes a pitch as it is; *Edit first* puts it in the boxes.
- **Its opening move:** a pitch comes with the first thing that happens (yours can too). It is
  queued as a beat and goes with your next message, in the *Next reply only* box, where you can
  still change it or take it out.
- **Story Memory closes the arc that ends** (the tick under the form, on by default when there
  are chapters to fold): its chapters fold into one entry under the arc's name (one short call
  that reads their one-line gists, never the chat), so the memory text reads arc by arc. The
  chapters stay and are recalled as before; a pinned chapter keeps its own line. Messages not
  summarized yet join the new arc's first chapter. A failure changes nothing and never pauses
  the automatic summaries.
- Starting an arc ends the one running; **End this arc** ends it without another. Earlier
  arcs are listed.

**Beats** (`src/vcrp/beats.js`): plot points you line up ahead of time ("The landlord finds the
letter.").

- A beat goes out the way a one-shot direction does, and in fact as one: firing it puts its
  text in VCRP Quick's *Next reply only* box. It rides with one reply, after your message, is
  never written into the chat, and stays with that reply for a swipe.
- It fires **on a tap** (in the tab, or *Send it next* in VCRP Quick, which shows the next beat
  waiting), or **by itself** after the number of replies you gave it. A toast says when one
  goes into the box by itself. The count goes by every reply the story has had, hidden ones
  included, so hiding old messages does not push a beat off.
- One at a time: while the box holds something (your own direction, another beat), a beat
  waits and goes when the box is free. A beat you write over in the box is not spent: it goes
  back to waiting for a tap. A blank reply spends nothing.
- Reorder, reword, remove; fired beats are listed with *Queue again*.

**Open ends** (`src/vcrp/threads.js`): the World State block lists the story's Unresolved
Threads, Planted Seeds and Consequence Timers on every reply, and the model that keeps the list
is a poor bookkeeper: a thread sits unmoved for fifty replies, a timer's "2 turns" stays 2
turns, an open end leaves the list without ever being settled.

- **VCRP keeps the book.** It reads every reply's World State in order, with no call of its
  own: when each line first appeared, when its wording last changed (a count ticking up is not
  a change), when a timer falls due by its own count, when a line left the list. Two lines are
  the same open end by the words that carry them, so a rewording does not start a new count: a
  near copy first, then, for what is left, a line that shares at least two of its words with one
  from the reply before (models rewrite their list as the scene moves; measured on real replies).
  Two lines that share only a name are two open ends.
  Read from the chat each time, so a rewind or a deleted message is simply read again. Replies
  you have hidden since (SillyTavern's `/hide`) are read too: they are the story's past, and a
  thread's age counts from where it really first appeared.
- **The tab shows them with their real ages**, and the ones that left the list (settled, or
  dropped: the list cannot say which). *Make it a beat* queues a beat that brings an open end
  forward; *Pick it back up* does the same for one that was dropped.
- **Reminders** (on by default): a thread unmoved for 20 replies, a seed unpaid for 30 and a
  timer past its count are named to the model with one reply, then every 8 replies while they
  wait, two at a time at most, with a line to bring one forward if the scene gives an opening
  or settle it, and not to open something new in its place. They ride in `[[focus]]`, after the
  chat (never cached; about 60 tokens on the replies they go out). Which reply names what is
  decided by the reply's number alone, so a swipe gets the same reminder. *Never remind* sets
  one open end aside.
- **What it needs:** the World State block with those lines. The compact World State leaves
  them out on most replies (the ledger waits for the full ones, and sends no reminder from a
  list more than 8 replies old); with the Author's Notebook on, the seeds are the notebook's
  unless you keep them in the World State.

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
commit `6ce507f`, its 04/11 update; generated by the same `node tools/gen_megumin.mjs`, which reads
it through a `megumin-beta` git remote). V11 left the V10 engines and their texts as they were, so
the V10 Megumin Originals above are unchanged. VCRP ships two of V11's four engines: the first V11
engine (now "V11 Тайна Preview" upstream) and the DeepSeek version were dropped in 10.0.0-vcrp.9.

- **The engines** (Megumin Originals, each keeping the Author's Notebook):
  - **V11 Тайна**: one storyteller writes the whole turn, plainly and with a voice of its own. The
    base for every model. Picks **CoT V11 Тайна**; for models that over-think (GLM, Kimi, DeepSeek,
    Qwen), pick its **Thinking Cap**: five short lines of notes, no draft, no word count, and its
    rules said again as the last thing the model reads (after your message, never cached). As in
    Megumin Suite V11, no Thinking Cap (V10's included) is given the Thinking Effort word count.
  - **V11 Тайна · Writers' Room**: the same story, worked by a room of five in the thinking. Picks
    **CoT V11 Тайна · Writers' Room**, with a Thinking Cap of its own too.
  - A reply that leaves the blocks out (DeepSeek and Gemini do now and then) gets them asked for
    in a second call (below, under Blocks), and each block is carried from where it was last
    written whole, on every engine.
- **The styles**: **V11 Default** (an overt narrator with a voice and opinions) and **V11 Inside**
  (the narration rides inside one character at a time, never yours). Picking a V11 engine picks V11
  Default unless V11 Inside is already in use; switching between the V11 engines keeps it.
- **The preset** `Presets/VCRP V11 Megumin Original.json`, on VCRP's frame with V11's layout. V11
  keeps its words in the extension now and its preset is only slots: its rules up top (cached) and
  what changes each turn after the chat. Since V11's 01/11 update the per-turn rules come **after
  your newest message**, as one user message that ends on V11's line "Start your turn.", so the
  block instructions are among the last things the model reads (V11's answer to models that skip
  the blocks); `</history>` closes the chat before them. V11's Content rule and Story settings sit
  before the history, in the cached part (a Story Config change costs one cache miss, like a style
  change). V11's USER note is sent, and its **USER Hard** prompt is carried switched off, for a
  model that answers an adult scene with nothing (Gemini's content filter): turn it on in AI
  Response Configuration's prompt list. VCRP builds the sections the way V11 does, from V11's words
  (`src/engine/meguminV11.js`): each engine's Content section, Story settings (with V11 Тайна's
  `<repetition>` rule), the thinking, the formatting, V11's ban list (V11 Тайна's own on its engines,
  your phrases under it) and the numbered final check. V11 Тайна and its versions take V11's tagged
  wording (`<story_settings>`, `<formatting>`, `<final_check>`, "Write the response in English."),
  the V10 Megumin Originals, on this preset, the older headings. Story Config reads in V11's wording on every V11 engine (its point
  of view is the person only; whose head the narration follows is V11 Inside's). Only tags change
  from V11's preset: removed features out (dice, images, MVU), VCRP's in. The NPC list, the NPC
  dossier rules and the Story Director's plan ride after the chat, as in VCRP's own preset, because
  in VCRP they change turn to turn and would break the cache in the cached part. V11's Current Info
  and This Turn are VCRP's `[[blocks]]`, which carry the kept state the same way. **Re-import it**
  after updating: Setup Check names the old one. Your V10 presets need no re-import.
- **One preset for every engine but the V10 Megumin Originals.** The Pura Director engines and
  VCRP's own V10 Ukiyo and Shura run on the V11 preset too, with VCRP's rules: the ban list (dash
  rule included), formatting rules and final reminder, word for word as VCRP V10 Universal has them
  (read from its layout, `data/skeleton.js`). Switch engines without switching presets; only the V10
  Megumin Originals still want VCRP V10 Megumin Original.
- **V11 Тайна · Adapted**, and an Adapted version of its Writers' Room: V11 run
  as a VCRP engine, the way Pura Director · Adapted is Pura's (`data/modes/v11Adapted.js`). V11's
  engine text, thinking, Author's Notebook and turn frame stay as they are; VCRP's modules take over
  the writing rules: VCRP's ban list in V11's `<banlist>` (dash rule, stripped articles, pattern
  descriptions, stock phrases), VCRP's dash line in V11's final check, the dash cleaner, and VCRP's
  own wording of the writing styles, add-ons, Story Config and Story Director. V11's story settings
  already win over its text; a writing style other than V11's own gets a lead-in of its own and wins
  over V11's narration section too. They are built from the Megumin Originals as they load, so a new
  V11 release carries over (a lead-in gone from V11's text fails the tests). The Originals stay word
  for word.
- **The {{user}} rule** is V11's wording on VCRP's engines and on V11 ("the response does not
  speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for"), the last
  line of each preset's final list (3 in VCRP's, 5 in V11's), and left out on Impersonate.
- **Gemini JB** (V11's 04/11 add-on; Global Toggles & Add-ons; Megumin's Gemini loadouts turn it
  on): for Gemini's content filter in gritty and heavy NSFW scenes, so the reply is not cut off.
  V11's two lines, word for word: one that says the request complies with the adult fiction
  policy, at the end of the last message (`[[GeminiJB]]`, a spot all three VCRP presets carry
  since 10.0.0-vcrp.10), and one that asks for a `^` before every word of the reply, last in the
  formatting section (the V10 presets have no formatting slot, so there it rides with the first
  line). VCRP takes the `^` out of each reply as it arrives, before the blocks, the captures and
  Story Memory read it (the reply's cost is measured first, with them), and out of an edited
  reply; the presets' new "clean up" regex hides them while the reply streams, and strips them
  from the prompt if VCRP is off. A story reply only: Impersonate, summaries and the second call
  for missing blocks are not asked for them (that call's answer is cleaned anyway). Each `^` is an
  output token, so it is for Gemini alone: Setup Check says when it is on for another model, when
  Gemini runs without it, and when the preset you have is from before it (re-import). Not for NSFL.
- **The final check asks for the blocks** (V11's 04/11): on a turn that asks for a `<Blocks>`
  section, the numbered final check gets "The response ends with the <Blocks> section." after the
  ban list's check, on every engine on the V11 preset (VCRP's own reminder has it before its
  {{user}} rule), and in the second call for missing blocks. A turn without blocks has no line.
- **Group chats save** (V11's 04/11 fix): a repaired reply, a cleaned one, a chat with its dashes
  cleaned, everything VCRP saves to a chat, used to be refused by SillyTavern in a group chat.
- **Custom blocks, as V11 has them** (V11's 04/11; BLOCKS tab, *Create custom block* or the pen on
  one), on VCRP's own carry instead of V11's state store (`src/vcrp/customBlocks.js`):
  - **Fields or free text.** A field block is built like the Character Sheet: meters, numbers,
    text and lists, each with a box for what it means and how it changes, in your words; the
    story reads those lines in the block's rules. It is drawn like the Sheet (bars, chips).
  - **Rules for the whole block**, one line each as written, before the field notes. Meters are
    not held to 10 points a reply here; write your own limit if you want one.
  - **What the story remembers of it:** *Carried forward* (its last copy travels with the block
    instructions after the chat, as every block's does, from up to sixty replies back), *Starts
    fresh* (the story never sees the last one), or *Stays in the chat* (its copies stay in the
    earlier replies the story reads, at the end of each, while the other blocks come out; the
    same every turn, so the cache holds. The copies come from the chat itself, so they survive
    the preset's own Blocks cleanup regex, which takes the whole envelope out of every reply
    three deep before VCRP sees the prompt).
  - **When it is written:** every reply, only when something in it changes (V11's line, needs a
    block the story can see), or every few replies (not asked for until due, not asked for again
    by the missing-blocks call either, its last copy carried meanwhile).
  - **One list for every character.** A block made in one character shows under *Add a block*
    for all; each character keeps only which are in its block, their order and Shown / Hidden.
    *Delete block* in the editor removes it for everyone. A renamed block still reads (and
    carries) its copies written under the old tag. The editor shows the exact template the story
    gets, as you type.
  - Not carried over: V11's "edit the values by hand" and its Chomusuke-written blocks (both live
    in its state store).
- **Who is in the scene** (V11's 04/11 scene list; BLOCKS tab, on by default), on VCRP without
  V11's World State store (`src/vcrp/scene.js`, V11's own `src/state/scene.js` and
  `src/state/names.js` word for word):
  - The story writes `<Scene>` first in `<Blocks>` (V11's rules and lines): *Here*, the characters
    physically there, and *Remote*, those on a call or texting, `+` before someone new. Sent while
    World State, Bonds or NPC Inner Chatter is in the block; a reply without it is asked for it
    again like any missing block. The final check asks for the blocks "with `<Scene>` first".
  - **`<Known_Names>`** goes before the block instructions: every character on file once (the
    NPC Bank, the last blocks' World State and Bonds, the recent scene lists), written the
    shortest way that finds only them ("Lona", but "Matt Reyes" when a Matt Cole is around), the
    scene first. The story writes the same name in every block.
  - Who uses it: the **NPC Bank** sends the dossiers of everyone in the scene first, keyword or
    not; **Remember every character** brings back someone the list names whose records are not in
    the last blocks; **Existing cast only** counts them; the **Bonds** template asks for one line
    per character in `<Scene>`; VCRP's **World State** is told its cast follows the list (someone
    on a call goes under Off-Screen). A *Scene* tab on the card shows them as chips (✦ for someone
    new).
  - Costs about forty output tokens a reply plus the names list; switch it off in the BLOCKS tab.
    V11's store-side parts (people on a call shown apart in its World State, "walking out no
    longer fills Off-screen", "Same person as" joining bonds) are its World State's and are not
    in VCRP, whose World State is the text template.
- Story Memory, Focus, Tone Rules, the one-shot direction, Existing cast only, the length limit,
  Dialogue Colors, the NPC Bank and every block work with them as with every VCRP engine.
  `node tools/test_cache.mjs` plays V11 turns on the Writers' Room and on V11 Тайна and checks each one
  reads the last one's cached part back byte for byte.

### Author's Notebook

From Megumin Suite V11: the story keeps two or three hidden truths, plants small clues, and
reveals each one when the story earns it, instead of forgetting a secret or blurting it out.

- **On** by itself with V11 Тайна (its own text speaks of it); a switch in the **Notebook** tab for
  any other engine. The model writes the truths in a `<Notebook>` block, then only what changes in
  a `<Notebook_Update>` block (a clue planted, who found out, what came out).
- **VCRP keeps the rules** (V11's): as many live truths as you choose (**Truths kept at once** in
  the Notebook tab, 1 to 10, V11's three by default: the setup asks for that many, and each reply is
  read under the count in force when it was written, so lowering it later drops nothing), ids that
  are VCRP's (a truth you delete gives its number to the next new one, V11's 01/11 fix), a truth the
  model can never quietly rewrite, one clue per truth per reply, and a clue the reply never
  actually shows is marked "not found in the reply". A reason a model writes into "Hidden from"
  ("the reader, because it hasn't been shown") is left out of the names.
- **Kept in the replies.** Each turn the notebook is read back from the chat's own notebook
  blocks, so a swipe, an edit or a deleted message changes it exactly as it changed the story.
  Your own changes in the Notebook tab (edit a truth, mark it revealed, delete it, activate a past
  one again, add one) are kept with the chat.
- **The Notebook tab** (V11's, as its 04/11 beta has it): the live truths under *Active*, each
  hidden until you ask to see it (a popup warns that it spoils the story), then editable, every
  box saved as you leave it, with its clues listed by message number and removable one by one;
  *Mark revealed* moves a truth to *Past*, *Delete* frees its number. **Add a truth** adds an empty
  one to write yourself: it holds its number and is not given to the story, counted or allowed to
  skip the setup until its Truth box is filled in. *Past* is a timeline: when each truth was
  written, how and in which message it came out, what it was still hidden from, its clues;
  *Activate again* puts one back in the story. While the notebook is on, VCRP's World State is not
  asked for each character's *Secret* or for *Planted Seeds* (the notebook keeps the hidden
  things, as in V11), unless **Keep Secrets and Seeds in World State too** is on.
- **The cache:** its fixed rules sit in the cached part (V11's own `[[notebook]]` slot, or with
  the block rules); the live truths and the setup or update rules ride with the blocks, after the
  chat. The notebook blocks are taken out of the history, the summaries and the audits like every
  block, and are never carried as "the blocks as they stood".
- **No spoilers:** each reply's notebook changes are a tab on its card, blurred until you hover or
  tap a line; the Notebook tab keeps each live truth hidden until you ask for it.

### Characters on file

The blocks the model reads each turn are the last reply's, so a character who left the scene
dropped out of them. When your message or the last reply names someone who is not in those
blocks, their last World State entry and Bonds line are found in the chat (the part Story Memory
cut included) and sent with the block instructions, after the chat; nothing is sent otherwise.
Someone who walks out and comes back ninety messages later comes back as they left. On by default
(BLOCKS tab, under World State, or under Bonds without it). Pura's trackers already carry each
character's newest entry.

### The Helper: a second model for the blocks and the background jobs

Megumin Suite V11's Chomusuke, in VCRP's terms (`src/vcrp/helper/`): a second connection that
does the background work, so the story model writes only the story. One setup for every
character, in the **Helper** tab.

- **Its connection:** a SillyTavern connection profile (API Connections: connect the helper's
  model, save a profile, connect your story model again; the profile needs only the API and the
  model), or *Use my current connection*. **Test** sends one short question. Each job is sent
  straight to the profile through SillyTavern's connection manager
  (`ConnectionManagerRequestService.sendRequest`): your story connection never changes, nothing
  switches, the chat never reloads. A SillyTavern without that service runs the jobs on the story
  model, and Setup Check says so.
- **Blocks, after every reply** (on when the helper is on): the helper writes the scene list,
  World State, Bonds, the sheets and your custom blocks (one tick each), and VCRP puts its
  `<Blocks>` at the end of the reply, as if the story model had written it. The story model is not
  asked for those blocks: its block instructions keep only what is left to it (the Author's
  Notebook and Pura's state-carrying trackers always stay with it) and it reads where the blocks
  stood instead. Everything after works as before: the card, the carry to the next turn, the
  NPC capture, the strip from the history. Once per reply, a swipe being a reply of its own;
  never for the greeting or a blank reply; *Write the last reply's blocks again* does it over.
  The helper gets the same templates and rules the story model would have, the blocks as they
  stood, the last few messages and the latest exchange.
- **When the job runs:** NPC scans and updates, the Story Director, the ban list scan and the
  writing-style generator go to the helper by default; Story Memory summaries and Focus audits
  only if you switch them (a summary on the story model reads the stretch from its cache for a
  few cents; the helper reads it fresh, in a standalone call).
- **Two small questions only the helper is asked** (`src/vcrp/helper/aside.js`; both on while
  the helper is on, a tick each): the **Continuity check** after each reply and the **Recall
  pick** before one (above, under Story Memory). Each sends a short prompt of its own, a few
  thousand tokens in and a line out. They are worth that on a cheap second model and not on the
  story's, so without a helper they do not run at all; the recall pick also needs the helper on
  a connection profile of its own, because it is asked while the story's connection is busy
  with the reply. A job can be given a deadline counted from the moment it is asked for: the
  recall pick's is four seconds, and a question still waiting behind another job by then is
  dropped without being sent.
- **One job at a time.** A pill at the bottom of the screen shows a running job, with Stop; a
  reply you send while the helper still writes the last reply's blocks waits for it (at most 30
  seconds, with a line under the input), so the next prompt carries them. Leaving a chat stops
  its queued jobs. A job on the profile is handed its own way to send (a job that stays with the
  story model and runs at the same time keeps SillyTavern's), the prompt built for it is told
  which job it is for, and the reply it writes blocks for is read when the job runs, not when it
  was queued; if that reply changes while the helper writes (an edit, the second call for the
  story model's own blocks), it writes once more from the reply as it stands. A request to the
  profile that never answers is given up on after five minutes, and said.
- **When something goes wrong** it is said in plain words: a refused key, a rate limit, a
  provider outage, a model that is not there; an empty answer (a censored model refusing an
  NSFW story) once per chat; an answer in the wrong shape. The helper gets no jailbreak, so use
  an uncensored or less censored model (GLM 5.3 Flash, DeepSeek 4.1 Flash). Its calls are not
  counted in Story Memory's spend estimate.

### Model Setup

Megumin Suite V11's loadouts, in VCRP's terms (`src/vcrp/modelSetup/`), the first tab. Pick the
model you play with (Gemini Pro, Gemini Flash, Claude, Big open models, Fast models) and see the
settings tested for it: the engine (with its thinking and writing style), Chain of Thought and
its cap, the story length, Immersive HTML, Gemini JB, the CoT prefill, the Safety cap and the
helper. A loadout not in use shows its own settings as a preview (change any before using it);
the one in use shows the real settings, so a change there is a change in its tab. **Use this
loadout** lists what it would change before anything is written, for every character or this one
only; the prefill, the Safety cap and the helper are the same for every character either way.
Optional: skipping it, or playing a model that is not listed, breaks nothing.

### The NPC Bank knows a short name

V11's name finder (`src/state/names.js`, `whoIs`) in the bank (`src/features/npc/data.js`,
`npcLookup`): "Resha" for Resha Helios, a nickname, a name in brackets ("Dominic" for "Dom
(Dominic Morin)"), never a guess between two who fit ("Lady" for Lady Mira and Lady Resha picks
nobody) and never a surname alone. An `<NPC_Update>` by a short name applies; a dossier the story
writes for someone already on file fills that record's empty fields instead of making a second
one; the short name is kept as the character's nickname (shown on the card) and finds them ever
after, in the scene list too.

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

Both run on VCRP V10 Universal or on VCRP V11 Megumin Original, with VCRP's own ban list, formatting
rules and final reminder on either.

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
