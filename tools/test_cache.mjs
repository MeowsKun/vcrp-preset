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
let preset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8"));
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

async function send(kind = "normal", said = null) {
    if (kind === "normal") chat.push({ is_user: true, name: "Bob", send_date: `u${chat.length}`, mes: said || `Bob says something, turn ${chat.length}.` });
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
let replyFor = i => {
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

// ── V11 Тайна on its own preset ───────────────────────────────────────────────
// The Author's Notebook (written, then updated), a character who leaves the scene and comes
// back (Characters on file), V11's Content section in the chat: all of it after the cached
// part, the history read back byte for byte, and a summary call that leaves V11's story-turn
// slots out and still reads the cache.
section("V11 Тайна on its own preset: notebook and returning characters after the cached part");
preset = JSON.parse(readFileSync(join(REPO, "Presets", "VCRP V11 Megumin Original.json"), "utf8"));
chat.length = 0;
for (const k of Object.keys(meta)) delete meta[k];
Object.assign(q, { mode: "v11-room-megumin", model: "cot-v11-english", activeStyleId: "dir_v11",
    aiRule: "an overt narrator teller with a voice and opinions, present in every paragraph. Do not write as an effaced narrator or a camera." });
q.pura = {};
q.blockStack.order = ["world", "bonds"];
meguminSyncLegacyBlockIds();
q.npcBank = { ...(q.npcBank || {}), enabled: true, npcs: [] };
meta.vcrp_tone = { enabled: true, text: "Bleak. No rescues." };
castLock.setCastLock(true);
chat.push({ is_user: false, name: "Mara", send_date: "a0", mes: "\"We're closed,\" Mara says." });
replyFor = i => {
    const guest = i <= 2 ? "Ann" : "Cole";   // Ann leaves after turn 2
    const notebook = i === 1
        ? "<Notebook>\nT1\nTruth: Mara pawned the ring to pay off the man who burned her old bar.\nHidden from: Bob, the reader\nComes out when: Bob finds the pawn ticket\nWhat it changes: Bob stops trusting her\nClue ideas: a pawn ticket in the till; Mara flinching at the word fire\n</Notebook>\n"
        : i === 3 ? "<Notebook_Update>\nClue T1: Mara flinches when Bob mentions the fire\n</Notebook_Update>\n" : "";
    return `<think>Turn ${i}: the room weighs it.</think>\n<font color="#ff69b4" title="Mara">"Ring's gone,"</font> Mara says, and flinches at the word fire. ${guest} watches from the door.\n\n<Blocks>\n<World_State>\n**📅 Time:** Night ${i} | **🌤 Loc:** The Lantern | **🌡 Wx:** Rain\n\n---\n\n**🧍 Bob:**\n* *Outfit:* wet coat\n\n---\n\n**👥 NPCs Present:**\n**Mara:**\n* *Outfit:* black apron\n* *Mood:* guarded\n**${guest}:**\n* *Outfit:* ${guest === "Ann" ? "green raincoat, red scarf" : "denim jacket"}\n* *Mood:* curious\n</World_State>\n<Bonds>\nMara: Mood: guarded | Affection: 2${i} (+1 a joke) | Trust: 30 (=)\n${guest}: Mood: curious | Affection: 1${i} (=) | Trust: 20 (=)\n</Bonds>\n${notebook}</Blocks>`;
};
cc.vcrpCacheCheckReset();
const v11Prompts = [];
for (let t = 1; t <= 5; t++) {
    if (t % 2) oneShot.setOneShot(`Turn ${t}: Mara finally says why.`);
    const p = await send("normal", t === 5 ? "Bob asks Mara whether Ann ever came back for her scarf." : null);
    v11Prompts.push(p);
    await arrive(t);
    if (t > 1) {
        const rep = cc.vcrpCacheCheckReport();
        ok(rep && !cc.vcrpCacheCheckTrouble(rep), `V11 turn ${t}: ${rep ? (cc.vcrpCacheCheckTrouble(rep) ? `TROUBLE: ${JSON.stringify(rep.change).slice(0, 240)}` : "only the newest messages changed") : "no report"}`);
        const prev = v11Prompts.at(-2), mkPrev = marked(prev), mkNow = marked(p);
        const a = prefix(prev, mkPrev.at(-1)), b = prefix(p, mkNow.at(-2));
        ok(JSON.stringify(a) === JSON.stringify(b), `V11 turn ${t}: the previous turn's cached part is read back byte for byte`, firstDiff(a, b));
    }
}
const v11Last = v11Prompts.at(-1), v11Mk = marked(v11Last);
const v11Cached = prefix(v11Last, v11Mk.at(-1)).join("\n"), v11All = v11Last.map(textOf).join("\n");
ok(v11Cached.includes("You are a writers' room of five") && v11Cached.includes("NORA, the Director"), "V11's engine text is in the cached part");
for (const [what, s] of [["V11's Content section", "# Content (NORA)"], ["the live truths", "<Author_Notebook>"], ["the notebook's update rules", "write the Notebook_Update block only if"],
    ["the clue planted on turn 3", "Mara flinches when Bob mentions the fire"], ["Ann, back as she left", "Characters on file"], ["Ann's last outfit", "green raincoat, red scarf"],
    ["the {{user}} rule, item 5", "5. The response does not speak, think, feel, or act for Bob"], ["Tone Rules", tone.TONE_HEADER], ["Existing cast only", castLock.CAST_LOCK_HEADER]]) {
    ok(v11All.includes(s) && !v11Cached.includes(s), `${what}: sent, and after the cached part`);
}
ok(!v11All.includes("<The_Notebook>"), "V11 carries its own notebook craft: the shared one is not added");
ok(!/<Notebook|Truth: Mara pawned/.test(v11Last.slice(0, v11Mk.at(-1) + 1).filter(m => m.role === "assistant").map(textOf).join("\n")), "no notebook block in the cached history (stripped with the blocks)");
// Story Memory's summary call on the V11 preset.
const v11rp = await send("normal");
await arrive(6);
const v11RpMk = marked(v11rp);
memory.setMemoryTaskActive(true, null);
gen.vcrpSetGenerationType("quiet", {}, false);
const v11Sum = buildPrompt();
v11Sum.push({ role: "system", content: `${TASK_MARKER}: not a story turn.] Summarize the stretch.` });
await handlePromptInjection({ chat: v11Sum, dryRun: false });
memory.setMemoryTaskActive(false);
const v11SumText = v11Sum.map(textOf).join("\n"), v11SMk = marked(v11Sum);
ok(!v11SumText.includes("# Content (NORA)") && !v11SumText.includes("## your thinking steps:") && !v11SumText.includes("<Author_Notebook>"), "the summary call leaves V11's story-turn slots out (Output RULES known by its final check)");
const v11RpRead = prefix(v11rp, v11RpMk.at(-1)), v11SumRead = prefix(v11Sum, v11SMk.at(-2) ?? v11SMk.at(-1));
ok(v11SMk.length >= 1 && JSON.stringify(v11RpRead.slice(0, v11SumRead.length)) === JSON.stringify(v11SumRead), "and its cached part matches the roleplay prompt's, byte for byte", firstDiff(v11RpRead, v11SumRead));

// ── V11 Тайна (one voice) on its own preset ───────────────────────────────────
// The V11 Тайна turn frame: its Content section, story settings and repetition rule, the
// thinking, <formatting> and <final_check> all after the cached part; the history read back
// byte for byte; a summary call without any of them, still reading the cache.
section("V11 Тайна (one voice): its turn frame after the cached part");
chat.length = 0;
for (const k of Object.keys(meta)) delete meta[k];
Object.assign(q, { mode: "v11-voice-megumin", model: "cot-v11-voice-english", activeStyleId: "dir_v11_inside",
    aiRule: (await imp("data/directStyles.js")).directStyles.find(s => s.id === "dir_v11_inside").rule });
chat.push({ is_user: false, name: "Mara", send_date: "b0", mes: "\"We're closed,\" Mara says." });
cc.vcrpCacheCheckReset();
const voicePrompts = [];
for (let t = 1; t <= 4; t++) {
    const p = await send("normal");
    voicePrompts.push(p);
    await arrive(t);
    if (t > 1) {
        const rep = cc.vcrpCacheCheckReport();
        ok(rep && !cc.vcrpCacheCheckTrouble(rep), `V11 Тайна turn ${t}: ${rep ? (cc.vcrpCacheCheckTrouble(rep) ? `TROUBLE: ${JSON.stringify(rep.change).slice(0, 240)}` : "only the newest messages changed") : "no report"}`);
        const prev = voicePrompts.at(-2), a = prefix(prev, marked(prev).at(-1)), b = prefix(p, marked(p).at(-2));
        ok(JSON.stringify(a) === JSON.stringify(b), `V11 Тайна turn ${t}: the previous turn's cached part is read back byte for byte`, firstDiff(a, b));
    }
}
const voiceLast = voicePrompts.at(-1), voiceMk = marked(voiceLast);
const voiceCached = prefix(voiceLast, voiceMk.at(-1)).join("\n"), voiceAll = voiceLast.map(textOf).join("\n");
ok(voiceCached.includes("You are the narrator of an ongoing story") && voiceCached.includes("<banlist>") && voiceCached.includes("rides inside one character at a time"), "V11 Тайна's text, its ban list and V11 Inside are in the cached part");
for (const [what, s] of [["its Content section", "<content>\nThis story is rated"], ["its repetition rule", "<repetition>"], ["its final check", "<final_check>"], ["its formatting", "<formatting>"], ["its language line", "Write the response in English."]]) {
    ok(voiceAll.includes(s) && !voiceCached.includes(s), `${what}: sent, and after the cached part`);
}
const voiceRp = await send("normal");
await arrive(5);
memory.setMemoryTaskActive(true, null);
gen.vcrpSetGenerationType("quiet", {}, false);
const voiceSum = buildPrompt();
voiceSum.push({ role: "system", content: `${TASK_MARKER}: not a story turn.] Summarize the stretch.` });
await handlePromptInjection({ chat: voiceSum, dryRun: false });
memory.setMemoryTaskActive(false);
const voiceSumText = voiceSum.map(textOf).join("\n");
ok(!voiceSumText.includes("<final_check>") && !voiceSumText.includes("<content>\nThis story is rated") && !voiceSumText.includes("<repetition>"), "the summary call leaves V11 Тайна's story-turn sections out");
const voiceRpRead = prefix(voiceRp, marked(voiceRp).at(-1)), voiceSumMk = marked(voiceSum), voiceSumRead = prefix(voiceSum, voiceSumMk.at(-2) ?? voiceSumMk.at(-1));
ok(voiceSumMk.length >= 1 && JSON.stringify(voiceRpRead.slice(0, voiceSumRead.length)) === JSON.stringify(voiceSumRead), "and its cached part matches the roleplay prompt's, byte for byte", firstDiff(voiceRpRead, voiceSumRead));

// ── Pura on the V11 preset ────────────────────────────────────────────────────
// One preset for every engine: Pura there takes VCRP's own rules (as on V10 Universal), its
// ban list cached, its formatting rules and final reminder after the cached part, and a summary
// call leaves those out as it does on Universal.
section("Pura Director on the V11 preset: VCRP's rules, the cache read back");
chat.length = 0;
for (const k of Object.keys(meta)) delete meta[k];
Object.assign(q, { mode: "pura-original", model: "cot-v10-ukiyo-english" });
chat.push({ is_user: false, name: "Mara", send_date: "c0", mes: "\"We're closed,\" Mara says." });
cc.vcrpCacheCheckReset();
const puraPrompts = [];
for (let t = 1; t <= 4; t++) {
    const p = await send("normal");
    puraPrompts.push(p);
    await arrive(t);
    if (t > 1) {
        const rep = cc.vcrpCacheCheckReport();
        ok(rep && !cc.vcrpCacheCheckTrouble(rep), `Pura on V11, turn ${t}: ${rep ? (cc.vcrpCacheCheckTrouble(rep) ? `TROUBLE: ${JSON.stringify(rep.change).slice(0, 240)}` : "only the newest messages changed") : "no report"}`);
        const prev = puraPrompts.at(-2), a = prefix(prev, marked(prev).at(-1)), b = prefix(p, marked(p).at(-2));
        ok(JSON.stringify(a) === JSON.stringify(b), `Pura on V11, turn ${t}: the previous turn's cached part is read back byte for byte`, firstDiff(a, b));
    }
}
const puraLast = puraPrompts.at(-1);
const puraCached = prefix(puraLast, marked(puraLast).at(-1)).join("\n"), puraAll = puraLast.map(textOf).join("\n");
ok(puraCached.includes("**stripped articles:**") && puraCached.includes("**dashes:**"), "VCRP's ban list, dash rule included, in the cached part");
for (const [what, s] of [["VCRP's formatting rules", "- response_shape: |"], ["VCRP's final reminder", "## final reminder:\nBEFORE YOU OUTPUT, READ THIS LAST:"]]) {
    ok(puraAll.includes(s) && !puraCached.includes(s), `${what}: sent, and after the cached part`);
}
ok(!puraAll.includes("<final_check>") && !puraAll.includes("Before you output, check:"), "no Megumin final check");
const puraRp = await send("normal");
await arrive(5);
memory.setMemoryTaskActive(true, null);
gen.vcrpSetGenerationType("quiet", {}, false);
const puraSum = buildPrompt();
puraSum.push({ role: "system", content: `${TASK_MARKER}: not a story turn.] Summarize the stretch.` });
await handlePromptInjection({ chat: puraSum, dryRun: false });
memory.setMemoryTaskActive(false);
ok(!puraSum.map(textOf).join("\n").includes("READ THIS LAST"), "the summary call leaves VCRP's final reminder out");
const puraRpRead = prefix(puraRp, marked(puraRp).at(-1)), puraSumMk = marked(puraSum), puraSumRead = prefix(puraSum, puraSumMk.at(-2) ?? puraSumMk.at(-1));
ok(puraSumMk.length >= 1 && JSON.stringify(puraRpRead.slice(0, puraSumRead.length)) === JSON.stringify(puraSumRead), "and its cached part matches the roleplay prompt's, byte for byte", firstDiff(puraRpRead, puraSumRead));

// ── V11 Тайна · Adapted ───────────────────────────────────────────────────────
// V11's frame with VCRP's ban list: the list cached with the engine text, V11's final check
// (VCRP's dash line in it) after the cached part, and the summary call without it.
section("V11 Тайна · Adapted: VCRP's ban list cached, V11's final check after");
chat.length = 0;
for (const k of Object.keys(meta)) delete meta[k];
Object.assign(q, { mode: "v11-voice-adapted", model: "cot-v11-voice-english", activeStyleId: "dir_v11",
    aiRule: "an overt narrator teller with a voice and opinions, present in every paragraph. Do not write as an effaced narrator or a camera." });
chat.push({ is_user: false, name: "Mara", send_date: "d0", mes: "\"We're closed,\" Mara says." });
cc.vcrpCacheCheckReset();
const adPrompts = [];
for (let t = 1; t <= 4; t++) {
    const p = await send("normal");
    adPrompts.push(p);
    await arrive(t);
    if (t > 1) {
        const rep = cc.vcrpCacheCheckReport();
        ok(rep && !cc.vcrpCacheCheckTrouble(rep), `Adapted, turn ${t}: ${rep ? (cc.vcrpCacheCheckTrouble(rep) ? `TROUBLE: ${JSON.stringify(rep.change).slice(0, 240)}` : "only the newest messages changed") : "no report"}`);
        const prev = adPrompts.at(-2), a = prefix(prev, marked(prev).at(-1)), b = prefix(p, marked(p).at(-2));
        ok(JSON.stringify(a) === JSON.stringify(b), `Adapted, turn ${t}: the previous turn's cached part is read back byte for byte`, firstDiff(a, b));
    }
}
const adLast = adPrompts.at(-1);
const adCached = prefix(adLast, marked(adLast).at(-1)).join("\n"), adAll = adLast.map(textOf).join("\n");
ok(adCached.includes("You are the narrator of an ongoing story") && adCached.includes("**dashes:**"), "V11's engine text and VCRP's ban list, dash rule included, in the cached part");
ok(adAll.includes("<final_check>") && !adCached.includes("<final_check>") && /\d\. No em dashes/.test(adAll), "V11's final check, VCRP's dash line in it: sent, and after the cached part");
const adRp = await send("normal");
await arrive(5);
memory.setMemoryTaskActive(true, null);
gen.vcrpSetGenerationType("quiet", {}, false);
const adSum = buildPrompt();
adSum.push({ role: "system", content: `${TASK_MARKER}: not a story turn.] Summarize the stretch.` });
await handlePromptInjection({ chat: adSum, dryRun: false });
memory.setMemoryTaskActive(false);
ok(!adSum.map(textOf).join("\n").includes("<final_check>"), "the summary call leaves the final check out");
const adRpRead = prefix(adRp, marked(adRp).at(-1)), adSumMk = marked(adSum), adSumRead = prefix(adSum, adSumMk.at(-2) ?? adSumMk.at(-1));
ok(adSumMk.length >= 1 && JSON.stringify(adRpRead.slice(0, adSumRead.length)) === JSON.stringify(adSumRead), "and its cached part matches the roleplay prompt's, byte for byte", firstDiff(adRpRead, adSumRead));

console.log(`\n${fail ? `${fail} PROBLEM(S)` : "ALL CHECKS PASSED"} (${pass} passed)`);
process.exit(fail ? 1 : 0);
