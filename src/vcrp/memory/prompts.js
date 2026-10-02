// ─────────────────────────────────────────────────────────────────────────────
// VCRP memory: the instructions for the summary and check calls.
//
// Both ride on the roleplay prompt itself (SillyTavern's quiet generation): the chat is
// already there and already cached, so the instruction only has to say which stretch to
// work on. The marker on the first line lets the prompt hook recognise the request and
// drop the after-chat rules, so the instruction is the last thing the model reads.
// ─────────────────────────────────────────────────────────────────────────────

export const TASK_MARKER = "[VCRP MEMORY TASK";

const stretch = (startQuote, endQuote) =>
    `It starts with the message that begins:\n"${startQuote}"\nand ends with the message that begins:\n"${endQuote}"`;

// The Global Settings language, when one is set: the memory is written in it too.
const inLanguage = language => (language ? `\nWrite the gist, the chapter and the facts in ${language}.` : "");

export function summaryTask({ startQuote, endQuote, ledgerText, previousGist, foldGists, language }) {
    const fold = foldGists && foldGists.length
        ? `\n<arc>One line, at most 30 words, covering these earlier chapters together:\n${foldGists.map(g => `- ${g}`).join("\n")}\n</arc>`
        : "";
    return `${TASK_MARKER}: this is not a story turn. Do not continue the roleplay or write as any character.]

Summarize one stretch of the chat above into the story memory. ${stretch(startQuote, endQuote)}
Use only what happens inside that stretch; everything before it is already in the memory.

The fact ledger so far (ids in front, already known):
${ledgerText}

The previous chapter: ${previousGist || "(this is the first chapter)"}

Answer with exactly these tags and nothing else:
<chapter_gist>One line, at most 25 words: what happened in this stretch.</chapter_gist>
<chapter>
120 to 250 words. The events in order: what people did, said, decided, revealed or lost, and how relationships shifted. Past tense, plain and concrete. Names, places and objects exactly as the story uses them. Nothing that did not happen, no interpretation, no style. Explicit or violent content is summarized plainly, never softened or left out.
</chapter>
<fact_changes>
One change per line, and only for durable facts: things still true after this scene.
+ category | a new fact
~ F12 | the new wording of a fact this stretch changed
- F7 | why a fact stopped being true
Categories: person, relationship, place, item, condition, promise, secret, world, thread.
Write none if nothing durable changed.
</fact_changes>${fold}${inLanguage(language)}`;
}

/** Folding only: when there is nothing new to summarize but too many gists are waiting. */
export function foldTask(gists) {
    return `${TASK_MARKER} FOLD: this is not a story turn. Do not continue the roleplay or write as any character.]

These are consecutive chapter summaries from the story memory, oldest first:
${gists.map(g => `- ${g}`).join("\n")}

Answer with exactly one tag and nothing else:
<arc>One line, at most 30 words, covering all of them together.</arc>`;
}

export function checkTask({ startQuote, endQuote, gist, chapter, changesText, language }) {
    return `${TASK_MARKER} CHECK: this is not a story turn. Do not continue the roleplay or write as any character.]

Below is a summary of one stretch of the chat above. ${stretch(startQuote, endQuote)}

<chapter_gist>${gist}</chapter_gist>
<chapter>
${chapter}
</chapter>
<fact_changes>
${changesText}
</fact_changes>

Compare it against those messages. Look for anything stated that did not happen or is wrong, important events or decisions left out, names or details changed, fact changes that are wrong or missing, and content that was softened or skipped.
If the summary is accurate, answer with exactly: OK
Otherwise answer with corrected versions of all three tags, in the same format, and nothing else.${inLanguage(language)}`;
}
