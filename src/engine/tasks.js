// ──────────────────────────────────────────────────────────────────────────────
// Running a one-off generation through SillyTavern.
//
// The pattern throughout: park a payload in activeRequests, fire a quiet prompt
// that the injection handler recognises, clear the payload in a finally. The
// handler throws away the preset's messages and builds the task's own, so no
// task depends on which preset is active.
//
// VCRP: Megumin V10 also switched the active preset to a separate "Engine" preset
// for some tasks. VCRP ships no Engine preset, so useMeguminEngine just runs the
// task; it is kept so every call site stays identical to upstream.
// ──────────────────────────────────────────────────────────────────────────────

import { generateQuietPrompt } from "../st.js";
import { extensionName } from "../core/constants.js";
import { setActiveBanListChat, setActiveGenerationOrder } from "../core/activeRequests.js";
import { vcrpCountBackgroundOutput } from "../vcrp/memory/index.js";

export async function analyzeSlopDirectly(chatText) {
    setActiveBanListChat(chatText);
    try {
        let rawOutput = await generateQuietPrompt({ prompt: "___PS_BANLIST___" });
        vcrpCountBackgroundOutput(rawOutput);
        return rawOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (e) {
        console.error(`[${extensionName}] Ban List Analysis Failed:`, e);
        return null;
    } finally {
        setActiveBanListChat(null);
    }
}

export async function analyzeSlopWithPreset(chatText) {
    let result = null;
    await useMeguminEngine(async () => {
        // We still use the interceptor! This just makes the engine switch first.
        result = await analyzeSlopDirectly(chatText);
    });
    return result;
}

// Runs a background task. (Upstream: switched to the Engine preset first, then back.)
export async function useMeguminEngine(task, _targetPreset) {
    try {
        await task();
    } catch (e) {
        console.error(`[${extensionName}] AI Error:`, e);
    }
}

// A free-form "order" for the AI (style generators etc.). The injection handler
// replaces the whole prompt with the task prompt built in buildOrderTaskMessages().
export async function runMeguminTask(orderText) {
    setActiveGenerationOrder(orderText);
    try {
        const out = await generateQuietPrompt({ prompt: "___PS_DUMMY___" });
        vcrpCountBackgroundOutput(out);
        return out;
    } finally {
        setActiveGenerationOrder(null);
    }
}
