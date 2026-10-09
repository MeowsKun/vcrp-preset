// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Tone Rules — the reader's own rules for the overall tone of a story, per chat.
//
// Free text, written in Global Toggles & Add-ons or in the Pura Director panel (the same
// text in both), and saved with the chat (chat_metadata), so each chat keeps its own. While
// it is on, it goes out after the newest message on every reply and Continue (never on
// Impersonate: that turn is the reader's own), framed as the governing tone: where Story
// Config's Narration Tone, the writing style or the engine's own voice disagree, it wins.
//
// It rides in the slot after the newest message ([[pura_late]], in both presets since the
// Pura engines, so nothing needs re-importing). With a Pura engine whose Dead Dove
// Escalation is rolled this reply it sits right under it; otherwise it stands on its own
// there. Every engine gets it, the Megumin Original mirrors too: it is the reader's own
// text, and off until they turn it on.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, debounce } from "../st.js";

const META = "vcrp_tone";

export const TONE_HEADER = "### Tone Rules\nThe reader's rules for the overall tone of this story. They govern it: where anything else (the story config's narration tone, the writing style, the engine's own voice) disagrees, these win.";

/** A chat is open, so there is somewhere to keep the rules. */
export function toneChatOpen() {
    try { const c = getContext(); return Boolean(c && c.chatId); } catch (e) { return false; }
}

/** This chat's Tone Rules: { enabled, text }. */
export function toneRules() {
    const m = chat_metadata && chat_metadata[META];
    return { enabled: Boolean(m && m.enabled), text: String((m && m.text) || "") };
}

const save = () => { try { saveMetadata(); } catch (e) { console.warn("[VCRP] Tone Rules: could not save", e); } };
const saveSoon = typeof debounce === "function" ? debounce(save, 800) : save;

/** Changes this chat's rules ({ enabled } saves at once; typing saves shortly after). */
export function setToneRules(changes, { soon = false } = {}) {
    if (!chat_metadata) return;
    const cur = chat_metadata[META] && typeof chat_metadata[META] === "object" ? chat_metadata[META] : {};
    chat_metadata[META] = { ...cur, ...changes };
    (soon ? saveSoon : save)();
}

/** What goes out for this generation kind, without leading blank lines; "" when off or empty. */
export function toneRulesText(gen = "reply") {
    if (gen !== "reply" && gen !== "continue") return "";
    const t = toneRules();
    const text = t.text.trim();
    return t.enabled && text ? `${TONE_HEADER}\n\n${text}` : "";
}
