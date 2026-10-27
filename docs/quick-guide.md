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

The safety cap is a hard limit: a reply can never go over it. While it's set, VCRP tells the model
how much room it has (the panel shows the split, e.g. *story about 850 words, thinking about 250
words*), so it plans to finish in time. If a reply still runs into the cap mid-sentence, it ends
on its last full sentence and a note tells you; press **Continue** if you want the rest.

**One budget for the whole request.** With Story Memory on, each reply is held to its target
(e.g. $0.30), input and output together. You don't need to set anything: *Hold each reply to the
target* in Memory → Reply length is on by default.

- **How it works:** VCRP prices the prompt as it goes out, and what's left of the target is the
  most the reply can write.
- **During play** that's plenty: the cache makes the prompt cheap.
- **Right after a break** the whole prompt is written to the cache again, so the room is
  smaller, about a reply and a quarter. The model is told its room then, so it finishes inside it.
- **The panel** shows what the last reply's prompt cost and how much room it had.
- **Background calls:** VCRP's own (summaries, audits, the Story Director, NPC scans) are each
  kept to 8,000 output tokens, so none can run away.

**Tips:** Grounded Prose (Pura panel) is the biggest per-reply extra (~900 tokens); turn it off if
you want to save. The BLOCKS tab shows what each Pura tracker costs per reply.

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

**The engines.** PRESETS & COT, under V11. All four are Megumin Suite V11's own, word for word,
and each picks its own thinking:
- **V11 Тайна · Megumin Original**: one storyteller writes the whole turn. The base for every model.
- **V11 Тайна · Writers' Room**: the same, with a room of five talking each turn over in the thinking.
- **V11 Тайна DeepSeek**: V11 Тайна with one more line for DeepSeek, which tends to treat the
  character as the player.
- **V11 Тайна Preview**: the first V11 release, kept as it was. On **GLM, Kimi, DeepSeek or Qwen**,
  pick its **Thinking Cap**: shorter thinking that those models actually stick to. A Thinking Cap
  sets its own length, so your Thinking length isn't sent with it (as in Megumin V11).

**Two styles.** Writing Style → **V11 Default** (a narrator with a voice and opinions) or **V11
Inside** (the narration rides inside one character at a time, never yours). Switching between the
V11 engines keeps the one you picked.

**Its preset.** Import **VCRP V11 Megumin Original** from the extension's Presets folder and select
it while a V11 engine is picked. If you imported it before, import it again and replace the old one:
it was rebuilt for V11's newest engines. Like every VCRP preset it carries regex scripts (they hide
the thinking and tidy the history): allow them once in Extensions → Regex → Preset scripts. Your
other VCRP presets don't need re-importing. Setup Check reminds you of all three: the regex, the old
V11 preset, and V11 running on a V10 preset.

**The Notebook.** The story picks two or three hidden truths, drops small clues, and reveals each
one when the story earns it. It's always on with V11; for any other engine, switch it on in the
**Focus** tab.
- **On a reply's card:** a 📓 **Notebook** tab shows what that reply changed, blurred until you
  hover or tap a line.
- **In the Focus tab:** the live truths sit behind a spoiler warning. You can edit one, mark it
  revealed, delete it, or bring a past one back.
- **Swipes, edits and deletes** undo exactly what a reply did.

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
