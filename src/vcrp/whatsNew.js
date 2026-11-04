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

export const WHATS_NEW_ID = "10.0.0-vcrp.12";

const ITEMS = [
    "<b>Megumin Suite V11's 04/11 update</b>, in VCRP's terms (this release and the two before it together). Its engines, thinking and writing texts are unchanged; what came is around them.",
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
    toastr.info("New, from Megumin V11's 04/11 update: the Notebook tab; custom blocks with fields, rules and memory; the story lists who is in the scene; the Gemini JB add-on (re-import your preset to use it); group chats save. Details in Global Settings → What's new.", "VCRP " + WHATS_NEW_ID, { timeOut: 15000 });
}

/** The card at the top of Global Settings, with a "Got it" button (#vcrp_whats_new_ok). */
export function whatsNewCardHtml() {
    return `
        <div class="mtab-panel" id="vcrp_whats_new" style="margin:0; border-color: rgba(45,212,191,0.4);">
            <div class="mtab-panel-title" style="color:#2dd4bf;"><i class="fa-solid fa-gift"></i> What's new in VCRP ${WHATS_NEW_ID}</div>
            ${ITEMS.map(i => `<div class="set-desc" style="margin:6px 0;">${i}</div>`).join("")}
            <div class="mtab-callout gold" style="margin:10px 0 0;">
                <i class="fa-solid fa-file-import"></i>
                <span><b>Re-import your preset to use Gemini JB.</b> The add-on needs a spot in the preset and a new regex: re-import VCRP V10 Universal, VCRP V10 Megumin Original or VCRP V11 Megumin Original from the extension's Presets folder, replacing the old one, then allow its regex (Extensions → Regex). Everything else works on the preset you have; Setup Check says if yours is from before the add-on.</span>
            </div>
            <div style="margin-top:10px;"><button id="vcrp_whats_new_ok" class="ps-modern-btn primary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Got it</button></div>
        </div>`;
}
