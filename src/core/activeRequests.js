// ─────────────────────────────────────────────────────────────────────────────
// In-flight background request markers.
//
// These are the handshake between the features and the prompt engine. A feature
// that wants the engine to build a DIFFERENT prompt than the normal roleplay one
// parks its payload here, fires a quiet generation, and clears it in a finally.
// handlePromptInjection() reads them to decide which prompt shape to emit.
//
// They live together, apart from state.js, because they share one lifecycle and
// one meaning: "a non-roleplay generation is currently running, and here is what
// it needs." Scattering them back into their feature modules would leave the
// engine importing from six features just to answer that question.
//
// Reads elsewhere work through live bindings; reassignment goes through the
// setters. See the long note in state.js for why.
// ─────────────────────────────────────────────────────────────────────────────

// VCRP: each job's own marker, the quiet prompt it sends. SillyTavern puts that text in the
// prompt it builds for the job, so the engine can tell the job's own prompt from any other:
// a parked payload is used ONLY for the prompt that carries its marker (or the one the helper
// model builds for it, which names it). A story prompt built while a job is still running, or
// after one hung, carries none and stays a story prompt.
export const TASK_MARKERS = {
    storyPlan: "___PS_STORY_PLAN___",
    npcScan: "___PS_NPC_SCAN___",
    npcUpdate: "___PS_NPC_UPDATE___",
    banList: "___PS_BANLIST___",
    order: "___PS_DUMMY___",
    focus: "___PS_FOCUS___",
    helperBlocks: "___PS_HELPER_BLOCKS___",
};

// Story Director: the chat text being planned against.
export let activeStoryPlanRequest = null;
export function setActiveStoryPlanRequest(v) { activeStoryPlanRequest = v; }

// Dynamic Ban List: the chat text being scanned for repetition.
export let activeBanListChat = null;
export function setActiveBanListChat(v) { activeBanListChat = v; }

// NPC Bank scan: { chatText, existingNames }.
export let activeNpcScanRequest = null;
export function setActiveNpcScanRequest(v) { activeNpcScanRequest = v; }

// Forced dossier refresh for one NPC: { npcName, npcText, chatText, rules }.
// Fired by the refresh button on an NPC card, not by the story.
export let activeNpcUpdateRequest = null;
export function setActiveNpcUpdateRequest(v) { activeNpcUpdateRequest = v; }

// VCRP Focus audit: { text, card, items, checks, ... } (vcrp/focus/index.js).
export let activeFocusAudit = null;
export function setActiveFocusAudit(v) { activeFocusAudit = v; }

// Manual "run this order" task: substituted into [[order]] placeholders.
export let activeGenerationOrder = null;
export function setActiveGenerationOrder(v) { activeGenerationOrder = v; }

// VCRP: the blocks a reply left out, asked for in a second call: { index, tags }
// (vcrp/blockRepair.js). The roleplay prompt as it is, the block instructions kept, the
// thinking and the prefill not.
export let activeBlockRepair = null;
export function setActiveBlockRepair(v) { activeBlockRepair = v; }

// VCRP: the blocks the helper model writes after a reply (vcrp/helper/blocks.js):
// { system, user, index }. The handler sends those two messages and nothing else.
export let activeHelperBlocks = null;
export function setActiveHelperBlocks(v) { activeHelperBlocks = v; }

// VCRP: a question with a prompt of its own (vcrp/helper/aside.js): the continuity check, the
// recall pick, the arc pitches. The handler sends its messages and nothing else. Each question
// is parked under a marker of its own, so two in flight at once (the helper's check on its
// connection, a call on the story's) can never take each other's prompt.
const asides = new Map();   // marker -> { messages }
let asideSeq = 0;
const asideLetters = n => { let s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0); return s; };
/** Parks a question's messages; returns the marker to send as its quiet prompt. */
export function parkAside(messages) {
    const marker = `___PS_ASIDE_${asideLetters(asideSeq++)}___`;
    asides.set(marker, { messages });
    return marker;
}
/** Takes a parked question back out (always, once it was answered or failed). */
export function unparkAside(marker) { asides.delete(marker); }
/** The parked question whose marker `carries` finds in the prompt being built, or null. */
export function asideFor(carries) {
    for (const [marker, payload] of asides) if (carries(marker)) return payload;
    return null;
}
/** How many questions are parked now (0 when nothing is being asked). */
export const asidesParked = () => asides.size;

// ── NPC reference images for the current generation ──────────────────────────
// An array rather than a single payload: several NPCs can be attached at once.
// Pushed into during collection, emptied at the start and end of a run.
export let activeNpcImages = [];
export function pushActiveNpcImage(img) { activeNpcImages.push(img); }
export function clearActiveNpcImages() { activeNpcImages = []; }

// ── Is any non-roleplay generation running? ──────────────────────────────────
// Used by the engine to suppress the prompt-preview popup during background work.
//
// NOTE — this deliberately reproduces the original inline OR-chain EXACTLY,
// including the fact that it does NOT test activeNpcScanRequest. An NPC scan is
// a background generation by every other measure, so the omission looks like an
// oversight rather than a decision, and it would let the preview popup fire
// mid-scan. Adding it here is a one-line behaviour change, but it is a behaviour
// change — it is not part of this refactor. Fix it separately, on purpose, once
// the extraction is verified.
export function isBackgroundGenerationActive() {
    return !!(
        activeStoryPlanRequest ||
        activeBanListChat ||
        activeNpcUpdateRequest ||
        activeGenerationOrder ||
        activeFocusAudit ||
        activeBlockRepair ||
        activeHelperBlocks
    );
}
