// Cache and Story Memory over real turns, everything on, the way SillyTavern builds the prompt.
//
// The other tests build a fixed history; this one builds it from the chat after each reply, with
// the preset's own prompt-only regex applied at each message's depth (as SillyTavern does), on
// the user's route (OpenRouter + Claude Opus 4.6, VCRP's cache marks, Story Memory on): a Pura
// engine with trackers, rolls and a random voice, Tone Rules, Existing cast only, the one-shot
// direction, Dialogue Colors learning a new character each turn, the NPC Bank growing, the
// <think> block, every reply through the MESSAGE_RECEIVED handlers in index.js's order. It checks
// that what each request cached is read back byte for byte by the next one (a swipe, a Continue
// and a Story Memory summary call included), that everything that changes per turn sits after
// the cached part, and that the reply's size is measured as the model wrote it.
//
// Run from the repo root:  node tools/test_cache.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_DIR = process.cwd();
const { REPO, buildFakeTree, installBrowserGlobals } = await import(pathToFileURL(join(REPO_DIR, "tools/st_stub.mjs")).href);

let pass = 0, fail = 0;
const ok = (cond, what, detail = "") => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? `\n      ${detail}` : ""}`); } };
const section = t => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 70 - t.length))}`);

// ── Fake SillyTavern ─────────────────────────────────────────────────────────
const extension_settings = {};
const chatCompletionSettings = { chat_completion_source: "openrouter", openrouter_model: "anthropic/claude-opus-4.6" };
const chat = [];
const ctx = {
    characters: [{ avatar: "mara.png", name: "Mara", data: {} }], characterId: 0, groupId: null, groups: [], chatId: "compliance-chat",
    chat, chatMetadata: {}, name1: "Bob", name2: "Mara", chatCompletionSettings,
    extensionSettings: extension_settings, eventSource: { on() {}, emit: async () => {} },
};
const CARD = "Mara is a sardonic bartender at the Lantern. She swears freely and deflects with dry jokes.";
const substituteParams0 = s => String(s).replaceAll("{{user}}", "Bob").replaceAll("{{char}}", "Mara")
    .replaceAll("{{description}}", CARD).replaceAll("{{personality}}", "Guarded, funny, blunt.").replaceAll("{{scenario}}", "").replaceAll("{{persona}}", "Bob, a regular.");
const meta = {};
let gen = null;
globalThis.__ST__ = {
    extension_settings, getContext: () => ctx, substituteParams,
    saveSettingsDebounced() {}, saveMetadata: async () => {}, saveChat() {}, chat_metadata: meta, isGenerating: () => false,
    debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now",
    generateQuietPrompt: async () => "",
    event_types: new Proxy({}, { get: (t, k) => String(k) }), eventSource: { on() {}, once() {}, emit: async () => {}, removeListener() {} },
};
installBrowserGlobals();
globalThis.extension_settings = extension_settings;
globalThis.toastr = { info() {}, success() {}, warning() {}, error() {} };

// SillyTavern's own per-request macros, rolling for real.
function substituteParams(s) {
    let t = substituteParams0(s);
    for (let guard = 0; guard < 50 && /\{\{random::/.test(t); guard++) {
        t = t.replace(/\{\{random::((?:(?!\{\{random::)[\s\S])*?)\}\}/, (m, body) => { const opts = body.split("::"); return opts[Math.floor(Math.random() * opts.length)]; });
    }
    return t.replace(/\{\{roll:1d100\}\}/g, () => String(1 + Math.floor(Math.random() * 100)));
}
globalThis.__ST__.substituteParams = substituteParams;

const { ext } = buildFakeTree(`compliance-${process.pid}`);
const imp = p => import(pathToFileURL(join(ext, p)).href);
const { handlePromptInjection } = await imp("src/engine/injection.js");
const { initProfile } = await imp("src/core/profile.js");
const state = await imp("src/core/state.js");
gen = await imp("src/vcrp/generation.js");
const memory = await imp("src/vcrp/memory/index.js");
const cc = await imp("src/vcrp/cacheCheck.js");
const { TASK_MARKER } = await imp("src/vcrp/memory/prompts.js");
const { meguminSyncLegacyBlockIds } = await imp("src/features/blocks/registry.js");
const handlers = {
    cost: (await imp("src/vcrp/replyCost.js")).vcrpCostOnReply,
    oneShot: (await imp("src/vcrp/oneShot.js")).vcrpOneShotOnReply,
    memCount: memory.vcrpMemoryCountReply,
    tidy: (await imp("src/vcrp/pura/tidy.js")).vcrpPuraTidyOnReply,
    rolls: (id, type) => import(pathToFileURL(join(ext, "src/vcrp/pura/rolls.js")).href).then(m => m.vcrpPuraRollsOnReply(id, type, { show: true })),
    dedash: (await imp("src/vcrp/dedash.js")).vcrpDedashOnReply,
    colors: (await imp("src/vcrp/dialogueColors.js")).vcrpDialogueColorsOnReply,
};
const tone = await imp("src/vcrp/toneRules.js");
const castLock = await imp("src/vcrp/castLock.js");
const oneShot = await imp("src/vcrp/oneShot.js");
initProfile();
const q = state.localProfile;

// ── The prompt SillyTavern builds: the preset, the chat with its prompt-only regex applied ──
const preset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
const promptOnly = preset.extensions.regex_scripts.filter(r => r.promptOnly && !r.disabled && !r.markdownOnly);
const stRegex = (text, depth) => {
    let t = text;
    for (const r of promptOnly) {
        if (r.minDepth != null && depth < r.minDepth) continue;
        if (r.maxDepth != null && depth > r.maxDepth) continue;
        const m = r.findRegex.match(/^\/([\s\S]*)\/([a-z]*)$/);
        t = t.replace(new RegExp(m[1], m[2]), r.replaceString || "");
    }
    return t;
};
let dropLast = false;
function buildPrompt() {
    const byId = Object.fromEntries(preset.prompts.map(x => [x.identifier, x]));
    const order = preset.prompt_order.find(x => x.character_id === 100001).order;
    const inChat = order.filter(o => o.enabled && byId[o.identifier] && byId[o.identifier].injection_position === 1).map(o => byId[o.identifier]);
    const out = [];
    for (const o of order) {
        if (!o.enabled) continue;
        const p = byId[o.identifier];
        if (!p || inChat.includes(p)) continue;
        if (p.identifier === "chatHistory") {
            const story = chat.filter(m => !m.is_system).slice(0, dropLast ? -1 : undefined);
            const msgs = story.map((m, i) => ({ role: m.is_user ? "user" : "assistant", content: m.is_user ? m.mes : stRegex(m.mes, story.length - 1 - i) }));
            for (const inj of inChat) {
                const content = substituteParams(inj.content || "");
                if (content) msgs.splice(Math.max(0, msgs.length - (inj.injection_depth || 0)), 0, { role: inj.role || "system", content });
            }
            out.push(...msgs);
            continue;
        }
        const role = p.marker ? "system" : p.role || "system";
        const content = p.marker ? (p.identifier === "charDescription" ? CARD : `[${p.name}]`) : substituteParams(p.content || "");
        if (!content) continue;
        if (role === "system" && out.at(-1)?.role === "system") out.at(-1).content += "\n" + content;
        else out.push({ role, content });
    }
    return out;
}
const textOf = m => typeof m.content === "string" ? m.content : m.content.map(p => p.text || "").join("");
const marked = msgs => msgs.map((m, i) => (Array.isArray(m.content) && m.content.some(p => p.cache_control)) ? i : -1).filter(i => i >= 0);
const prefix = (m, upTo) => m.slice(0, upTo + 1).map(textOf);
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `message ${i}: ${JSON.stringify(String(a[i]).slice(-160))} → ${JSON.stringify(String(b[i]).slice(-160))}`; return ""; };

async function send(kind = "normal") {
    if (kind === "normal") chat.push({ is_user: true, name: "Bob", send_date: `u${chat.length}`, mes: `Bob says something, turn ${chat.length}.` });
    gen.vcrpSetGenerationType(kind, {}, false);
    dropLast = kind === "swipe";
    const msgs = buildPrompt();
    dropLast = false;
    await handlePromptInjection({ chat: msgs, dryRun: false });
    return msgs;
}
// The model's reply for turn i: thinking, a colored line from a character new this turn, a stray
// sheet for them in the story, an OOC note, then its blocks.
const NAMES = ["Ann", "Bea", "Cole", "Dex", "Eve", "Finn", "Gus"];
const replyFor = i => {
    const who = NAMES[i % NAMES.length];
    return `<think>Turn ${i}: Mara pushes back; ${who} watches.</think>\n<font color="#000080" title="Mara">"Ring's gone,"</font> Mara says — flat. <font color="#ff69b4" title="${who}">"Not my problem."</font>\n\n[NPC:MINOR|${who}]\nb: ${who} | 30 | Regular\na: Quiet\np: Wry\n[/NPC]\n\n((OOC: Kinks rolled: none.))\n\n<Blocks>\n<Pura_Scene>\n[SCENE|The Lantern|Night ${i}|Rain]\ndetail: neon on wet glass\n[/SCENE]\n</Pura_Scene>\n${i === 1 ? "<Pura_Events>\n[EVENT|🎯 QUEST|Find the brass ring|Friday]\ncontext: pawned for rent\n[/EVENT]\n</Pura_Events>\n" : ""}</Blocks>`;
};
async function arrive(i, type = "normal") {
    const text = replyFor(i);
    if (type === "swipe") {
        const m = chat[chat.length - 1];
        m.swipes = [...(m.swipes || [m.mes]), text]; m.swipe_id = m.swipes.length - 1; m.mes = text;
    } else chat.push({ is_user: false, name: "Mara", send_date: `a${chat.length}`, mes: text, swipes: [text], swipe_id: 0, swipe_info: [{}] });
    const id = chat.length - 1;
    for (const h of ["cost", "oneShot", "memCount", "tidy", "rolls", "dedash", "colors"]) await handlers[h](id, type);
    // The NPC Bank files the sheet (index.js does this after the handlers above).
    const who = NAMES[i % NAMES.length];
    if (!q.npcBank.npcs.some(n => n.name === who)) q.npcBank.npcs.push({ name: who });
    return chat[id];
}

// ── Setup: everything on ─────────────────────────────────────────────────────
q.mode = "pura-adapted";
q.pura = { voice: "random", randomisers: ["deadDove", "chaos"], nameRandomiser: true, reasoning: "procedure", showRolls: true, keepRolls: false, groundedProse: true, html: true };
q.addons = [...new Set([...(q.addons || []), "color"])];
q.vcrpMemory.enabled = true;
q.npcBank = { ...(q.npcBank || {}), enabled: true, npcs: [] };
q.blockStack.order = ["pura_scene", "pura_events", "pura_npc"];
q.focus = { enabled: true, every: 20, checks: { drift: true, motifs: true, slop: true } };
meguminSyncLegacyBlockIds();
meta.vcrp_tone = { enabled: true, text: "Bleak. No rescues." };
castLock.setCastLock(true);
chat.push({ is_user: false, name: "Mara", send_date: "a0", mes: "\"We're closed,\" Mara says." });

// ── Turns ────────────────────────────────────────────────────────────────────
section("five turns, everything on: what the last turn cached is what this one reads");
cc.vcrpCacheCheckReset();
const prompts = [];
for (let t = 1; t <= 5; t++) {
    if (t % 2) oneShot.setOneShot(`Turn ${t}: Mara finally says why.`);
    const p = await send("normal");
    prompts.push(p);
    await arrive(t);
    const rep = cc.vcrpCacheCheckReport();
    if (t > 1) ok(rep && !cc.vcrpCacheCheckTrouble(rep), `turn ${t}: ${rep ? (cc.vcrpCacheCheckTrouble(rep) ? `TROUBLE: ${rep.text || JSON.stringify(rep.change).slice(0, 240)}` : "only the newest messages changed") : "no report"}`);
    if (t > 1) {
        const prev = prompts.at(-2), mkPrev = marked(prev), mk = marked(p);
        const a = prefix(prev, mkPrev.at(-1)), b = prefix(p, mk.at(-2));
        ok(JSON.stringify(a) === JSON.stringify(b), `turn ${t}: the previous turn's cached part is read back byte for byte`, firstDiff(a, b));
    }
}
const last = prompts.at(-1);
const mk = marked(last);
ok(mk.length === 2, `VCRP's two cache marks (${mk})`);
const cachedText = prefix(last, mk.at(-1)).join("\n");
const allText = last.map(textOf).join("\n");
const PER_TURN = [
    ["Tone Rules", tone.TONE_HEADER], ["Existing cast only", castLock.CAST_LOCK_HEADER], ["the one-shot direction", oneShot.ONESHOT_HEADER],
    ["the colors already taken", "Colors already taken in this story"], ["the carried trackers", "Trackers still in effect"],
    ["Pura's think line", "Open every reply with your own <think> block"], ["a rolled randomiser", "### Dead Dove Escalation"],
    ["the rolled voice", "In the style of"], ["the skill roll / rolls notes", "Rolled this reply"],
];
for (const [what, s] of PER_TURN) {
    if (s === oneShot.ONESHOT_HEADER || s === "Rolled this reply") { ok(!cachedText.includes(s), `${what}: never in the cached part`); continue; }
    ok(allText.includes(s) && !cachedText.includes(s), `${what}: sent, and after the cached part`);
}
ok(!/<think>|Turn \d: Mara pushes back/.test(cachedText), "the replies' thinking is stripped from the history (the preset's cleanup), every reply alike");
ok(!/\[NPC:MINOR\||\(\(OOC|<Blocks>|<Pura_/.test(last.slice(0, mk.at(-1) + 1).filter(m => m.role === "assistant").map(textOf).join("\n")),"no tracker, OOC note or block in the cached history: tidied into <Blocks> on arrival, blocks stripped");
ok(allText.includes("Characters already in the story include: Mara, Bob, Bea, Cole, Dex, Eve (and anyone"),"the cast list grows with the NPC Bank (after the cached part)");

// ── A swipe and a Continue read the same cache ───────────────────────────────
section("a swipe and a Continue of the newest reply");
const swipeP = await send("swipe");
const mkS = marked(swipeP), mkL = marked(prompts.at(-1));
ok(JSON.stringify(prefix(prompts.at(-1), mkL.at(-1))) === JSON.stringify(prefix(swipeP, mkS.at(-1))), "a swipe reads the same cached part as the request that wrote the reply", firstDiff(prefix(prompts.at(-1), mkL.at(-1)), prefix(swipeP, mkS.at(-1))));
await arrive(6, "swipe");
const contP = await send("continue");
const mkC = marked(contP);
ok(mkC.length >= 1 && JSON.stringify(prefix(swipeP, mkS.at(-1))) === JSON.stringify(prefix(contP, mkC.at(-2) ?? mkC.at(-1))), "a Continue reads the cached part too");

// ── Story Memory's summary call reuses the roleplay prompt's cache ────────────
section("Story Memory: a summary call reads the roleplay prompt's cache");
const rp = await send("normal");
await arrive(7);
const rpMk = marked(rp);
memory.setMemoryTaskActive(true, null);
gen.vcrpSetGenerationType("quiet", {}, false);
const summary = buildPrompt();
summary.push({ role: "system", content: `${TASK_MARKER}: not a story turn.] Summarize the stretch.` });
await handlePromptInjection({ chat: summary, dryRun: false });
memory.setMemoryTaskActive(false);
const sMk = marked(summary);
const sumText = summary.map(textOf).join("\n");
ok(sMk.length >= 1, `the summary call is marked for the cache (${sMk})`);
const rpRead = prefix(rp, rpMk.at(-1)), sumRead = prefix(summary, sMk.at(-2) ?? sMk.at(-1));
ok(JSON.stringify(rpRead.slice(0, sumRead.length)) === JSON.stringify(sumRead), "the summary's cached part matches the roleplay prompt's, byte for byte", firstDiff(rpRead, sumRead));
for (const [what, s] of PER_TURN) ok(!sumText.includes(s), `${what}: not in the summary call`);
ok(sumText.includes("Summarize the stretch"), "the task is there");
const spend = meta.vcrp_memory && meta.vcrp_memory.spend;
const asWritten = memory.estimateTokens(replyFor(7));
ok(spend && spend.last && spend.last.output === asWritten, `Story Memory measured the last reply as the model wrote it (${spend && spend.last && spend.last.output} vs ${asWritten})`);
const cost = chat[chat.length - 1].extra && chat[chat.length - 1].extra.vcrp_cost;
ok(cost && cost.output === asWritten && !cost.cold, "the cost badge too, on a warm cache");

console.log(`\n${fail ? `${fail} PROBLEM(S)` : "ALL CHECKS PASSED"} (${pass} passed)`);
process.exit(fail ? 1 : 0);
