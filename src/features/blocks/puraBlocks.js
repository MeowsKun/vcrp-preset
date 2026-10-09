// ──────────────────────────────────────────────────────────────────────────────
// Pura's trackers as blocks (VCRP).
//
// Pura's Director Preset (by Pura) ships seventeen trackers written inline in the reply
// and drawn as cards by its own regexes. Here each one is a block in the BLOCKS tab like
// VCRP's own: arranged in the stack, written inside the <Blocks> section, kept out of the
// history like every block, and drawn with Pura's card designs (src/blocks/pura.js).
// They work with every engine.
//
// Two parts per tracker, for the cache:
//   rules     Pura's tracker prompt, word for word, sent once in the cached part of the
//             prompt ([[block_rules]], end of Main 2).
//   skeleton  its format and when it is written, in the per-turn block instructions.
//
// Most of Pura's trackers are written only when something changes, so the last reply's
// blocks are not the whole state. `carry` says what to hand the model every turn instead,
// read from the whole chat (see carriedTrackerNote in vcrp/blockHistory.js):
//   single   the newest entry
//   perKey   the newest entry per subject (fields named by `key`), dropping a subject whose
//            newest entry says it ended (`end` tested against field `endField`)
//   names    a list of who or what already has one (NPC sheets, achievements)
//   recent   the last few entries
// ──────────────────────────────────────────────────────────────────────────────

import { PURA_TRACKERS } from "../../../data/pura.js";

const LEAVE_OUT = "otherwise leave this whole tag out";

const DEFS = [
    {
        id: "pura_npc", tag: "Pura_NPC", label: "NPC Sheets", emoji: "🔍", icon: "fa-id-card", color: "#bd93f9", rules: "npc",
        desc: "Pura: a character sheet (major, support or minor) when a named NPC first appears, upgrades, and quick references. Feeds the NPC Bank.",
        markers: ["NPC:MAJOR", "NPC:SUPPORT", "NPC:MINOR", "NPC:UP", "NPC:REF", "NPC:REL"],
        when: `When a named NPC first appears, upgrades a tier, needs a quick reference or has a relationship change; ${LEAVE_OUT}. One entry each, in its exact tier format from the NPC Profile Sheets rules.`,
        skeleton: "[NPC:MAJOR|Name]\nb: Full Name | Age | Gender/Pronouns | Occupation\na: Height/Build | Hair | Eyes | Skin | Distinguishing Marks | Current Attire\np: Demeanor | Speech Pattern | Core Traits (3-5) | Quirks/Tells\nh: Relevant History | Motivations | Secrets\nr: Connection to Protagonist | Other Ties\n[/NPC]",
        carry: { mode: "names", markers: ["NPC:MAJOR", "NPC:SUPPORT", "NPC:MINOR", "NPC:UP"], text: "Sheets already written (never write one twice; upgrade a tier with [NPC:UP|Name|NEW_TIER])" },
    },
    {
        id: "pura_choices", tag: "Pura_Choices", label: "Choices (Pura)", emoji: "🧭", icon: "fa-compass", color: "#f6c177", rules: "choices",
        desc: "Pura: 3-7 numbered actions for you at the end of every reply. Use this or Skill-Check Choices, not both.",
        markers: ["CHOICES"],
        when: "Every reply.",
        skeleton: "[CHOICES]\n1. Action description\n2. Action description\n3. Action description\n[/CHOICES]",
    },
    {
        id: "pura_skill_choices", tag: "Pura_Skill_Choices", label: "Skill-Check Choices", emoji: "🎲", icon: "fa-dice-d20", color: "#f6c177", rules: "skillChoices",
        desc: "Pura: choices with a skill and a target number, resolved on a hidden d100 roll when you pick one. Use this or Choices (Pura), not both.",
        markers: ["CHOICES"],
        // The roll changes every request, so it rides here, after the chat, never in the rules.
        when: "When meaningful player agency is needed. The hidden d100 roll for this response is {{roll:1d100}}; never reveal it.",
        skeleton: "[CHOICES]\n1. **[Skill 0/100]** Action description\n2. **[Skill 0/100]** Action description\n3. **[Skill 0/100]** Action description\n[/CHOICES]",
    },
    {
        id: "pura_directions", tag: "Pura_Directions", label: "Direction Menu", emoji: "🗺️", icon: "fa-signs-post", color: "#bd93f9", rules: "directions",
        desc: "Pura: four plot directions (two grounded, two wildcard) at the end of every reply.",
        markers: ["DIRECTIONS"],
        when: "Every reply.",
        skeleton: "[DIRECTIONS]\nA. A grounded pivot that creates new, irreversible pressure.\nB. Another grounded pivot that forces a different kind of change.\nC. A wildcard turn that makes the scene volatile and harder to control.\nD. Another wildcard that introduces something unexpected and dramatically charged.\n[/DIRECTIONS]",
    },
    {
        id: "pura_relationship", tag: "Pura_Relationship", label: "Relationships (dating sim)", emoji: "💞", icon: "fa-heart-pulse", color: "#ff79c6", rules: "relationship",
        desc: "Pura: each recurring NPC's feelings about you as a dating-sim route card: stage, route, heart, trust, likes, a keepsake memory, the next threshold.",
        markers: ["METER"],
        when: `For an NPC who matters for the first time or whose relationship with {{user}} changed this scene; ${LEAVE_OUT}. One [METER] record per NPC.`,
        skeleton: "[METER|Name|Stage|Condition|Drift]\nroute: \npath: from > Stage > next\nheart: \ntrust: \nwant: \nguard: \nlikes: \ndislikes: \ntell: \nunsaid: \nmemory: \ndate: \nturn: \nnext: \n[/METER]",
        carry: { mode: "perKey", key: [1], endField: 3, end: /SEVERED/i },
    },
    {
        id: "pura_scene", tag: "Pura_Scene", label: "Scene", emoji: "📍", icon: "fa-location-dot", color: "#bd93f9", rules: "scene",
        desc: "Pura: location, time and atmosphere whenever the scene moves.",
        markers: ["SCENE"],
        when: `When the location or time changes; ${LEAVE_OUT}.`,
        skeleton: "[SCENE|Location|Time|Weather/Atmosphere]\ndetail: one-line sensory detail that informs the current environment\n[/SCENE]",
        carry: { mode: "single" },
    },
    {
        id: "pura_time", tag: "Pura_Time", label: "Time", emoji: "🕐", icon: "fa-clock", color: "#8be9fd", rules: "time",
        desc: "Pura: a running day and hour when time advances meaningfully.",
        markers: ["TIME"],
        when: `When time advances meaningfully; ${LEAVE_OUT}.`,
        skeleton: "[TIME|Day X|Day of Week|Approximate Hour]\nnote: explain the time context\n[/TIME]",
        carry: { mode: "single" },
    },
    {
        id: "pura_events", tag: "Pura_Events", label: "Pending Events", emoji: "⏳", icon: "fa-hourglass-half", color: "#f1fa8c", rules: "events",
        desc: "Pura: quests, promises, deadlines and threats, until they are resolved or failed.",
        markers: ["EVENT"],
        when: `When an event is added, updated, resolved or failed this scene; ${LEAVE_OUT}.`,
        skeleton: "[EVENT|Type|Summary|Deadline]\ncontext: MANDATORY; explain the stakes or origin\n[/EVENT]",
        carry: { mode: "perKey", key: [2], endField: 1, end: /RESOLVED|FAILED/i },
    },
    {
        id: "pura_achievements", tag: "Pura_Achievements", label: "Achievements", emoji: "🏆", icon: "fa-trophy", color: "#ff8c42", rules: "achievements",
        desc: "Pura: notable firsts and milestones, one at most per scene.",
        markers: ["ACH"],
        when: `When something genuinely significant or entertaining happens; ${LEAVE_OUT}.`,
        skeleton: "[ACH|Title|Rarity|Description]\nunlocked: MANDATORY; explain what triggered it\n[/ACH]",
        carry: { mode: "names", text: "Already awarded (never award one twice)" },
    },
    {
        id: "pura_reputation", tag: "Pura_Reputation", label: "Reputation", emoji: "👥", icon: "fa-users", color: "#ffc87c", rules: "reputation",
        desc: "Pura: how groups and factions see you, when it shifts.",
        markers: ["REP"],
        when: `When public perception changes or is established this scene; ${LEAVE_OUT}.`,
        skeleton: "[REP|Source|Perception|Direction]\ncause: MANDATORY; explain what triggered this reputation shift\n[/REP]",
        carry: { mode: "perKey", key: [1] },
    },
    {
        id: "pura_items", tag: "Pura_Items", label: "Inventory", emoji: "🎒", icon: "fa-box-open", color: "#8be9fd", rules: "items",
        desc: "Pura: items of narrative significance you gain, lose, use or give away.",
        markers: ["ITEM"],
        when: `When inventory changes this scene; ${LEAVE_OUT}.`,
        skeleton: "[ITEM|Action|Name|Detail]\nnote: MANDATORY; explain origin or significance\n[/ITEM]",
        carry: { mode: "perKey", key: [2], endField: 1, end: /LOST|BROKEN|GIVEN/i },
    },
    {
        id: "pura_status", tag: "Pura_Status", label: "Status & Conditions", emoji: "🩹", icon: "fa-kit-medical", color: "#ff6e6e", rules: "status",
        desc: "Pura: physical, mental or behavioural states when they change, until cleared.",
        markers: ["STATUS"],
        when: `When a condition is gained, worsened, improved or cleared this scene; ${LEAVE_OUT}.`,
        skeleton: "[STATUS|Character|Condition|Severity]\nnote: MANDATORY; explain the cause or context\n[/STATUS]",
        carry: { mode: "perKey", key: [1, 2], endField: 3, end: /CLEARED/i },
    },
    {
        id: "pura_secrets", tag: "Pura_Secrets", label: "Secrets", emoji: "🔒", icon: "fa-user-secret", color: "#bd93f9", rules: "secrets",
        desc: "Pura: secrets, lies and who knows what.",
        markers: ["SECRET"],
        when: `When a secret is established, revealed or spreads this scene; ${LEAVE_OUT}.`,
        skeleton: "[SECRET|Owner|What They Know or Hide|Who Else Knows]\ncontext: MANDATORY; explain the stakes or origin\n[/SECRET]",
        carry: { mode: "perKey", key: [1, 2] },
    },
    {
        id: "pura_parallel", tag: "Pura_Parallel", label: "Off-Screen", emoji: "🕸", icon: "fa-diagram-project", color: "#7ba3d4", rules: "parallel",
        desc: "Pura: what absent characters and the wider world are doing, every scene.",
        markers: ["PARALLEL"],
        when: "Every scene.",
        skeleton: "[PARALLEL|Scope|Relevance]\n- Character 1: brief development\n- Character 2: brief development\n- World/NPCs: brief development\n[/PARALLEL]",
        carry: { mode: "single" },
    },
    {
        id: "pura_world", tag: "Pura_World", label: "World Detail", emoji: "🌐", icon: "fa-earth-europe", color: "#3d8b7a", rules: "world",
        desc: "Pura: one small world detail per scene that may matter later.",
        markers: ["WORLD"],
        when: "Exactly one per scene.",
        skeleton: "[WORLD|Category|Location or Context]\ndetail: (max 50 words)\n[/WORLD]",
        carry: { mode: "recent", count: 5 },
    },
    {
        id: "pura_stats", tag: "Pura_Stats", label: "Your Stats", emoji: "📟", icon: "fa-terminal", color: "#73ff9b", rules: "stats",
        desc: "Pura: an RPG stat sheet for you, built from your persona once and kept up to date.",
        markers: ["USER_STATS"],
        when: `When no [USER_STATS] exists yet, or a level-up changes it; ${LEAVE_OUT}.`,
        skeleton: "[USER_STATS]\nName: {{user}}\nLevel: 1\n…\n[/USER_STATS]",
        carry: { mode: "single" },
    },
    {
        id: "pura_level_up", tag: "Pura_Level_Up", label: "Level-Up", emoji: "⬆️", icon: "fa-arrow-up", color: "#ffe082", rules: "levelUp",
        desc: "Pura: a level-up report after a major milestone. Pair it with Your Stats.",
        markers: ["LEVEL_UP"],
        when: `Only after a major milestone; ${LEAVE_OUT}.`,
        skeleton: "[LEVEL_UP]\nLevel: X\nReason: Brief major milestone description.\n…\n[/LEVEL_UP]",
    },
];

// The NPC Bank's names, for the NPC Sheets block: who never gets a sheet and who already
// has one. Handed in by vcrp/pura/npc.js, which knows the bank (this file stays data).
let npcNames = null;
export function setPuraNpcNames(fn) { npcNames = fn; }
function npcNamesNote() {
    if (typeof npcNames !== "function") return "";
    let n;
    try { n = npcNames(); } catch (e) { return ""; }
    const lines = [];
    if (n.skip.length) lines.push(`Never write a sheet for: ${n.skip.join(", ")} (the main cast and ignored names).`);
    if (n.bank.length) lines.push(`Already in the NPC Bank, so never a new sheet; use [NPC:UP|Name|NEW_TIER] or [NPC:REL|Name|change] when one applies: ${n.bank.join(", ")}.`);
    return lines.length ? `\n${lines.join("\n")}` : "";
}

/** Pura's trackers as block registry entries. */
export const PURA_BLOCKS = DEFS.map(d => ({
    id: d.id, tag: d.tag, label: d.label, desc: d.desc, emoji: d.emoji, icon: d.icon, color: d.color,
    visibility: "open", builtin: true, group: "pura",
    puraRules: d.rules, markers: d.markers, carry: d.carry || null,
    build: () => `(${d.when})${d.id === "pura_npc" ? npcNamesNote() : ""}\n${d.skeleton}`,
}));

export const PURA_BLOCK_IDS = PURA_BLOCKS.map(b => b.id);

/** The rules of the Pura trackers in the stack, for [[block_rules]] (cached). "" with none. */
export function puraBlockRules(activeBlocks) {
    const rules = (activeBlocks || []).filter(b => b && b.puraRules && PURA_TRACKERS[b.puraRules]).map(b => PURA_TRACKERS[b.puraRules]);
    if (!rules.length) return "";
    return "\n\n## Tracker rules\nThese trackers are written inside the <Blocks> section at the end of your reply, each in its own tag as listed there, never in the story itself. Where a rule below says where a tracker appears in the response, read that as its place inside <Blocks>. A tracker whose rules say to skip it this turn is simply left out.\n\n"
        + [...new Set(rules)].join("\n\n");
}

// ── Reading Pura's entries back ──────────────────────────────────────────────

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The entries in a block body: each one from its [MARKER|…] header to the next header (or
 * its own [/MARKER]), as { marker, fields, text }. `fields[0]` is the marker.
 */
export function puraEntries(body, markers) {
    const text = String(body || "");
    const re = new RegExp(`\\[(${markers.map(escRe).join("|")})(?:\\|([^\\]\\n\\r]*))?\\]`, "g");
    const heads = [];
    let m;
    while ((m = re.exec(text)) !== null) heads.push({ at: m.index, marker: m[1], fields: [m[1], ...String(m[2] || "").split("|").map(f => f.trim())] });
    return heads.map((h, i) => {
        let chunk = text.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : text.length);
        const family = h.marker.split(":")[0];
        const close = chunk.search(new RegExp(`\\[\\/${escRe(family)}\\]`));
        if (close >= 0) chunk = chunk.slice(0, close + family.length + 3);
        return { marker: h.marker, fields: h.fields, text: chunk.trim() };
    });
}

// ── Overlaps ─────────────────────────────────────────────────────────────────
// A Pura tracker and one of VCRP's own blocks that do the same job. Both can be on (they
// never break each other), but the model writes both every time and you pay for both, so
// the BLOCKS tab says so when a pair is in the stack together.
const TWINS = [
    ["pura_choices", "cyoa"], ["pura_skill_choices", "cyoa"], ["pura_choices", "pura_skill_choices"],
    ["pura_relationship", "bonds"], ["pura_scene", "world"], ["pura_time", "world"],
    ["pura_parallel", "world"], ["pura_stats", "sheet"],
];

/** The ids in `order` that do the same job as block `id`. */
export function blockTwinsInStack(id, order) {
    const inStack = new Set(order || []);
    return TWINS.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a)).filter(t => inStack.has(t));
}
