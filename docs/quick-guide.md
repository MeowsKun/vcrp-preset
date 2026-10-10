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
change a character's colour, or *Forget* it to let the model pick again.

---

## 6. Story Config: Tense

PRESETS & COT → Story Config → **Tense**: present or past. Left on default, each engine keeps its
own (Pura Director · Adapted uses present tense).

---

## 7. Fixed for you (nothing to set)

- **No more accidental regenerates on mobile** when you scroll sideways across the block card or a
  wide HTML panel.
- **Better caching:** an older reply no longer changes its text a turn later, which could make the
  cache miss every turn. Expect more green cost badges.
- **Cut-off replies** keep the block state: the next reply carries the last complete blocks.
