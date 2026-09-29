// VCRP V9: SillyTavern roleplay extension. Pairs with Presets/VCRP V9.json.

import { cleanOrphanProfiles } from "./src/state.js";
import { onPromptReady, setGenerationType } from "./src/inject.js";
import { mountUi, onChatChanged } from "./src/ui.js";

// Folder this extension was installed into (works for any folder name).
const extensionFolder = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

jQuery(() => {
    try {
        const { eventSource, eventTypes } = SillyTavern.getContext();
        mountUi(extensionFolder);
        eventSource.on(eventTypes.GENERATION_STARTED, setGenerationType);
        eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
        eventSource.on(eventTypes.APP_READY, cleanOrphanProfiles);
    } catch (e) {
        console.error("[VCRP] Failed to load:", e);
    }
});
