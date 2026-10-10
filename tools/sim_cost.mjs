// Cost simulator: plays a long chat through VCRP's real prompt builder and prices every
// request under Anthropic prompt caching, the way SillyTavern + OpenRouter apply it.
//
//   node tools/sim_cost.mjs                        # 1000 messages, Opus 5.5, 1-hour cache, OpenRouter
//   node tools/sim_cost.mjs --memory --npcs        # with VCRP's budgeted memory on
//   node tools/sim_cost.mjs --model opus-4.6 --ttl 5m --context 64000 --direct
//
// Options
//   --messages N     chat length to play out (default 1000)
//   --model ID       opus-5.5, opus-4.6, sonnet-5.5 (default opus-5.5)
//   --ttl 5m|1h      cache lifetime; SillyTavern's claude.extendedTTL picks 1h (default 1h)
//   --depth N        SillyTavern's claude.cachingAtDepth (default 0)
//   --context N      SillyTavern's context size in tokens; older messages are dropped past it
//                    one by one, the way SillyTavern trims (default: no limit)
//   --direct         connect to Anthropic directly instead of through OpenRouter. OpenRouter
//                    moves every system-role message into Claude's one system prompt
//                    (SillyTavern issue #5227); VCRP answers that by sending after-chat text as
//                    user messages. Direct, SillyTavern keeps system messages where they are.
//   --no-fix         OpenRouter, but without VCRP's after-chat-as-user fix (for comparison)
//   --memory         VCRP's budgeted memory on. Summaries are stand-ins (sized like real
//                    ones), each priced as a request that reuses the prompt's cache, plus a
//                    check pass.
//   --enable-at N    with --memory: switch it on only at message N, as on an existing long chat
//   --target USD     the memory's per-request target (default 0.30)
//   --npcs           NPC Bank on with six NPCs whose names come and go in the chat, so the
//                    retrieved-NPC list changes from turn to turn
//   --engine ID      ukiyo | shura | pura-adapted | pura-original (default ukiyo)
//   --extras         everything added since the Pura engines, on: Pura's random voice, two
//                    randomisers, Grounded Prose and HTML; five Pura trackers in the block,
//                    which the replies write (so the carried state and their output are real);
//                    Tone Rules, Existing cast only, a one-shot direction every fourth turn,
//                    Dialogue Colors, a Focus correction and a plot focus
//   --budget USD     the per-request ceiling to report against (default 0.30)
//   --tokfactor F    Claude tokens per cl100k token; the newer Claude tokenizer runs larger (default 1.15)
//   --seed N         chat/timing randomness (default 7)
//
// The chat is built from real English sentences (the preset's own prose) and sized like
// roleplay: replies of 350-600 tokens (thinking and blocks already stripped from history, as
// the preset's regex does), user turns of 40-160, a few minutes between turns, occasional
// breaks, and a night off every ~120 messages. Output per request = the reply + the visible
// CoT + hidden thinking.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { REPO, buildFakeTree, installBrowserGlobals } from "./st_stub.mjs";

const require = createRequire(import.meta.url);
const { getEncoding } = require("js-tiktoken");
const enc = getEncoding("cl100k_base");

// ── options ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : (argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? true : argv[i + 1]); };
const N = +opt("messages", 1000);
const MODEL = opt("model", "opus-5.5");
const TTL = opt("ttl", "1h");
const DEPTH = +opt("depth", 0);
const CONTEXT = +opt("context", Infinity);
const DIRECT = !!opt("direct", false);
const HOIST = !DIRECT;
const NOFIX = !!opt("no-fix", false);
const MEMORY = !!opt("memory", false);
const ENABLE_AT = +opt("enable-at", 0);   // Story Memory switched on only from this message (an existing long chat)
const TARGET = +opt("target", 0.30);
const NPCS = !!opt("npcs", false);
const NPC_NAMES = ["Mara", "Jonah", "Ilse", "Teo", "Ruth", "Dez"];
const ENGINE = opt("engine", "ukiyo");
const EXTRAS = !!opt("extras", false);
const ORIGINAL = !!opt("original", false);   // the Megumin Original engine and preset
// Whose cache markers: "vcrp" (the last two replies, VCRP's default on OpenRouter + Claude)
// or "st" (SillyTavern's cachingAtDepth). Direct Anthropic always uses SillyTavern's.
const MARKS = DIRECT ? "st" : String(opt("marks", "vcrp"));
// A provider that reads the cache only where a marker matches exactly (Bedrock), rather than
// also looking back for an older marker (Anthropic's own API).
const EXACT = !!opt("exact", false);
const PRESET = ORIGINAL ? "VCRP V10 Megumin Original.json" : "VCRP V10 Universal.json";
const BUDGET = +opt("budget", 0.30);
const TOKFACTOR = +opt("tokfactor", 1.15);
const SEED = +opt("seed", 7);

// $ per million tokens. Cache writes are 1.25x input on the 5-minute cache, 2x on the 1-hour one.
const PRICES = {
    "opus-5.5": { input: 4, output: 20, read: 0.20, openrouter: "anthropic/claude-opus-5.5", direct: "claude-opus-5-5" },
    "opus-4.6": { input: 5, output: 25, read: 0.50, openrouter: "anthropic/claude-opus-4.6", direct: "claude-opus-4-6" },
    "sonnet-5.5": { input: 2, output: 10, read: 0.20, openrouter: "anthropic/claude-sonnet-5.5", direct: "claude-sonnet-5-5" },
};
const price = PRICES[MODEL];
if (!price) throw new Error(`unknown --model ${MODEL}; known: ${Object.keys(PRICES).join(", ")}`);
const WRITE = price.input * (TTL === "1h" ? 2 : 1.25);
const TTL_MS = (TTL === "1h" ? 60 : 5) * 60 * 1000;
const VISIBLE_COT = 400, HIDDEN_THINKING = 800;   // output tokens per reply on top of the prose
const SUMMARY_OUT = 1500, CHECK_OUT = 500;        // a chapter + fact changes (+ thinking); the check pass

// ── synthetic chat ───────────────────────────────────────────────────────────
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(SEED);
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
// Real English prose to build messages from: the sentences of the preset's own text.
const SENTENCES = (() => {
    // Always the same source, so --original changes the prompt and not the chat.
    const src = readFileSync(join(REPO, "Presets", "VCRP V10 Universal.json"), "utf8") + readFileSync(join(REPO, "data", "modes", "v10.js"), "utf8");
    return src.replace(/\\n/g, "\n").replace(/\[\[[^\]]*\]\]|\{\{[^}]*\}\}|<[^>]+>|[*`#>|]/g, " ")
        .split(/(?<=[.!?])\s+/).map(s => s.replace(/\s+/g, " ").replace(/^[-\s]+/, "").trim())
        .filter(s => s.length > 40 && s.length < 300 && /^[A-Za-z"]/.test(s));
})();
function textOfTokens(target, tag) {
    // Unique per message (the tag), so no two messages hash alike.
    let s = `(${tag}) `;
    while (enc.encode(s).length < target) s += SENTENCES[Math.floor(rand() * SENTENCES.length)] + " ";
    return s.trim();
}
const t0 = Date.UTC(2026, 9, 1, 18);
const chat = [{ is_user: false, name: "Alice", send_date: new Date(t0).toISOString(), mes: textOfTokens(between(350, 600), "greeting") }];
// --extras: the Pura trackers a reply writes, inside its <Blocks> (stripped from the history,
// but written as output, and read back as the carried state).
const trackerBlocks = i => `\n\n<Blocks>\n<Pura_Scene>\n[SCENE|The Lantern|Night ${i}|Rain]\ndetail: ${textOfTokens(18, `scene${i}`)}\n[/SCENE]\n</Pura_Scene>\n`
    + (i % 6 === 2 ? `<Pura_Events>\n[EVENT|🎯 QUEST|Errand ${i}|Friday]\ncontext: ${textOfTokens(20, `event${i}`)}\n[/EVENT]\n</Pura_Events>\n` : "")
    + (i % 4 === 2 ? `<Pura_Relationship>\n[METER|${NPC_NAMES[i % NPC_NAMES.length]}|Friendly|💚 STABLE|🌅 WARMING]\nroute: Slow Burn\nheart: ${textOfTokens(15, `heart${i}`)}\nmemory: ${textOfTokens(20, `mem${i}`)}\nnext: ${textOfTokens(10, `next${i}`)}\n[/METER]\n</Pura_Relationship>\n` : "")
    + (i % 10 === 4 ? `<Pura_NPC>\n[NPC:MINOR|Extra${i}]\nb: Extra${i} | 30 | Regular\na: ${textOfTokens(12, `npc${i}`)}\np: ${textOfTokens(10, `npcp${i}`)}\n[/NPC]\n</Pura_NPC>\n` : "")
    + `<Pura_Choices>\n[CHOICES]\n1. ${textOfTokens(10, `c1${i}`)}\n2. ${textOfTokens(10, `c2${i}`)}\n3. ${textOfTokens(10, `c3${i}`)}\n[/CHOICES]\n</Pura_Choices>\n</Blocks>`;
for (let i = 1; i < N; i++) {
    const user = i % 2 === 1;
    let mes = textOfTokens(user ? between(40, 160) : between(350, 600), `m${i}`);
    // A scene's cast drifts: each reply names one or two of the NPCs.
    if (NPCS && !user) mes += " " + [0, 1].map(() => NPC_NAMES[Math.floor(rand() * NPC_NAMES.length)]).join(" and ") + " were there.";
    if (EXTRAS && !user) mes += trackerBlocks(i);
    chat.push({ is_user: user, name: user ? "Bob" : "Alice", send_date: new Date(t0 + i * 1000).toISOString(), mes });
}
// Seconds between one request and the next: a few minutes of reading and writing, an
// occasional break, and a night off every ~120 messages.
function gapAfter(request) {
    if (request > 0 && request % 60 === 0) return 16 * 3600;     // 60 requests = 120 messages
    const r = rand();
    if (r < 0.02) return between(90, 240) * 60;
    if (r < 0.10) return between(10, 55) * 60;
    return between(60, 330);
}

// ── fake SillyTavern ─────────────────────────────────────────────────────────
const extension_settings = {};
const cc = DIRECT ? { chat_completion_source: "claude", claude_model: price.direct }
    : { chat_completion_source: NOFIX ? "openrouter-nofix" : "openrouter", openrouter_model: price.openrouter };
const ctxChat = [];
const chat_metadata = {};
const IGNORE = Symbol("ignore");
const ctx = {
    characters: [{ avatar: "alice.png", name: "Alice", data: {} }], characterId: 0, groupId: null, groups: [],
    chat: ctxChat, chatMetadata: chat_metadata, name1: "Bob", name2: "Alice", chatCompletionSettings: cc,
    extensionSettings: extension_settings, eventSource: { on() {}, emit: async () => {} }, mainApi: "openai",
    symbols: { ignore: IGNORE },
};
const CARD = "Alice is a 27-year-old bartender at the Lantern, a dockside bar in 1987 Baltimore. ".repeat(18);
const PERSONA = "Bob is a 30-year-old dockworker who just moved into the apartment above the Lantern. ".repeat(4);
const substituteParams = s => String(s).replaceAll("{{user}}", "Bob").replaceAll("{{char}}", "Alice");
globalThis.__ST__ = {
    extension_settings, getContext: () => ctx, substituteParams, saveSettingsDebounced() {}, saveMetadata() {}, saveChat() {},
    chat_metadata, isGenerating: () => false, debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now",
    generateQuietPrompt: async () => "", event_types: new Proxy({}, { get: (t, k) => String(k) }),
    eventSource: { on() {}, once() {}, emit: async () => {}, removeListener() {} },
};
installBrowserGlobals();
globalThis.extension_settings = extension_settings;
const { ext } = buildFakeTree(`sim-cost-${process.pid}`);   // one tree per run, so runs can go side by side
const imp = p => import(pathToFileURL(join(ext, p)).href);
const { handlePromptInjection } = await imp("src/engine/injection.js");
const { initProfile } = await imp("src/core/profile.js");
const state = await imp("src/core/state.js");
const { vcrpSetGenerationType } = await imp("src/vcrp/generation.js");
const mem = await imp("src/vcrp/memory/index.js");
const S = await imp("src/vcrp/memory/summarize.js");
const CACHE = await imp("src/vcrp/memory/cache.js");
const L = await imp("src/vcrp/memory/ledger.js");
await imp("src/vcrp/memory/index.js");         // registers globalThis.vcrp_memory_intercept
const { meguminCleanChatHistoryText } = await imp("src/engine/chatText.js");
initProfile();
Object.assign(state.localProfile, ENGINE === "shura"
    ? (ORIGINAL ? { mode: "v10-shura-megumin", model: "cot-meg-shura-english" } : { mode: "v10-shura", model: "cot-v10-shura-english" })
    : /^pura-/.test(ENGINE) ? { mode: ENGINE, model: "cot-v10-ukiyo-english" }
        : (ORIGINAL ? { mode: "v10-ukiyo-megumin", model: "cot-meg-ukiyo-english" } : { mode: "v10-core", model: "cot-v10-ukiyo-english" }),
    { cotEnabled: true });
if (EXTRAS) {
    const p = state.localProfile;
    p.pura = { voice: "random", randomisers: ["deadDove", "chaos"], groundedProse: true, html: true };
    p.blockStack.order = ["pura_npc", "pura_scene", "pura_relationship", "pura_events", "pura_choices"];
    (await imp("src/features/blocks/registry.js")).meguminSyncLegacyBlockIds();
    p.addons = [...new Set([...(p.addons || []), "color"])];
    p.focus = { enabled: true, every: 20, checks: { drift: true, motifs: true, slop: true } };
    chat_metadata.vcrp_tone = { enabled: true, text: "Bleak and unsentimental. Violence lands hard and stays; no rescues, no softening, no last-minute mercy. Humour only ever as gallows humour." };
    chat_metadata.vcrp_cast_lock = { enabled: true };
    chat_metadata.vcrp_focus = { note: "Stop ending scenes on a held breath; vary the closing beats. Mara's speech has gone soft: keep her clipped and sardonic.", items: [], plot: { active: true, text: "The ring Mara pawned, and the people who want it back.", strength: "central", endAfter: 0 } };
    chat_metadata.vcrp_colors = { names: { alice: { name: "Alice", color: "#ff69b4" }, bob: { name: "Bob", color: "#87cefa" }, mara: { name: "Mara", color: "#ffd700" } } };
}
const oneShot = EXTRAS ? await imp("src/vcrp/oneShot.js") : null;
if (NPCS) {
    state.localProfile.npcBank.enabled = true;
    state.localProfile.npcBank.npcs = NPC_NAMES.map(name => ({ name, appearance: `${name}'s look, described in two plain sentences.`, role: "regular at the Lantern", agenda: `what ${name} wants this week` }));
}
if (MEMORY) {
    state.localProfile.vcrpMemory.enabled = true;
    // Review off: the simulation has nobody to approve chapters, so they count at once.
    extension_settings.VCRP.globalSettings.memoryBudget = { ttl: TTL, targetCost: TARGET, review: false };
}

// ── prompt assembly (what SillyTavern hands VCRP, then what VCRP hands back) ─
const preset = JSON.parse(readFileSync(join(REPO, "Presets", PRESET), "utf8"));
const byId = Object.fromEntries(preset.prompts.map(x => [x.identifier, x]));
const order = preset.prompt_order.find(x => x.character_id === 100001).order.filter(o => o.enabled && byId[o.identifier]);
Object.assign(cc, { prompts: preset.prompts, prompt_order: preset.prompt_order });   // the active preset, as SillyTavern holds it
const MARKER_TEXT = { charDescription: CARD, personaDescription: PERSONA };

const tokMemo = new Map();
const tokens = s => { let n = tokMemo.get(s); if (n === undefined) { n = Math.ceil(enc.encode(s).length * TOKFACTOR); tokMemo.set(s, n); } return n; };

// In-chat slots (injection_position 1, e.g. Output RULES at depth 1) go inside the chat,
// `injection_depth` messages from the end, not where the slot order lists them.
const inChat = order.map(o => byId[o.identifier]).filter(q => q.injection_position === 1);
function buildPrompt(history) {
    const out = [];
    for (const o of order) {
        const q = byId[o.identifier];
        if (inChat.includes(q)) continue;
        if (q.identifier === "chatHistory") {
            const chatMsgs = history.map(m => ({ role: m.is_user ? "user" : "assistant", content: m.mes }));
            for (const inj of [...inChat].sort((a, b) => (b.injection_depth || 0) - (a.injection_depth || 0))) {
                const content = substituteParams(inj.content || "");
                if (content) chatMsgs.splice(Math.max(0, chatMsgs.length - (inj.injection_depth || 0)), 0, { role: inj.role || "system", content });
            }
            out.push(...chatMsgs);
            continue;
        }
        const content = q.marker ? (MARKER_TEXT[q.identifier] || "") : substituteParams(q.content || "");
        if (!content) continue;
        const role = q.marker ? "system" : q.role || "system";
        // SillyTavern's "squash system messages": neighbouring system messages become one.
        if (role === "system" && out.at(-1)?.role === "system") out.at(-1).content += "\n" + content;
        else out.push({ role, content });
    }
    return out;
}

// SillyTavern's context trim: drop the oldest history messages until the prompt fits.
function fitContext(history) {
    if (!Number.isFinite(CONTEXT)) return history;
    const fixed = buildPrompt([]).reduce((n, m) => n + tokens(m.content), 0);
    let total = fixed + history.reduce((n, m) => n + tokens(m.mes), 0);
    let start = 0;
    while (total > CONTEXT && start < history.length - 1) total -= tokens(history[start++].mes);
    return history.slice(start);
}

// SillyTavern's cachingAtDepthForOpenRouterClaude: skip a trailing assistant prefill, skip
// system messages, count role switches from the end, mark depth D and D+2.
function breakpoints(msgs) {
    const marks = [];
    let passedPrefill = false, depth = 0, prev = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (!passedPrefill && msgs[i].role === "assistant") continue;
        passedPrefill = true;
        if (msgs[i].role === "system") continue;
        if (msgs[i].role !== prev) {
            if (depth === DEPTH || depth === DEPTH + 2) marks.push(i);
            if (depth === DEPTH + 2) break;
            depth++;
            prev = msgs[i].role;
        }
    }
    return marks;
}

// ── Anthropic prompt caching ─────────────────────────────────────────────────
// An entry is the exact prefix up to a block carrying a breakpoint. A request reads the
// longest prefix that some live entry covers, writes from there up to its last breakpoint,
// and pays plain input for everything after it. Reads and writes refresh the entry's timer.
const digest = s => createHash("sha1").update(s).digest("hex");
const digMemo = new Map();
const contentDigest = s => { let d = digMemo.get(s); if (!d) { d = digest(s); digMemo.set(s, d); } return d; };
const cache = new Map();   // prefix hash -> last use (ms)

function price1(msgs, now, outTokens) {
    // The prompt as text: VCRP may already have turned a marked message into parts. Where the
    // markers go is decided here (MARKS), from the text.
    msgs = msgs.map(m => ({ ...m, content: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map(p => (p && p.text) || "").join("") : "" }));
    // Through OpenRouter every system message is pulled to the front, as one system prompt.
    let blocks = msgs.map((m, i) => ({ ...m, bp: false, i }));
    const marks = new Set(MARKS === "st" ? breakpoints(msgs) : CACHE.cacheMarkIndices(msgs));
    blocks.forEach(b => { b.bp = marks.has(b.i); });
    if (HOIST) {
        const sys = blocks.filter(b => b.role === "system");
        blocks = [{ role: "system", content: sys.map(b => b.content).join("\n"), bp: false }, ...blocks.filter(b => b.role !== "system")];
    }
    let h = "", cum = 0, lastBp = -1;
    const pref = blocks.map((b, i) => {
        h = digest(h + b.role + contentDigest(b.content));
        cum += tokens(b.content);
        if (b.bp) lastBp = i;
        return { h, cum };
    });
    const total = cum;
    let read = 0, hitAt = -1;
    for (let i = (lastBp >= 0 ? lastBp : -1); i >= 0; i--) {
        if (EXACT && !blocks[i].bp) continue;   // no look-back: only this request's own markers
        const t = cache.get(pref[i].h);
        if (t !== undefined && now - t <= TTL_MS) { read = pref[i].cum; hitAt = i; break; }
    }
    const cachedEnd = lastBp >= 0 ? pref[lastBp].cum : 0;
    const write = Math.max(0, cachedEnd - read);
    const plain = total - Math.max(read, cachedEnd);
    if (hitAt >= 0) cache.set(pref[hitAt].h, now);
    blocks.forEach((b, i) => { if (b.bp) cache.set(pref[i].h, now); });
    const cost = (read * price.read + write * WRITE + plain * price.input + outTokens * price.output) / 1e6;
    return { total, read, write, plain, cost };
}

// ── the summarizer, with stand-in answers ────────────────────────────────────
// The real code picks the stretch (summarize.js nextSpan), saves the chapter, applies the
// fact changes and folds old gists (commitChapter); only the model's answers are stand-ins,
// sized like real ones: a 25-token gist, a ~200-token chapter, two new facts and one retired
// per chapter. Like the extension, at most one chapter per reply. Each chapter costs two
// calls on the reply's own prompt with an instruction appended (they read the cache).
const upkeep = { calls: 0, cost: 0 };
let chapterNo = 0;
function summarizeAfterReply(full, lastPrompt, replyText, now) {
    const st = mem.memoryState();
    const budget = mem.currentMemoryBudget();
    ctxChat.length = 0; ctxChat.push(...full);
    const span = S.nextSpan(full, st, budget);
    if (!span) return;
    const ask = [...lastPrompt, { role: "assistant", content: replyText }, { role: "user", content: textOfTokens(450, `summarize ${now}`) }];
    const s = price1(ask, now + 20000, SUMMARY_OUT);
    const c = price1(ask, now + 35000, CHECK_OUT);
    upkeep.calls += 2; upkeep.cost += s.cost + c.cost;
    st.lastRequestAt = now + 35000;
    chapterNo++;
    const ops = [
        { op: "+", cat: "person", text: textOfTokens(20, `fact a${chapterNo}`) },
        { op: "+", cat: "thread", text: textOfTokens(20, `fact b${chapterNo}`) },
    ];
    if ((st.ledger || []).length > 12) ops.push({ op: "-", id: st.ledger[0].id, reason: "resolved" });
    const fold = L.gistsToFold(st.chapters || []);
    S.commitChapter(st, full, {
        start: mem.anchorOf(full, span.start), end: mem.anchorOf(full, span.end), from: span.start, to: span.end - 1,
        gist: textOfTokens(25, `gist ${chapterNo}`), chapter: textOfTokens(200, `chapter ${chapterNo}`), ops,
        arc: fold.length ? textOfTokens(30, `arc ${chapterNo}`) : "", foldIds: fold.map(x => x.id), checked: "ok", created: now,
    });
}

// ── play it out ──────────────────────────────────────────────────────────────
const rows = [];
let now = t0;
let cuts = 0, overFloor = 0, overSummaries = 0;
mem.setMemoryClock(() => now);
for (let t = 1; t < N; t += 2) {            // each user message triggers one request
    const full = chat.slice(0, t + 1);
    if (MEMORY) state.localProfile.vcrpMemory.enabled = t + 1 >= ENABLE_AT;
    ctxChat.length = 0; ctxChat.push(...full);
    vcrpSetGenerationType("normal", {}, false);
    const core = full.map(m => ({ ...m }));
    await globalThis.vcrp_memory_intercept(core, 1e9, () => {}, "normal");
    const plan = MEMORY ? mem.memoryState().lastPlan : null;
    if (plan && plan.cut) {
        cuts++;
        if (process.env.SIM_TRACE) {
            const st = mem.memoryState(), b = mem.currentMemoryBudget();
            console.log(`cut at msg ${t + 1}: ${plan.reason} · est prompt ${plan.promptTokens} vs cold budget ${b.coldTokens} · summaries reach msg ${mem.resolveAnchor(full, st.summarized)} · cut at msg ${mem.resolveAnchor(full, st.cut)} · fixed ${st.fixedTokens}`);
        }
    }
    if (plan && plan.limit === "verbatim floor") overFloor++;
    if (plan && plan.limit === "summaries") overSummaries++;
    const history = fitContext(core.filter(m => !(m.extra && m.extra[IGNORE])));
    if (oneShot && rows.length % 4 === 0) oneShot.setOneShot("She finally tells him about the ring, and it costs her.");
    const msgs = buildPrompt(history);
    await handlePromptInjection({ chat: msgs, dryRun: false });
    const replyText = chat[t + 1] ? chat[t + 1].mes : "";
    const reply = replyText ? tokens(replyText) : 450;
    const r = price1(msgs, now, reply + VISIBLE_COT + HIDDEN_THINKING);
    rows.push({ msg: t + 1, inHistory: history.length, cut: !!(plan && plan.cut), ...r });
    if (oneShot) oneShot.setOneShot("");   // used up by the reply
    if (MEMORY && t + 1 >= ENABLE_AT && chat[t + 1]) summarizeAfterReply(chat.slice(0, t + 2), msgs, replyText, now + 60000);
    now += gapAfter(rows.length) * 1000;
}

// ── report ───────────────────────────────────────────────────────────────────
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const costs = rows.map(r => r.cost);
const sum = a => a.reduce((x, y) => x + y, 0);
const label = `${MEMORY ? `MEMORY on${ENABLE_AT ? ` from msg ${ENABLE_AT}` : ""} (target $${TARGET}) · ` : ""}${NPCS ? "NPC Bank on · " : ""}${MODEL} · ${TTL} cache · depth ${DEPTH} · ${Number.isFinite(CONTEXT) ? `context ${CONTEXT}` : "no context limit"} · ${DIRECT ? "direct Anthropic" : NOFIX ? "OpenRouter WITHOUT the fix" : "OpenRouter"} · ${ENGINE}${ORIGINAL ? " · Megumin Original" : ""}${EXTRAS ? " · EXTRAS (Pura trackers, randomisers, Tone Rules, cast lock, one-shot, Focus, plot focus, colors)" : ""} · markers: ${MARKS === "st" ? "SillyTavern" : "VCRP"}${EXACT ? " · exact-match provider (Bedrock)" : ""}`;
console.log(`\n${label}`);
console.log(`${rows.length} requests over ${N} messages · replies $${sum(costs).toFixed(2)}${MEMORY ? ` + memory upkeep $${upkeep.cost.toFixed(2)} (${upkeep.calls} calls) = $${(sum(costs) + upkeep.cost).toFixed(2)}` : ""}`);
console.log(`per request: mean $${(sum(costs) / costs.length).toFixed(3)} · median $${q(costs, 0.5).toFixed(3)} · p90 $${q(costs, 0.9).toFixed(3)} · max $${Math.max(...costs).toFixed(3)}`);
console.log(`over the $${BUDGET.toFixed(2)} budget: ${costs.filter(c => c > BUDGET).length} requests · cache misses (write > half the prompt): ${rows.filter(r => r.write > r.total / 2).length}${MEMORY ? ` · cuts ${cuts} · cuts held back by the verbatim floor ${overFloor} / by summaries ${overSummaries}` : ""}`);
console.log("\n  msg   prompt    read   write   plain    cost");
for (const m of [10, 50, 100, 200, 400, 600, 800, 1000]) {
    const r = rows.find(x => x.msg >= m);
    if (r) console.log(`${String(r.msg).padStart(5)} ${String(r.total).padStart(8)} ${String(r.read).padStart(7)} ${String(r.write).padStart(7)} ${String(r.plain).padStart(7)}   $${r.cost.toFixed(3)}${r.cut ? "  (cut)" : ""}`);
}
if (MEMORY) {
    const st = mem.memoryState();
    const full = L.composeMemoryText({ arcs: st.arcs || [], chapters: st.chapters || [], ledger: st.ledger || [] });
    console.log(`memory at the end: ${(st.chapters || []).length} chapters (${(st.arcs || []).length} arcs), ${(st.ledger || []).length} facts kept, ${(st.retired || []).length} retired · memory text ~${tokens(full)} tokens (carried now: ~${tokens(st.shown || "")})`);
}
const worst = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 3);
console.log(`\nmost expensive: ${worst.map(r => `msg ${r.msg} $${r.cost.toFixed(3)} (${r.total} tok${r.cut ? ", cut" : ""})`).join(" · ")}`);
mkdirSync(join(REPO, "tools", "out"), { recursive: true });
const file = join(REPO, "tools", "out", `sim_${MODEL}_${TTL}_d${DEPTH}${MEMORY ? "_memory" : ""}${NPCS ? "_npcs" : ""}${Number.isFinite(CONTEXT) ? `_c${CONTEXT}` : ""}${DIRECT ? "_direct" : NOFIX ? "_nofix" : ""}${ORIGINAL ? "_original" : ""}${/^pura-/.test(ENGINE) ? `_${ENGINE}` : ""}${EXTRAS ? "_extras" : ""}_${MARKS}${EXACT ? "_exact" : ""}.csv`);
writeFileSync(file, "msg,in_history,prompt_tokens,read,write,plain,cost,cut\n" + rows.map(r => [r.msg, r.inHistory, r.total, r.read, r.write, r.plain, r.cost.toFixed(4), r.cut ? 1 : 0].join(",")).join("\n"));
console.log(`per-request rows: ${file}`);
