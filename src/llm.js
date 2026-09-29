// Background generations (memory summaries, NPC scans, ...) sent as a raw message array.
// They bypass the active preset entirely, so no preset switching is needed.
// generateRaw still fires CHAT_COMPLETION_PROMPT_READY, so each request is tagged with a
// sentinel that the injector recognises and strips (a global flag would race with real replies).

export const BG_SENTINEL = "⁣vcrp-bg⁣";

/**
 * @param {{role: string, content: string}[]} messages
 * @param {{responseLength?: number}} [opts]
 * @returns {Promise<string>}
 */
export async function runBackground(messages, { responseLength } = {}) {
    const tagged = messages.map((m, i) => (i === 0 ? { ...m, content: BG_SENTINEL + m.content } : { ...m }));
    return await SillyTavern.getContext().generateRaw({ prompt: tagged, responseLength });
}

/** Returns true (and removes the tag) if this prompt is one of our background requests. */
export function consumeBackgroundTag(chat) {
    const first = chat?.[0];
    if (first && typeof first.content === "string" && first.content.startsWith(BG_SENTINEL)) {
        first.content = first.content.slice(BG_SENTINEL.length);
        return true;
    }
    return false;
}
