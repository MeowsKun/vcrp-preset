// ─────────────────────────────────────────────────────────────────────────────
// VCRP: what's new after an update, said once.
//
// Updating the extension (git pull, or SillyTavern's updater) does not update a preset the
// reader already imported, and a feature that needs a new preset tag does nothing until the
// preset is imported again. So a release says so once: a toast when SillyTavern starts, a
// dot on the settings gear, and a card at the top of Global Settings until "Got it".
// A fresh install starts with it seen. For the next release: bump WHATS_NEW_ID, rewrite
// the list.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced } from "../st.js";
import { extensionName } from "../core/constants.js";

export const WHATS_NEW_ID = "10.0.0-vcrp.16";

const ITEMS = [
    "<b>When a reply comes back empty, the reply itself says why.</b> A reply that did not end normally now carries a small line under it, from the provider's own stop reason: <i>No reply: the provider's content filter stopped it (PROHIBITED_CONTENT)</i>, <i>No reply: the output limit was used up before the story</i>, <i>No reply: the request failed</i>, <i>Cut short by the output limit</i>. Tap it for who served the request, what was written and read, and the limit and what set it. It stays with the message. Setup Check still lists the open chat's empty replies by cause, with <b>Copy empty-reply details</b>.",
    "<b>A reply the provider's content filter stopped is the provider's decision.</b> VCRP says so, with the provider's own word, and leaves the request as it was: it does not retry it, and nothing in a later request changes because a reply came back empty. The line 10.0.0-vcrp.15 added to such a swipe, and the marker it added to the prompt's start (which also made the next request rewrite the whole cache), are gone. A reply that <i>nothing</i> explains (the model ended its turn with nothing written, or the answer could not be read) is still sent once more by itself, as it was; that now works on any SillyTavern (its own swipe call, the plain right swipe, or the swipe button), and says so when it cannot. A reply that is <i>all thinking</i> (the model ended its turn inside its thinking, or never closed it) is said for what it is: whatever it wrote sits in the thinking. Setup Check counts those too, and when this chat has had some on a model that reasons by itself, it says to turn Chain of Thought off.",
    "<b>The Safety cap no longer starves a model that reasons before it writes.</b> On Gemini, DeepSeek, GLM (and Claude with a reasoning effort set) the reasoning is paid for in the request's limit without being part of the reply, so a request limited to the cap itself could be used up by it and come back with nothing. The cap now stands for the reply you see: the request allows the cap plus room for the reasoning (half again the most this chat's recent replies used, by the API's own count, and never less than 6,000). VCRP's own background calls are not limited on such a model either. Setup Check shows the number, and warns when SillyTavern's own Max Response Length is under 8,000 there, or when CoT Prefill is forced on for a model that refuses one.",
    "<b>A background job can no longer take over a reply.</b> While the Story Director, an NPC scan, the ban list scan, a style generator, a Focus audit or a Story Memory summary was running, a reply sent at the same moment could be built as that job's prompt instead of the story's. Each job's prompt is now told by its own marker, so a reply sent meanwhile is always a story prompt; a job that stays with your story model keeps SillyTavern's connection while the Helper works on its own; and a background call that never answers is given up on after six minutes instead of holding everything it was waiting with.",
    "<b>From 10.0.0-vcrp.14: the Helper, a second model for the blocks and the background jobs</b> (new tab; Megumin V11's Chomusuke, in VCRP's terms). Pick a SillyTavern connection profile (or your current connection) and press Test. With <b>Blocks</b> on, the helper writes the scene list, World State, Bonds, the sheets and your custom blocks after each reply, so the story model writes only the story and none of its blocks come back cut off; the story model reads where the blocks stood instead. The occasional jobs (NPC scans, the Story Director, the ban list scan, the writing-style generator; Story Memory summaries and Focus audits if you choose) can go to it too. Each job is sent straight to the profile: your story connection never changes. A pill at the bottom of the screen shows a running job, with Stop; a reply you send while the helper still writes the last reply's blocks waits for it. The helper's calls are not counted in Story Memory's spend.",
    "<b>Model Setup</b> (the first tab; Megumin V11's loadouts, in VCRP's terms): pick the model you play with (Gemini Pro, Gemini Flash, Claude, Big open models, Fast models) and see the settings tested for it (the engine, Chain of Thought and its cap, the story length, Immersive HTML, Gemini JB, the CoT prefill, the Safety cap, the helper). A popup lists what <b>Use this loadout</b> would change before anything is written; every character, or this one only. Optional: skipping it breaks nothing.",
    "<b>The NPC Bank knows a short name</b> (Megumin V11's name finder): \"Resha\" for Resha Helios, a nickname, a name in brackets. An update by a short name applies, a dossier for someone already on file fills that record's empty fields instead of making a second one, the short name is kept as a nickname (shown on the card), and the scene list finds a character by it. Never a guess between two who fit.",
    "<b>From 10.0.0-vcrp.13: empty replies on Gemini, the cause found and fixed.</b> A model that reasons before it writes (Gemini, DeepSeek, GLM; Claude with a reasoning effort set) pays for that reasoning inside the request's output limit, and VCRP could not see its size. So the limit VCRP set from your replies' measured size (tightest on the first reply after a break in a long chat) was used up by the reasoning on a hard turn, and the reply came back with nothing in it. On such a model VCRP no longer lowers the request's limit on its own: <b>Hold each reply to the target</b> still shows the room but leaves the limit to your Safety cap and SillyTavern's Max Response Length. Megumin never set that limit, which is why it did not happen there.",
    "<b>Every reply now says how it ended.</b> VCRP reads the answer to each request as it passes (a copy; nothing SillyTavern reads is touched) and keeps the provider's stop reason, the output as billed (reasoning counted) and the limit the request went out with. A blank reply's note now says what really happened: the output limit and what set it, the provider's filter with its own word (Gemini's <code>PROHIBITED_CONTENT</code>, <code>SAFETY</code>...), or an error. <b>Setup Check</b> lists how your last five replies ended; look there first when replies come back empty. The cost badge shows the output as the API billed it, hidden reasoning included.",
    "<b>Gemini 4 and Chain of Thought.</b> Setup Check now notes, on Gemini 4, that Megumin Suite's Gemini loadout keeps custom thinking off there (the model reasons on its own); if replies come back as reasoning with no story, turn Chain of Thought off in Presets & CoT.",
    "<b>From the three releases before this one</b>, Megumin Suite V11's 04/11 update in VCRP's terms (its engines, thinking and writing texts unchanged; what came is around them):",
    "<b>The Notebook tab</b>, as V11 has it: the Author's Notebook has moved out of the Focus tab into a tab of its own. Each live truth is hidden until you ask to see it, then editable (saved as you leave a box), its clues listed by message and removable; <b>Add a truth</b> gives you an empty one to write yourself, not given to the story until its Truth box is filled in; <b>Past</b> is a timeline of the truths that came out, each with Activate again. While the notebook is on, World State stops asking for each character's Secret and for Planted Seeds (the notebook keeps the hidden things, as in V11), unless you keep them with the new switch.",
    "<b>Custom blocks, as V11 has them</b> (BLOCKS tab, Create custom block, or the pen on one): a block holds <b>fields</b> (meters drawn as bars, lists as chips, each with what it means and how it changes in your words) or free text; a <b>rules box</b> for the whole block (meters are no longer held to 10 points a reply); what the story <b>remembers</b> of it (carried forward with the block instructions, as every block; starts fresh; or its copies stay in the chat); <b>when</b> it is written (every reply, only when it changes, every few replies); <b>one list for every character</b>, so a block made for one shows under Add a block for all, with Delete block for all of them; a renamed block still reads its old copies.",
    "<b>Who is in the scene</b> (BLOCKS tab, on): the story lists who is there at the end of every reply (Here, and Remote for a call or a text), first in the blocks, and is handed one name per character to write in every block. The NPC Bank sends everyone listed first, Remember every character brings back someone listed, Existing cast only counts them, Bonds follow the list, and the final check asks for the blocks with the list first. Sent while World State, Bonds or NPC Inner Chatter is in the block; switch it off there to save the forty or so output tokens a reply.",
    "<b>Gemini JB</b>, a new add-on (Global Toggles & Add-ons), for Gemini: it helps the model through gritty and heavy NSFW scenes without cutting the reply off. V11's two lines, word for word: one that says the request complies with the adult fiction policy, at the end of the last message, and one that asks for a <b>^</b> before every word of the reply. VCRP takes the ^ out as each reply arrives, so you never see them; the presets' new \"clean up\" regex hides them while a reply streams. Each ^ costs an output token, so it is for Gemini alone: Setup Check says when it is on for another model, when Gemini runs without it, and when your preset is from before it. Not for NSFL.",
    "<b>The final check asks for the blocks</b> on a turn that has them (\"The response ends with the &lt;Blocks&gt; section.\"), on every engine on the V11 preset and in the second call for missing blocks, so fewer replies end without them.",
    "<b>Group chats save.</b> A repaired reply, a cleaned one, a chat with its dashes cleaned: everything VCRP saves to a chat used to be refused by SillyTavern in a group chat (Megumin's fix).",
]

const settings = () => extension_settings[extensionName] && extension_settings[extensionName].globalSettings;

export function hasUnseenWhatsNew() {
    const gs = settings();
    return Boolean(gs) && gs.whatsNewSeen !== WHATS_NEW_ID;
}

export function markWhatsNewSeen() {
    const gs = settings();
    if (!gs) return;
    gs.whatsNewSeen = WHATS_NEW_ID;
    saveSettingsDebounced();
}

/** Once, when SillyTavern is ready: the one thing that needs doing. */
export function whatsNewToast() {
    if (!hasUnseenWhatsNew() || typeof toastr === "undefined") return;
    toastr.info("New: a reply that comes back empty says why, under the reply itself; the Safety cap no longer starves a model that reasons before it writes; a background job can no longer take over a reply. Details in Global Settings → What's new.", "VCRP " + WHATS_NEW_ID, { timeOut: 15000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>Nothing to re-import for this release.</b> If you have not re-imported your preset since 10.0.0-vcrp.10, do so to use the Gemini JB add-on: it needs a spot in the preset and a new regex (re-import VCRP V10 Universal, VCRP V10 Megumin Original or VCRP V11 Megumin Original from the extension's Presets folder, replacing the old one, then allow its regex under Extensions → Regex). Setup Check says if yours is from before the add-on.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
