// Optional add-on prompt modules.
// Moved verbatim out of database.js. Content unchanged.

export const addons = [
    {
      id: "html",
      label: "Immersive HTML",
      trigger: "[[html]]",
      content: `<render>
Some things are read, not described. When a character is looking at a screen, page, sign, letter or printout, reproduce it as HTML styled to look like that object.

RULES
- Render only what a character is reading right now, and only when the exact wording or layout matters. One per response at most. Most responses have none.
- Never render summaries, stat panels, status bars, recaps or choice menus. If it exists only for the reader, it does not exist.
- Give it a maker and a moment: era, device, handwriting, spelling, the author's voice. A 2007 phone is not an iPhone. A hospital terminal is not an app.
- Put one wrong detail in it — an unread count, a crossed-out word, 4% battery, a blank date, a signature that does not match. Never point at it.
- Place it mid-response, where a hand or a page turn presents it. Never open or close a response with it. Prose continues on the other side.

BUILD
- Inline style="" only. No <style>, no <script>, no onclick, no class names.
- Use <details><summary> for anything folded.
- No external images.
- Under 25 lines.
- Never wrap it in \`\`\` fences. It must render.
</render>`
    },
    // VCRP: Bold NPCs (carried over from VCRP V8/V9).
    {
      id: "bold_npcs",
      label: "Bold NPCs",
      trigger: "[[boldnpcs]]",
      content: `<bold_npcs>
- Free Will: NPCs chase their own goals and ignore what {{user}} or anyone else wants, unless going along serves them.
- Selfish Pursuit: Every NPC action comes from that NPC's own motives, personality, and goals in the scene. Never from narrative convenience, and never to please the PC.
- Full Commitment: NPCs never do anything halfway. No hesitant, partial, or aborted actions. If they act, they finish the move.
- No Hovering: NPCs never "reach for" something or let a hand "hover near" it. They grab, take, touch, and commit.
  BAD: "His hand hovers near the gold."
  GOOD: "He snatches the gold and pockets it."
- In Character: Selfishness takes the shape of the person. A coward is selfish in cowardly ways; a bold character is selfish boldly.
</bold_npcs>`
    },
    {
      id: "color",
      label: "Dialogue Colors",
      trigger: "[[COLOR]]",
      recommended: true,
      content: `- Dialogue Colors: Assign a distinct, readable hex color to every character using: <font color="#HEXCODE">"Dialogue here"</font>. Once assigned, a character's color is LOCKED for the entire story.`
    },
    { id: "dn", label: "Dialogue & Narration Format", trigger: "[[DN]]", content: "- Narration must be between <narration>.........</narration>. and dialogue must be between <dialogue >.........</dialogue > and you can interwoven them throughout the response." }
];
