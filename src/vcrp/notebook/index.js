// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the Author's Notebook (Megumin Suite V11), in the chat.
//
// The story keeps two or three hidden truths, plants small clues, and reveals each when the
// story earns it. V11 Тайна keeps a notebook by itself (always on with it); any other engine
// can switch it on in the Focus tab. The parser, the rules and the wording are V11's
// (model.js; the texts in data/megumin.js).
//
// Where the state lives: in the replies. Each turn the notebook is read back from the
// chat's own <Notebook> and <Notebook_Update> blocks, in order, so a swipe, an edit or a
// deleted message changes it exactly as it changed the story. The reader's own changes in
// the Focus tab (edit, delete, mark revealed, activate again) are kept with the chat
// (chat_metadata) and applied after the message that was newest when they were made.
//
// The cache: the craft of keeping a notebook is fixed text, in the cached part of the prompt
// ([[notebook]] in the V11 preset, [[block_rules]] in the others), and only while the
// notebook is on; V11 carries its own. What changes turn by turn (the live truths, and the
// setup or the update rules) rides with the blocks, after the chat, never cached. The
// notebook blocks never reach the history the model reads, the summaries or the audits:
// they are blocks, taken out with the rest.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { engineKeepsNotebook } from "../../core/engines.js";
import { activeEngine } from "../../engine/meguminOriginal.js";
import { MEGUMIN_V11 } from "../../../data/megumin.js";
import { vcrpWithoutSwipedReply } from "../generation.js";
import {
    emptyNotebook, parseNotebook, applyNotebook, liveTruths, pastTruths, notebookPhase, renderNotebookForPrompt,
    describeNotebookChange, statKey, NOTEBOOK_TAGS, LIVE_CAP,
} from "./model.js";

export { NOTEBOOK_TAGS, LIVE_CAP, liveTruths, pastTruths, describeNotebookChange };

const META = "vcrp_notebook";   // { ops: [{ op, id, fields?, at }] }: the reader's own changes

const ctxChat = () => { try { return ((getContext() || {}).chat) || []; } catch (e) { return []; } };

/** The engine keeps a notebook by itself (V11 Тайна): always on. */
export function notebookForced() {
    try { return engineKeepsNotebook(activeEngine()); } catch (e) { return false; }
}

/** The notebook is on: by the engine, or by the reader's switch (profile). */
export function notebookOn() {
    return notebookForced() || Boolean(localProfile && localProfile.notebook && localProfile.notebook.enabled);
}

/** The reader's switch (the caller saves the profile). */
export function setNotebookOn(on) {
    if (!localProfile) return;
    if (!localProfile.notebook || typeof localProfile.notebook !== "object") localProfile.notebook = {};
    localProfile.notebook.enabled = Boolean(on);
}

const readerOps = () => {
    const m = chat_metadata && chat_metadata[META];
    return m && Array.isArray(m.ops) ? m.ops : [];
};

/**
 * The notebook as `chat` stands: { state, changes } (changes: what each message did, by its
 * index). The reader's changes apply after the message that was newest when they were made.
 */
export function notebookFromChat(chat = ctxChat(), ops = readerOps()) {
    let state = emptyNotebook();
    const changes = new Map();
    const at = new Map();
    for (const o of ops) {
        const i = Number.isInteger(o && o.at) ? Math.min(o.at, chat.length - 1) : chat.length - 1;
        if (!at.has(i)) at.set(i, []);
        at.get(i).push(o);
    }
    const reader = i => {
        const list = at.get(i);
        if (list && list.length) state = applyNotebook(state, { ops: list }, { seq: Math.max(0, i) }).state;
    };
    reader(-1);
    for (let i = 0; i < chat.length; i++) {
        const m = chat[i];
        if (m && !m.is_user && !m.is_system && typeof m.mes === "string" && /<Notebook/i.test(m.mes)) {
            const parsed = parseNotebook(m.mes);
            if (parsed) {
                const r = applyNotebook(state, parsed, { seq: i });
                state = r.state;
                if (r.applied.length) changes.set(i, r.applied);
            }
        }
        reader(i);
    }
    return { state, changes };
}

// The chat folded once per pass of the card renderer (every reply's card asks for its own
// changes in the same moment), and kept only until that task ends.
let folded = null;
function foldedChat() {
    const chat = ctxChat();
    // What the chat holds, cheaply: an edit or a swipe in the same task changes it.
    const sig = `${chat.length}:${chat.reduce((n, m) => n + (m && typeof m.mes === "string" ? m.mes.length : 0), 0)}:${readerOps().length}`;
    if (folded && folded.chat === chat && folded.sig === sig) return folded.result;
    const result = notebookFromChat(chat);
    folded = { chat, sig, result };
    setTimeout(() => { folded = null; }, 0);
    return result;
}

/** What message `i` did to the notebook, as applied (VCRP's ids, nothing refused): a list, or null. */
export function notebookChangesAt(i) {
    try { return foldedChat().changes.get(i) || []; } catch (e) { return null; }
}

/** "off", "setup" (nothing live: the next reply writes it) or "running", for `chat`. */
export function notebookCurrentPhase(chat = ctxChat()) {
    if (!notebookOn()) return "off";
    return notebookPhase(notebookFromChat(chat).state, { on: true });
}

// ── The prompt ───────────────────────────────────────────────────────────────

/** The craft of keeping a notebook, for the cached part of the prompt. "" when off, or with V11 (its own). */
export function notebookCraft() {
    return notebookOn() && !notebookForced() ? MEGUMIN_V11.notebookCraft : "";
}

/**
 * What the <Blocks> envelope asks for this turn: { rules, template }, or null when off.
 * `chat`: the chat the reply follows (a swipe's replaced reply left out by the caller).
 */
export function notebookBlockRequest(chat = vcrpWithoutSwipedReply(ctxChat())) {
    if (!notebookOn()) return null;
    const { state } = notebookFromChat(chat);
    if (notebookPhase(state) === "setup") {
        return { rules: MEGUMIN_V11.notebookSetup, template: "<Notebook>\n[two or three truths, each in the form above]\n</Notebook>" };
    }
    return {
        rules: `${renderNotebookForPrompt(state)}\n\n${MEGUMIN_V11.notebookUpdate}`,
        template: "<Notebook_Update>\n[change lines; leave this block out when nothing changed]\n</Notebook_Update>",
    };
}

// ── The reader's changes (Focus tab) ─────────────────────────────────────────

/** Edits one truth: `fields` among truth, hiddenFrom (a list), when, changes, clueIdeas, clues. */
export const editTruth = (id, fields) => readerChange({ op: "edit", id, fields });
export const forgetTruth = id => readerChange({ op: "forget", id });
export const revealTruth = id => readerChange({ op: "reveal", id });
export const restoreTruth = id => readerChange({ op: "restore", id });

function readerChange(op) {
    if (!chat_metadata) return false;
    const chat = ctxChat();
    // With what the truth says now: should the reply that wrote it be swiped or edited, its id
    // may name another truth, and the change is not applied to that one (model.js).
    const t = notebookFromChat(chat).state.truths[op.id];
    chat_metadata[META] = { ops: [...readerOps(), { ...op, was: t ? statKey(t.truth) : null, at: chat.length - 1 }] };
    const failed = e => console.warn("[VCRP] Notebook: could not save", e);
    try { Promise.resolve(saveMetadata()).catch(failed); } catch (e) { failed(e); }
    return true;
}

// ── The blocks, for the registry and the card ────────────────────────────────

/** "#15", as SillyTavern numbers messages; "your change" past the chat's end. */
export const turnLabel = (seq, chat = ctxChat()) => (seq >= 0 && seq < chat.length ? `#${seq}` : "your change");

// The two notebook blocks. Never in the stack the reader arranges and never asked for as
// a block of their own: the notebook's request rides in the envelope (registry.js). Listed
// so they are stripped from the history like every block, kept out of summaries and audits,
// never carried as "the blocks as they stood" (the live truths are sent instead), and drawn
// as a tab of the card, behind a spoiler.
export const NOTEBOOK_BLOCKS = [
    {
        id: "notebook", tag: "Notebook", label: "Notebook", emoji: "📓", icon: "fa-book", color: "#0ea5e9",
        desc: "The Author's Notebook: the truths the story keeps hidden (Focus tab).",
        visibility: "open", builtin: true, system: true, transient: true, group: "notebook",
        requires: () => false,
    },
    {
        id: "notebook_update", tag: "Notebook_Update", label: "Notebook", emoji: "📓", icon: "fa-book", color: "#0ea5e9",
        desc: "What a reply changed in the Author's Notebook: a clue planted, someone finding out, a truth coming out.",
        visibility: "open", builtin: true, system: true, transient: true, group: "notebook",
        requires: () => false,
    },
];
