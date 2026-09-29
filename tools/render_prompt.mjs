// Writes the exact prompt VCRP would send for each engine to tools/out/, and prints its size.
// Run from the repo root after `python tools/build_preset.py`:   node tools/render_prompt.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "tools", "out");
const settings = {};
globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: settings, saveSettingsDebounced() {},
        chatCompletionSettings: { chat_completion_source: "makersuite", google_model: "gemini-2.5-pro" },
        substituteParams: s => s.replaceAll("{{user}}", "{{user}}"),
        characters: [], characterId: null, groupId: null,
    }),
};
const { onPromptReady } = await import(pathToFileURL(join(REPO, "src/inject.js")).href);
const state = await import(pathToFileURL(join(REPO, "src/state.js")).href);
const { ENGINES } = await import(pathToFileURL(join(REPO, "src/content.js")).href);

const preset = JSON.parse(readFileSync(join(REPO, "Presets/VCRP V9.json"), "utf8"));
const byId = Object.fromEntries(preset.prompts.map(p => [p.identifier, p]));
mkdirSync(OUT, { recursive: true });

for (const engine of ENGINES) {
    state.getProfile().engine = engine.id;
    const msgs = [];
    for (const o of preset.prompt_order[1].order) {
        if (!o.enabled) continue;
        const q = byId[o.identifier];
        const content = q.marker ? `[[${q.name}]]` : q.content;
        const role = q.marker ? "system" : q.role;
        if (role === "system" && msgs.at(-1)?.role === "system") msgs.at(-1).content += "\n" + content;
        else msgs.push({ role, content });
    }
    await onPromptReady({ chat: msgs, dryRun: false });
    const text = msgs.map(m => `===== ${m.role.toUpperCase()} =====\n${m.content}`).join("\n\n");
    writeFileSync(join(OUT, `prompt_${engine.id}.txt`), text);
    const split = msgs.findIndex(m => m.content.includes("[[Chat History]]"));
    const before = msgs.slice(0, split + 1).map(m => m.content).join("").length;
    const tok = n => Math.round(n / 3.8);
    console.log(`${engine.id.padEnd(6)} ≈${tok(text.length)} tokens (before history ≈${tok(before)}, after ≈${tok(text.length - before)}) → tools/out/prompt_${engine.id}.txt`);
}
