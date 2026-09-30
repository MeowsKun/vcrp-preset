// ─────────────────────────────────────────────────────────────────────────────
// NpcBank prompts.
//
// NPC Bank — dossier extraction and the dossier block rules.
//
// The portrait prompts are text moved verbatim out of index.js. These are the
// built-in defaults; a user edit is stored as a diff against them (see
// storage.js).
//
// WHAT CHANGED, AND WHY: `dossierTemplate` used to carry both the rules and the
// fill-in-the-blank template. The template is now GENERATED from the NPC Bank's
// field list (features/npc/fields.js), the same way Bonds and the Character
// Sheet are generated from theirs — so adding a field in the tab reaches the
// prompt without anyone editing prompt text, and the parser, the card and the
// template can no longer drift apart.
//
// What is left here is the part a field list cannot express: when to write a
// dossier at all, and how to think about each kind of field. That stays
// editable. The two generated pieces are dropped in at {{template}} and
// {{persistenceRule}}, each indented to wherever its token sits.
// ─────────────────────────────────────────────────────────────────────────────

export const npcBankPrompts = {
        dossierRules: `### NPC DOSSIER:
  trigger: >
    Generate EXACTLY ONCE when an NPC meets ALL three conditions in a single scene:
      1. NAMED: given a proper name or a name the PC will use again.
      2. VOICED: speaks more than a transactional line (not "That'll be 5 credits").
      3. STAKED: has a want, opinion, or role that can affect the story later.
    DO NOT generate for anyone who fails a test: the unnamed cashier, the guard
    with one line, crowds, set dressing. A job never disqualifies anyone.
    NEVER regenerate for an NPC who already has a dossier.
    Treat the original dossier as locked canon.

  format: >
    One <New_NPC> tag per NPC, placed inside the <Blocks> section. Dense,
    dashboard-style. No prose paragraphs except the Background and Secrets
    fields. Everything else is fragments.

  template: |
    {{template}}

  guidelines:
    {{persistenceRule}}
    secrets_rule: >
      Secrets are for YOU as the narrative engine. They drive behavior the PC
      can't predict. Never reveal in narration unless the NPC actually discloses
      them through action or dialogue. Higher tiers stay buried longer.
    canon_lock_rule: >
      Once written, these facts are fixed. Future scenes must stay consistent
      with them. If a later scene needs a contradiction, surface it as a
      revelation (the earlier info was a lie/misunderstanding), never a silent retcon.
`
};
