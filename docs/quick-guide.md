# VCRP quick guide: the newest features

A short, hands-on tour of what was added recently. Everything here is in the extension itself:
update VCRP (Extensions → Manage extensions → update), reload SillyTavern, and it's there. No
preset re-import is needed. If the red dot on the VCRP button ever appears, open Global Settings →
Setup Check and it will tell you what to do.

---

## 1. VCRP Quick: your mid-scene switches

**Open it:** the magic-wand menu next to the chat box → **VCRP Quick**. A card opens at the bottom of the
screen. Close it with ✕, a tap outside, or the back gesture.

Everything in it belongs to the chat you have open.

- **Next reply only.** Type a steer for the very next reply: *"She finally tells him about the
  ring."* It goes to the model with your next message, is never written into the chat, and clears
  itself once the reply arrives. Swiping or continuing that reply keeps the same steer; your next
  new message starts clean.
- **Tone Rules.** Switches this chat's tone rules on or off (write them first, see section 2).
- **Existing cast only.** Turn it on for scenes that should stay with the characters already in
  the story. The model is told not to bring in anyone new and is reminded who is there (your
  character, you, and the NPC Bank). Twists that would bring in a stranger use someone you know
  instead. Turn it off when you want new faces again.
- **Plot focus.** Switches the plot focus on or off (write it in the Focus tab).
- **Pura's scene randomisers** (with a Pura Director engine): tick up to two, Dead Dove Escalation
  included. The Director's Cut must be ticked alone.

---

## 2. Tone Rules: set the mood of a chat

**Where:** Global Toggles & Add Ons → **Tone Rules (this chat)** (the same box also sits in
PRESETS & COT → Pura Director, under the randomisers).

1. Open the chat.
2. Write the rules, for example: *"Bleak and unsentimental. Violence lands hard and stays; no
   rescues, no last-minute mercy."*
3. Tick **On**.

They go out with every reply and win over Story Config's Narration Tone where the two disagree.
With Pura's Dead Dove Escalation rolled, they sit right under it. If Focus is on, its audits also
check the replies against your rules and correct "tone drift".

---

## 3. Keeping replies (and costs) in check

**See what each reply costs.** Every reply now has a small badge under its avatar, like
**≈ $0.031**. Green means the cache was warm (cheap); amber means it was cold (the first reply after
a break). Tap it for the breakdown. Turn the badges off in Memory → Reply length → *Show each
reply's cost*.

**Aim for about 2,000 tokens a reply.** In Memory → **Reply length**:

| Setting | Set it to |
|---|---|
| Story length | 450–550 words |
| Thinking length | 250 words |
| Safety cap | 2000 |

The safety cap is a hard limit on the reply you see. While it's set, VCRP tells the model how
much room it has (the panel shows the split, e.g. *story about 850 words, thinking about 250
words*), so it plans to finish in time. If a reply still runs into the cap mid-sentence, it ends
on its last full sentence and a note tells you; press **Continue** if you want the rest. On a
model that reasons before it writes (Gemini, DeepSeek, GLM; Claude with a reasoning effort set),
that reasoning is paid for in the request's limit without being part of the reply. There VCRP
puts the cap on the request with room for the reasoning on top, so the reasoning can no longer
use the cap up and leave you an empty reply; a reply can run a little over the cap when the model
reasons less. Setup Check shows the number the request allows.

**A goal and a ceiling.** Your target ($0.20 a reply by default, Memory tab) is a goal: Story
Memory sizes the prompt to it, and a reply that comes to more is never cut off or stopped. The
one hard stop is the **ceiling** ($0.50 by default, Memory → Reply length and cost).

- **How the ceiling works:** VCRP prices the prompt as it goes out, and what the ceiling leaves
  is the most the reply can write. Usually that is more than SillyTavern's own limit.
- **A prompt too big for the ceiling is not sent.** A note says why and what to do: Summarize now
  and Cut now in the Memory tab, or raise the ceiling.
- **Background calls are never limited:** summaries, audits, the Story Director, NPC scans.
  Summarize now catches up on a whole chat in one run; on a long one that can cost a couple of
  dollars, once.
- **What a reply really cost:** the badge by each reply uses the API's own token counts when it
  has them, and the panel reads the chat back: the average, how many replies went over your
  target, how often the cache helped. *Copy cost report* gives it as text.
- **Chapters approve themselves** when their own check finds them accurate, so cuts don't wait
  for you; one the check had to correct waits for your review.

**Tips:** Grounded Prose (Pura panel) is the biggest per-reply extra (~900 tokens); turn it off if
you want to save. The BLOCKS tab shows what each Pura tracker costs per reply.

**On Gemini (or any model that isn't Claude):** enter its price once in Memory → **Custom price**
(Gemini 4 Argon on OpenRouter: **2**, **10**, **0.1**). Without it, Story Memory, the cost badges and
the hold do nothing. Gemini caches the prompt by itself for a few minutes (nothing to set up), and
VCRP keeps the prompt's start the same each turn so it can; Story Memory sizes every request as if
that cache had lapsed, so a reply after a pause still stays within your target. Pin OpenRouter's
provider to Google AI Studio.

---

## 4. Pura Director extras

All in PRESETS & COT → **Pura Director** (pick a Pura engine first).

- **Thinking box.** Pura engines now think in the same collapsible *Thinking Process* box as the
  other engines, instead of writing their thoughts into the reply. The CoT switch turns it on or
  off; Thinking length caps it.
- **Each reply's rolls.** Open a reply's block card → **Notes** tab: *"🎲 Rolled this reply"* lists
  what the randomisers picked (which escalation, which twist, which voice). Turn it off with
  *Show each reply's rolls*.
- **Swipes keep the rolls.** Tick it to have a swipe or regenerate rewrite the reply with the same
  rolls instead of rolling new ones. A Continue always keeps the reply's voice.
- **Costs.** The top of the panel shows what Pura's text costs with your settings; each extra and
  randomiser shows its own cost.
- **Trackers stay in their cards.** If the model writes a tracker (an NPC sheet, a scene line) or a
  ((OOC)) note in the middle of the story, VCRP moves it into the block card for you.

---

## 5. Dialogue Colors that stay put

Turn on the **Dialogue Colors** add-on (Global Toggles & Add Ons). Each character keeps the colour
they first spoke in for the whole chat, and colours too dark or too pale for your theme are
adjusted so they stay readable. Below the add-on cards you'll find **Dialogue colors in this chat**:
change a character's colour, or *Forget* it to let the model pick again. It works on every engine,
the Megumin Originals too (VCRP asks the model to name who speaks in each coloured line), and it
knows "Mara Reyes" is the Mara it already has.

**No more coloured narration (GLM).** Some models, GLM especially, leave a colour tag open or wrap
the narration in it, so the colour runs over the narration and the paragraphs after it. VCRP now
fixes each new reply's tags as it arrives, so only the spoken lines are coloured, and the model
sees clean examples in its history. It's also told how to close the tags. Replies written before
this update stay as they were.

---

## 6. Story Config: Tense

PRESETS & COT → Story Config → **Tense**: present or past. Left on default, each engine keeps its
own (Pura Director · Adapted uses present tense).

---

## 7. Focus, every reply: fresher swipes, fewer repeats

These are already on. On each reply VCRP looks over your recent replies itself: no extra AI call,
nothing to approve, and nothing is sent when it finds nothing. When it does find something, it
adds a short note for that one reply. That note sits after the chat history, so it never breaks
the cache.

- **Swipes take a new direction.** When you swipe, the model sees how the versions you turned
  down began and ended. It's asked for a fresh take, not the same reply reworded.
- **Repeats.** It looks for:
  - phrases reused across the last 6 replies ("the air thick with unspoken tension");
  - three replies in a row that open with the same word;
  - three replies in a row that end by handing the turn to you (a question, or someone waiting
    on you);
  - the "It wasn't X. It was Y." habit.

  The model is told to avoid whatever it found.
- **Writing for you.** If the last reply spoke, acted or thought for your character, those lines
  are quoted back with a reminder that your character is yours. Lines that only repeat what you
  wrote yourself don't count. This check is off on engines meant to write your character too.

**Where:** VCRP → **Focus** tab → **Every reply**. Each check has its own switch. Open *What the
next reply would get now* to see the note as it stands. The wording is editable under Advanced:
Edit Prompts. The paid drift audits on the same tab are separate and can stay off.

---

## 8. V11 Тайна and the Author's Notebook (Megumin Suite V11)

**The engines.** PRESETS & COT, under V11. Both are Megumin Suite V11's own, word for word, and
each picks its own thinking:
- **V11 Тайна · Megumin Original**: one storyteller writes the whole turn. The base for every model.
  On **GLM, Kimi, DeepSeek or Qwen**, pick its **Thinking Cap**: shorter thinking that those models
  actually stick to. A Thinking Cap sets its own length, so your Thinking length isn't sent with it
  (as in Megumin V11).
- **V11 Тайна · Writers' Room**: the same, with a room of five talking each turn over in the thinking.
  With a Thinking Cap of its own too.

(The first V11 engine, "V11 Тайна Preview", and the DeepSeek version were dropped in 10.0.0-vcrp.9;
a profile on one moves to V11 Тайна.)

**Adapted versions.** **V11 Тайна · Adapted** and **V11 Тайна · Writers' Room · Adapted** are the
same engines run as VCRP engines. V11's text, thinking and
Notebook stay; VCRP's writing rules come on top: VCRP's ban list with its dash rule, the dash cleaner,
and VCRP's own wording of your writing style, add-ons and Story Config. Any writing style fits (one
other than V11's own takes over the narration). Pick an Adapted one for VCRP's rules, an Original
one for Megumin's exactly.

**Two styles.** Writing Style → **V11 Default** (a narrator with a voice and opinions) or **V11
Inside** (the narration rides inside one character at a time, never yours). Switching between the
V11 engines keeps the one you picked.

**Its preset.** Import **VCRP V11 Megumin Original** from the extension's Presets folder and select
it while a V11 engine is picked. If you imported it before, import it again and replace the old one:
it was rebuilt for V11's newest engines. Like every VCRP preset it carries regex scripts (they hide
the thinking and tidy the history): allow them once in Extensions → Regex → Preset scripts. Your
other VCRP presets don't need re-importing. Setup Check reminds you of all three: the regex, the old
V11 preset, and V11 running on a V10 preset.

**One preset for (almost) everything.** You can leave VCRP V11 Megumin Original selected and switch
engines freely: the Pura Director engines and V10 Ukiyo and Shura run on it with VCRP's own rules
(the same ban list, dash rule, formatting rules and final reminder as on VCRP V10 Universal). Only
the V10 Megumin Originals still want their own preset, VCRP V10 Megumin Original.

**Its layout (Megumin's 01/11 update).** The per-turn rules now come *after* your newest message,
ending on V11's line "Start your turn.", so the block instructions are the last thing the model
reads: that is Megumin's answer to models that skip the blocks. Story settings moved into the
cached part, so changing Story Config costs one cache miss, like changing the style. The preset
also carries V11's **USER Hard** prompt, switched off: turn it on (AI Response Configuration →
prompt list) if a model keeps answering an adult scene with nothing. **Re-import the preset** to
get all of this.

**The Notebook.** The story picks two or three hidden truths, drops small clues, and reveals each
one when the story earns it. It's always on with V11; for any other engine, switch it on in the
**Notebook** tab. **Truths kept at once** (same tab) sets how many it keeps, 1 to 10; a truth you
delete gives its number to the next new one.
- **On a reply's card:** a 📓 **Notebook** tab shows what that reply changed, blurred until you
  hover or tap a line.
- **In the Notebook tab:** each live truth is hidden until you ask to see it (it spoils the story).
  Once shown you can edit it (saved as you leave a box), remove a clue, mark it revealed, or delete
  it. **Add a truth** gives you an empty one to write yourself; the story reads it once the Truth
  box is filled in. **Past** lists the truths that came out as a timeline, each with *Activate
  again*.
- **Secrets and Seeds.** While the notebook is on, World State stops asking for each character's
  Secret and for Planted Seeds, as in Megumin V11; **Keep Secrets and Seeds in World State too**
  brings them back.
- **Swipes, edits and deletes** undo exactly what a reply did; your own changes in the tab stay.

**Characters on file.** Someone who left the scene and is named again comes back as they left:
their last outfit and mood from the World State, and their Bonds numbers. It's on by default; the
switch is in the BLOCKS tab, under World State (or under Bonds if you only use Bonds).

**On / Off.** The **On/Off** button at the top of the VCRP window sets VCRP aside completely, for a
quick chat with another preset or to check whether something odd is VCRP's doing.

**Lore for background jobs.** The Story Director, NPC scans and Focus audits now see the lorebook
entries your story has active (up to about 3,000 tokens per call, so a big lorebook stays cheap).
Switch it off in Global Settings → Behaviour → *Lore for background calls*.

---

## 9. Fixed for you (nothing to set)

- **No more accidental regenerates on mobile** when you scroll sideways across the block card or a
  wide HTML panel.
- **Better caching:** an older reply no longer changes its text a turn later, which could make the
  cache miss every turn. Expect more green cost badges.
- **Cut-off replies** keep the block state: the next reply carries the last complete blocks.
- **Missing blocks are asked for again.** When a reply arrives without its blocks (Gemini and
  DeepSeek skip them now and then), or stops inside them, VCRP asks the model for just the blocks
  in a small second call that reads the cache, and adds them to the reply. A toast says so. The
  switch is in the BLOCKS tab, *Ask again for missing blocks*.
- **Blank replies are explained, from the answer itself.** VCRP now reads the answer to each
  request as it passes and keeps the provider's stop reason, what the reply cost in output tokens
  (its hidden reasoning counted) and the limit the request went out with. A reply that comes back
  empty, all reasoning, or only blocks gets a toast that says what really happened: the output
  limit (and whether the Safety cap, the ceiling or SillyTavern's Max Response Length set it), a
  content-policy stop named in the API's answer (in its own words, such as Gemini's
  `PROHIBITED_CONTENT`), or an error. Such a reply is not counted as a normal one, and the *Next reply only* steer you
  wrote stays for the swipe. **Setup Check** lists how your last five replies ended; look there
  first when replies come back empty.
- **Empty replies on Gemini after a break: fixed.** The model's hidden reasoning is paid for in
  the request's output limit, and VCRP could not see its size, so the limit it set from your
  replies' measured size (tightest on the first reply after a break in a long chat) was used up by
  the reasoning on a hard turn, and the reply came back with nothing in it. On a model that
  reasons out of sight, VCRP stopped lowering the request's limit from the target; since
  10.0.0-vcrp.18 the target limits no reply on any model (see *A goal and a ceiling* above). Each
  reply's cost badge shows the output as the API billed it, reasoning included.
- **Safety cap and reasoning models.** On Gemini, DeepSeek, GLM, or Claude with a reasoning effort
  set, the model's hidden reasoning is paid for in the request's limit. The Safety cap now stands
  for the reply you see: the request allows the cap plus room for the reasoning, so it cannot be
  used up before the reply starts. Setup Check shows the number, warns when SillyTavern's own Max
  Response Length is under 8,000 on such a model, and warns when CoT Prefill is forced on for a
  model that refuses one. On Gemini 4 it also notes that Megumin Suite's Gemini loadout keeps
  custom thinking (Chain of Thought) off, since the model reasons on its own.
- **Gemini JB** (Global Toggles & Add-ons; from Megumin Suite V11's 04/11 update): on Gemini, turn
  it on when gritty or heavy NSFW scenes come back cut off or empty. It tells the model the request
  complies with the adult fiction policy and asks for a `^` before every word; VCRP removes them as
  each reply arrives, so you never see them (and the preset's new "clean up" regex hides them while
  the reply streams). Re-import your preset if Setup Check asks: the add-on needs a spot in it and
  that regex. Each `^` is an output token, so leave it off on other models. Not for NSFL.
- **The final check asks for the blocks** on turns that have them (Megumin V11's 04/11), so fewer
  replies end without them.
- **Group chats save properly.** A repaired or cleaned reply in a group chat used to fail to save.

## 10. Custom blocks and the scene list (from Megumin V11's 04/11 update)

**Custom blocks** (BLOCKS tab → *Create custom block*, or the pen on one you have):

- Pick what it holds: **Fields** (Trust 0–100, Gold, a Mood line, a list) or **Free text** (your own
  template). For each field, say in your own words what it means and how it moves; the story reads
  it. The **Rules for this block** box is for the block as a whole. Meters are not capped at 10
  points a reply here, so write your own limit if you want one.
- **What the story remembers of it:** *Carried forward* (the default, like every block), *Starts
  fresh*, or *Stays in the chat* (its old copies stay in the replies the model reads; costs tokens
  on every old reply, so use it for a log or a diary, not a meter).
- **When the story writes it:** every reply, only when something changed, or every few replies
  (a slow-moving block costs nothing on the replies in between).
- Your custom blocks are **shared by every character**: make one once, add it to another
  character from *Add a block*. *Delete block* removes it for everyone.

**Who is in the scene** (BLOCKS tab, on by default): with World State, Bonds or NPC Inner Chatter
in the block, the story ends every reply with a short list of who is there (Here, and Remote for a
call or a text), first in the blocks, and is handed one name per character to use everywhere. The
NPC Bank sends everyone listed first, a character who comes back is remembered, and Existing cast
only counts them. A *Scene* tab on the card shows it. It costs about forty output tokens a reply;
turn it off in the BLOCKS tab if you don't want it.

## 11. The Helper, Model Setup and short names (from Megumin V11)

**The Helper tab: a second model for the blocks.** On Gemini, DeepSeek or GLM the blocks are what
gets cut off or left out. Give the helper a connection (in SillyTavern's API Connections, connect
the helper's model, save a connection profile named, say, "Helper", connect your story model
again; then pick the profile in the Helper tab and press **Test**), switch it on, and it writes
the scene list, World State, Bonds, the sheets and your custom blocks after each reply. The story
model writes only the story and reads where the blocks stood. Your story connection never
changes: each job goes straight to the profile. One helper call per reply; the occasional jobs
(NPC scans, the Story Director, the ban list scan, the writing-style generator) go to it too,
Story Memory summaries and Focus audits only if you tick them. A pill at the bottom of the screen
shows a running job, with **Stop**; a reply you send while the helper still writes the last
reply's blocks waits a moment for it. The helper gets no jailbreak: use an uncensored or less
censored model (GLM 5.3 Flash, DeepSeek 4.1 Flash). *Use my current connection* makes the story
model do the helper's jobs in a second call, if you only want the blocks written separately.
Since 10.0.0-vcrp.19 the helper also answers two small questions around each reply, the
continuity check and the recall pick (section 13).

**Model Setup, the first tab.** Pick the model you play with and press **Use this loadout**: the
engine, Chain of Thought, the story length, Gemini JB, the CoT prefill, the Safety cap and the
helper are set the way Megumin's author tested them for that model, after a popup that lists what
changes. Gemini 4: Chain of Thought off, Gemini JB on, the Safety cap off. DeepSeek: the helper
on. You can change any row before using it, and skip the page altogether.

**The NPC Bank knows a short name.** "Resha" updates Resha Helios, a dossier the story writes for
her under a short name fills her record instead of making a second one, and the short name stays
on her card as a nickname. Two characters who both fit a name are never guessed between.

## 12. When a reply comes back empty

**The reply itself tells you why.** A reply that did not end normally carries a small line under
it: *No reply: the output limit was used up before the story*, *No reply: the model reasoned and
wrote nothing*, *No reply: the stream closed before the model had finished*, *No reply: the API's
answer names a content-policy stop (PROHIBITED_CONTENT)*, *Cut short by the output limit*. Tap the
line for the stop reason in the API's own words, who served the request, what was written and
read, the limit and what set it, how long it took, and how much of what arrived was reply text.
It stays with the message, so you can read it later.

**What VCRP does about each cause.**

- **SillyTavern put the whole reply in the Thinking box.** With Reasoning *Auto-Parse* on
  (Advanced Formatting → Reasoning), a reply that opens with `<think>` goes into the Thinking box
  until SillyTavern meets the template's closing to the letter. A model that closes its thinking
  slightly differently, or not at all, had its whole reply left there and the message came back
  empty, with nothing wrong anywhere. VCRP puts the story back by itself as the reply arrives. To
  avoid it altogether, turn Auto-Parse off: the preset's own regex draws the thinking box.
- **Nothing is arriving.** SillyTavern does not notice when the connection to the provider drops
  in the middle of a reply; it waits for good. After 90 seconds of silence on OpenRouter VCRP
  shows a notice: tap it to stop the reply and send the same request again. On a phone, keep
  Termux awake (`termux-wake-lock`) and stay on one network while a reply is being written.
- **The output limit stopped it.** A setting: the line names the limit and what set it (your
  Safety cap, or SillyTavern's Max Response Length). Raise that one.
- **The request failed.** Swipe; if it keeps failing, check the model and provider.
- **Nothing explains it** (the model ended its turn with nothing written, reasoned and never
  wrote, the stream closed early, or the answer could not be read). VCRP sends the same request
  once more by itself, as swiping would. Never twice for one message, and never a reply you
  stopped yourself; off in Global Settings (*Retry an empty reply once*).
- **The API's answer names a content-policy stop.** That is the provider's decision about that
  request. VCRP sent the request as it was, says so in the API's own words, and does not send it
  again or change it. (SillyTavern's terminal prints nothing of a streamed answer; with Streaming
  off it prints the whole answer, stop reason included.)

**For the whole chat:** Setup Check (Global Settings) lists the open chat's empty replies by
cause, with the provider that served each request, its id, how long each took and what arrived.
**Copy empty-reply details** on the card copies it as text.

---

## 13. Facts that hold: the Canon sheet, the continuity check, story dates

Four additions for long stories (10.0.0-vcrp.19). None of them can cut a reply off or hold one
back.

**The Canon sheet: the facts that must never change.** Open the **Memory** tab; the Canon sheet
is the first panel, with Story Memory on or off.

1. Type a fact in the box and press **Add**: *Mara is Bob's older sister. Magic costs the caster
   a memory. Bob promised to bring the ring back.* One fact a line.
2. If Story Memory has been running, the sheet offers facts from this chat under the box (the
   ones you pinned, then the ones that have stood longest). Press **+** to take one. It gets
   pinned in the fact list too, so a summary can't reword it without your review.
3. Edit a line by typing in it; **✕** takes it off.

The sheet belongs to the chat you have open. It is sent with every reply in the cached part of
the prompt, so a line costs very little after the first request; changing the sheet costs one
full-price request, once. Keep it to what the story stands on: past 30 lines the panel warns
you, because the more lines there are, the less each one weighs. Nothing is ever added by itself.

**The continuity check: a second pair of eyes on every reply.** This one needs the **Helper**
(section 11). With the helper on, it reads each reply against your Canon sheet and the scene as
it stood before the reply, and reports only what can't both be true. When it finds something,
the reply gets a line under it: *⚠ May contradict the story: "her brown eyes" against "Mara has
green eyes."* Tap the line:

- **Swipe with the correction** swipes the reply and tells that one swipe the facts it got wrong.
- **It is fine** takes the line away (the helper can be wrong).

It runs after the reply is on screen, so it never slows a reply down. It costs one small helper
call a reply, which is why only the helper does it: without a helper, nothing runs. If your
helper is set to *Use my current connection*, the check is off until you tick it in the Helper
tab, because there it would be an extra call on your story model with every reply.

**Story dates and bond milestones (nothing to set).** With the World State block on, each Story
Memory chapter now remembers the story's date and place, so the model reads its memory as a
timeline: *[Day 3, noon · The harbor] The vault.* With the Bonds block on, a meter that crosses a
quarter, half or three quarters of its scale is kept as a fact, with when and where: *Mara's
Affection toward Bob rose past 50% (31 to 55 of 100), Day 3, noon · The harbor.* Both are read
from the blocks the story already writes. No model call, no cost. Chapters from before this
update have no date.

**The helper's recall pick (nothing to set).** Story Memory used to bring an old chapter back only
when your scene shared words with it. Now, with the helper on a connection profile of its own,
the helper looks at the one-line summaries of your old chapters before each reply and picks up
to three the reply will need, so *"the thing you promised my sister"* finds the chapter about
Mara and the ring. It waits four seconds at most; if the helper is slow or busy, the old word
matching is used and the reply goes out as usual. Switch: Helper tab → *Recall picks*.

---

## 14. Characters that stay themselves: voices, the drift meter, audits that fix themselves

Three additions to the **Focus** tab (10.0.0-vcrp.20). They need **Dialogue Colors** on (Global
Toggles & Add Ons): it puts each speaker's name on their lines, and that is what VCRP reads.
Nothing here makes a call of its own.

**Voices: each character's own early lines.** In a long story the blunt one softens, the formal
one loosens, and everyone ends up sounding alike. So for the characters in the scene, VCRP sends
two of their earliest lines with each reply, under a note that this is how they sound. Open
Focus → **Voices** to see each character's lines:

- **✕** hides a line you don't think sounds like them; the next of their early lines takes its
  place.
- **Write a line in their voice** adds one of your own. Yours go first, and go out at once.
- **Leave them out of the prompt** stops sending a character's lines.

A line is only sent once it is 16 messages back; before that the model can still see it. It
costs about 30 tokens a line, after the chat, so the cache is never touched.

**The drift meter.** Beside each character is a small bar: *steady*, *shifting* or *drifting*.
It counts how their latest 30 lines differ from their earliest 30 (how long the lines run,
contractions, questions, trailing off, soft and harsh words, the words they start and end on)
and says what moved: *lines run longer (about 9 words to 22); more trailing off*. It needs 40
named lines for a character. It only counts, so it can't tell a character who grew from one who
wore down. That is the audit's job.

**If the story really did change them,** open their card and press **This is their voice now**.
Their voice is then taken from their latest lines, and the meter starts over from there.

**The meter decides when to audit.** With the drift audits on (same tab), an audit used to run
every 20 replies whether anything had drifted or not. Now it runs when the meter reads a
character as newly drifting, and otherwise half as often. Fewer audits when everyone holds
steady, and a quicker one when someone slips. Each audit is still one background call, priced
beside **Audit now**; no ceiling applies to it.

**Small corrections apply by themselves.** An audit's correction used to wait in the Focus tab
until you approved it, which on a phone mid-story meant it mostly waited. Now a short correction
about how the story is written (character drift, repeated motifs, slop) goes into the prompt as
soon as the audit lands. A toast tells you, and the Focus tab shows it under **Applied by
itself**:

- **Undo** takes it back out and leaves the audit waiting for your review, where you can edit
  it.
- **Keep it** dismisses the card.

A correction about where the story goes (your plot focus, your Tone Rules) or a long one still
waits for your approval, as before. To make every audit wait, untick *Small corrections apply
by themselves* in the Audit panel.

---

## 15. The Plot tab: arcs, beats and open ends

A new tab (10.0.0-vcrp.21) for steering where the story goes without writing it yourself.
Everything in it belongs to the chat you have open.

**Arc: a new stretch of the story.** When the heist is over and you want a slow romance next, or
a haunting, start an arc: a genre, a tone and a premise. While it runs, the model reads it last
with every reply (a few dozen tokens), and is told that everyone stays who they are.

1. Open **Plot** → *Start an arc*. Pick a genre and type a tone if you like.
2. Either write the premise yourself, or press **Pitch three arcs**. That is one background
   call (its price is beside the button): the model reads your story, your Canon sheet and the
   open threads, and offers three arcs that grow out of what is already there. You can type
   what you want from it first: *"Something with Jonah's debts. Less romance for a while."*
3. Press **Start this arc** on the one you like (or *Edit first* to change it).

A pitch comes with its opening move. It goes with your next message as a beat; VCRP Quick shows
it in *Next reply only*, and you can still change it or clear it.

If Story Memory is on, leave the tick on to **close what came before**: its chapters fold into
one entry under the old arc's name, so the memory reads arc by arc. Nothing is lost; the
chapters are still recalled when the scene touches them.

**Beats: plot points you line up ahead.** Type one (*"The landlord finds the letter."*) and
press **Queue**.

- **With the next reply** fires it now: it lands in VCRP Quick's *Next reply only* box and goes
  out with your next message.
- The number beside the box makes a beat fire **by itself** after that many replies. A toast
  tells you when one has gone into the box, so you can still hold it back.
- **VCRP Quick** shows the next beat waiting, with *Send it next*.

A beat is never written into the chat. If a reply ignores it, swipe: the swipe gets it again.

**Open ends: what the story left hanging.** With the World State block on, the story lists its
unresolved threads, planted seeds and consequence timers every reply, and then loses count. VCRP
keeps count for it. The tab shows each one with its real age: *open 31 replies, unmoved for
24*, *overdue by 3 replies*, *planted 40 replies ago*.

- **Reminders** (on by default): when a thread has not moved for 20 replies, a seed has waited
  30, or a timer has run out, VCRP names it to the model with one reply, and again every 8
  replies while it waits. Old threads pay off instead of piling up.
- **Make it a beat** queues a beat that brings one forward, when you want it now.
- **Left the list** shows the ones the story stopped listing. If one was dropped rather than
  settled, **Pick it back up** queues a beat for it.
- **Never remind** sets one aside.

No call of its own, no cost beyond the reminder's few dozen tokens on the replies it goes out.
