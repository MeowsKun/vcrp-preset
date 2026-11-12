// ─────────────────────────────────────────────────────────────────────────────
// VCRP: which messages are the story's replies, for what is counted over a whole chat.
//
// SillyTavern hides a message from the prompt by setting is_system on it (/hide, the ghost
// icon), and nothing else. A reader with a long chat hides its early part to keep the prompt
// small, and those replies are still the story's past. What VCRP counts over a chat (how long
// ago a thread opened, how a character first spoke, how many replies a beat waits) goes by
// all of them: a count that dropped whenever messages were hidden would fire a beat late,
// make an old thread young, and take a character's first lines away. A real system message (a
// comment, one of SillyTavern's own notices) says what it is in extra.type, and is never one.
// ─────────────────────────────────────────────────────────────────────────────

/** True for a reply of the story's, hidden from the prompt since or not. */
export const isStoryReply = m => !!m && !m.is_user && typeof m.mes === "string" && !(m.is_system && m.extra && m.extra.type);

/** How many replies the story has had, hidden ones included. */
export function storyReplyCount(chat) {
    return (Array.isArray(chat) ? chat : []).filter(isStoryReply).length;
}
