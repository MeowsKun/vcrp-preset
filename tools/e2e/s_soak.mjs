// A soak in the real app: a long session with everything on, a model that writes as models do
// (threads reworded, a block left out now and then, a reply cut off or blank) and a reader who
// does what readers do, at random: sends, swipes, regenerates, continues, deletes, edits, hides
// old messages, queues beats, starts arcs, edits the blocks, opens the tabs, reloads the page.
// After every step: no page error, no error toast, the reply's request whole (no tag left,
// nothing after the chat a system message), and everything the new features keep still reads.
//   node tools/e2e/call.mjs tools/e2e/s_soak.mjs [steps=40] [seed=1] [helper|nohelper] [engine=v10-core]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function ({ rig, R, log, args }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const STEPS = Math.max(5, Number(args[0]) || 40);
    let seed = (Number(args[1]) || 1) >>> 0;
    const helperOn = args[2] !== "nohelper";
    const ENGINES = { "v10-core": "cot-v10-ukiyo-english", "v11-voice-megumin": "cot-v11-voice-english", "pura-adapted": "cot-v10-ukiyo-english" };
    const engine = ENGINES[args[3]] ? args[3] : "v10-core";
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = a => a[Math.floor(rnd() * a.length)];
    const chance = p => rnd() < p;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

    // ── The story the mock model tells ──
    const THREADS = [
        ["Who sent the unsigned letter to Mara?", "The unsigned letter's sender is still unknown", "Mara still does not know who sent the unsigned letter"],
        ["Jonah's debt to the harbourmaster", "Jonah's debt to the harbourmaster comes due on Friday", "The harbourmaster wants Jonah's debt paid in full"],
        ["The smuggler's ledger is missing", "Whoever holds the smuggler's ledger controls the docks", "The missing ledger of the smugglers has not turned up"],
        ["A stranger watches the Lantern from the pier", "The stranger on the pier is still watching the Lantern"],
        ["The landlord suspects Bob of hiding something", "Bob is hiding something, and the landlord suspects it"],
        ["Old Martin saw someone on the roof", "Someone was on the roof, Old Martin swears"],
    ];
    const THINGS = "anvil barrel candle dagger ember flask gauntlet hammer inkwell jar kettle lantern mallet needle oar pulley quill rope saddle tankard urn vial wagon yoke zither apron bell chisel drum easel fiddle goblet harp idol jug kiln ladle mug net oven pan quiver rake spade".split(" ");
    const TIMERS = [["Bob skipped the rent", "the landlord escalates"], ["Mara lied to the harbourmaster", "he checks her story"], ["The letter was left on the bar", "someone reads it"]];
    const NOTEBOOK = "<Notebook>\nT1\nTruth: Mara wrote the unsigned letter herself.\nHidden from: Bob\nComes out when: someone compares the handwriting\nWhat it changes: Bob's trust in her\nClue ideas: ink on her cuff\nT2\nTruth: Jonah's debt is Mara's doing.\nHidden from: Jonah\nComes out when: the ledger turns up\nWhat it changes: who owes whom\nClue ideas: her name in the margin\nT3\nTruth: Old Martin was on the roof himself.\nHidden from: everyone\nComes out when: his boots are found\nWhat it changes: who can be trusted\nClue ideas: tar on the sill\n</Notebook>\n";
    const w = { turn: 0, day: 1, open: [[0, 0], [1, 0], [2, 0]], seedTurns: 1, timer: 3, timerAt: 0, affection: 40, trust: 30, jonah: false, notebook: false };
    const advance = () => {
        w.turn++;
        if (w.turn % 6 === 0) w.day++;
        for (const t of w.open) if (chance(0.3)) t[1] = int(0, THREADS[t[0]].length - 1);
        if (chance(0.1) && w.open.length < 5) { const free = THREADS.map((x, i) => i).filter(i => !w.open.some(t => t[0] === i)); if (free.length) w.open.push([pick(free), 0]); }
        if (chance(0.08) && w.open.length > 2) w.open.splice(int(0, w.open.length - 1), 1);
        w.seedTurns++;
        // A timer counts down, lands, and after a while another is set (or none for a stretch).
        if (w.timer > 0) { if (chance(0.5)) w.timer--; } else if (chance(0.3)) { w.timerAt = (w.timerAt + 1) % (TIMERS.length + 1); w.timer = int(2, 5); }
        w.affection = Math.max(5, Math.min(95, w.affection + int(-3, 5)));
        w.trust = Math.max(5, Math.min(95, w.trust + int(-2, 4)));
        if (chance(0.15)) w.jonah = !w.jonah;
    };
    const blocks = () => `<Blocks>\n<Scene>\nHere: Mara${w.jonah ? ", Jonah" : ""}\nRemote:\n</Scene>\n<World_State>\n**📅 Time:** Day ${w.day}, ${pick(["dawn", "noon", "dusk", "night"])} | **🌤 Loc:** The Lantern | Saltmere | **🌡 Wx:** Rain\n\n---\n**👥 NPCs Present:**\n**Mara:**\n* *Outfit:* a wet coat\n* *Mood:* wary\n`
        + (w.jonah ? "**Jonah:**\n* *Outfit:* oilskins\n* *Mood:* tired\n" : "")
        + `\n---\n**📡 Off-Screen:**\n* Old Martin: mending nets\n${w.jonah ? "" : "* Jonah: at the docks\n"}\n---\n**🔥 Unresolved Threads:**\n${w.open.map(t => `* ${THREADS[t[0]][t[1]]}`).join("\n")}\n`
        + `**🌱 Planted Seeds:** the cracked locket | Mara's mother | ${w.seedTurns} turns\n**⏳ Consequence Timers:** ${TIMERS[w.timerAt] ? `${TIMERS[w.timerAt].join(" | ")} | ${w.timer} turns` : "none"}\n**🎯 Arc Phase:** Setup\n</World_State>\n`
        + `<Bonds>\nMara: Affection: ${w.affection}/100 (=) | Trust: ${w.trust}/100 (=)\n</Bonds>\n`
        // An engine that keeps the Author's Notebook asks for its truths until they are written.
        + (w.notebook ? NOTEBOOK : "") + "</Blocks>";
    const prose = () => {
        const thing = THINGS[w.turn % THINGS.length];
        const mara = w.turn < 30 ? `Tch. Do not waste my time with that ${thing}, kid.` : `Oh, I am so sorry, please, take all the time you need with the ${thing}, okay...`;
        // Long enough that Story Memory has chapters to write within a soak.
        const filler = `Rain worked at the shutters and the ${thing} sat between them on the bar, catching what light there was. ${"Bob turned it over once and set it down again; nobody in the Lantern looked up, and the tide went on pulling at the pier below the boards. ".repeat(16)}`;
        return `<think>\n1. Turn ${w.turn}: the Lantern, the ${thing}.\n2. Mara stays herself.\n</think>\nThe lamps burn low over the bar. ${filler}<font color="#a855f7" title="Mara">"${mara}"</font>`
            + (w.jonah ? ` Jonah shrugs. <font color="#38bdf8" title="Jonah">"Leave the ${thing} where it is, Mara, nobody is buying it."</font>` : "");
    };
    const reply = () => {
        const r = rnd();
        if (r < 0.03) return { kind: "blank", script: R.script({ content: "" }) };
        if (r < 0.07) return { kind: "cut", script: R.script({ content: `${prose()}\n\n<Blocks>\n<Scene>\nHere: Mara\n</Scene>\n<World_State>\n**📅 Time:** Day ${w.day}, du`, finish: "length", native: "MAX_TOKENS" }) };
        if (r < 0.13) return { kind: "no blocks", script: R.script({ content: prose() }) };
        if (r < 0.15) return { kind: "thinking left open", script: R.script({ content: `<think>\n1. Turn ${w.turn}: planning, and never closing the thought.` }) };
        return { kind: "whole", script: R.script({ content: `${prose()}\n\n${blocks()}` }) };
    };
    // Every other call (the helper's, a summary, an audit, a pitch): answered as its task asks.
    const stats = { blocksByHelper: 0, checks: 0, found: 0, summaries: 0, corrected: 0, folds: 0, audits: 0, picks: 0, pitches: 0, repairs: 0, other: 0 };
    rig.mock.aside = async b => {
        const t = textOf(b);
        if (/<established_facts>|<scene_before_this_reply>/.test(t)) {
            stats.checks++;
            if (!chance(0.2)) return "OK";
            stats.found++;
            const quote = ((t.match(/<reply>\n([\s\S]*?)\n<\/reply>/) || [])[1] || "").split(/\s+/).slice(0, 4).join(" ");
            return `CONTRADICTION: "${quote}" | The Lantern stands on the pier at Saltmere.`;
        }
        if (/Write these blocks for the moment/.test(t)) { stats.blocksByHelper++; await sleep(int(400, 2200)); return blocks(); }
        if (/\[VCRP MEMORY TASK CHECK/.test(t)) {
            if (chance(0.7)) return "OK";
            stats.corrected++;
            return `<chapter_gist>Corrected: Mara and Bob at the Lantern, turn ${w.turn}.</chapter_gist>\n<chapter>\n${"Mara kept the bar and Bob asked his questions; she gave little away. ".repeat(10)}\n</chapter>\n<fact_changes>\nnone\n</fact_changes>`;
        }
        if (/\[VCRP MEMORY TASK FOLD/.test(t)) { stats.folds++; return "<arc>The early days at the Lantern, when Mara gave nothing away.</arc>"; }
        if (/\[VCRP MEMORY TASK/.test(t)) {
            stats.summaries++;
            return `<chapter_gist>Mara and Bob talked at the Lantern about the ${THINGS[w.turn % THINGS.length]} (turn ${w.turn}).</chapter_gist>\n<chapter>\n${"Bob asked about the thing on the bar and Mara waved him off, curt as ever, while the rain kept on. ".repeat(8)}\n</chapter>\n<fact_changes>\n+ relationship | Mara tolerates Bob at her bar (as of turn ${w.turn}).\n</fact_changes>${/<arc>/.test(t) ? "\n<arc>The early days at the Lantern.</arc>" : ""}`;
        }
        if (/Audit the replies above for drift/.test(t)) {
            stats.audits++;
            return chance(0.3) ? "<recurring>none</recurring>\n<findings>none</findings>\n<note>none</note>"
                : `<recurring>none</recurring>\n<findings>\n- [slop] "the lamps burn low" opens nearly every reply\n- [drift] Mara apologises, which she never did\n</findings>\n<note>\nStop opening on the lamps. Keep Mara curt: short lines, no apologies (audit ${stats.audits}).\n</note>`;
        }
        if (/<chapters>/.test(t)) { stats.picks++; return chance(0.5) ? "C1" : "NONE"; }
        if (/Pitch three different arcs/.test(t)) {
            stats.pitches++;
            return ["The Ice Ledger|The harbourmaster calls in every debt at once.|A notice is nailed to the Lantern's door.", "What the Gulls Carry|Letters start arriving for the dead.|A gull drops a sealed tube on the bar.", "Mother's Locket|The locket's twin turns up in a pawnshop.|Mara finds the pawn ticket."]
                .map(p => p.split("|")).map(([a, b2, c2]) => `<pitch>\nTitle: ${a}\nPremise: ${b2}\nOpens with: ${c2}\n</pitch>`).join("\n");
        }
        if (/nothing before <Blocks> or after <\/Blocks>/.test(t)) { stats.repairs++; return blocks(); }
        stats.other++;
        return "OK.";
    };

    // ── The chat, with everything on ──
    await L.openChat(rig, { ...L.PROFILE, mode: engine, model: ENGINES[engine], blocks: undefined, blockStack: { order: ["world", "bonds"] }, notebook: { enabled: false },
        focus: { enabled: true, every: 5, checks: { drift: true, motifs: true, slop: true }, live: { swipes: true, repeats: true, user: true } }, vcrpMemory: { enabled: true } }, "VCRP V10 Universal");
    const setup = await rig.page.eval(async (base, helperOn) => {
        const c = window.SillyTavern.getContext();
        window.confirm = () => true;   // a native dialog would hold the page
        c.powerUserSettings.reasoning.auto_parse = false;
        const g = c.extensionSettings.VCRP.globalSettings;
        // A small target, so that Story Memory has chapters to write within the soak's length.
        g.memoryBudget = { ...(g.memoryBudget || {}), customPrice: { "google/gemini-4-argon": { input: 2, output: 2, read: 0.1 } }, minVerbatim: 2000, recallTokens: 400, review: true, autoApprove: true, ceilingCost: 0.5, targetCost: 0.03 };
        const cm = c.extensionSettings.connectionManager || (c.extensionSettings.connectionManager = { profiles: [] });
        cm.profiles = (cm.profiles || []).filter(p => p.id !== "e2e-helper");
        cm.profiles.push({ id: "e2e-helper", name: "E2E helper", mode: "cc", api: "openrouter", model: "google/gemini-4-argon", preset: "Default" });
        g.helper = { enabled: !!helperOn, profileId: "e2e-helper", testedProfileId: "e2e-helper", jobs: {}, blockRoutes: {} };
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        const state = await import(base + "src/core/state.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
        const canon = await import(base + "src/vcrp/canon.js");
        canon.addCanon("The Lantern stands on the pier at Saltmere.");
        await c.saveMetadata();
        return { helper: g.helper.enabled, mode: state.localProfile.mode, order: state.localProfile.blockStack.order };
    }, base, helperOn);
    log(`soak: ${STEPS} steps, seed ${Number(args[1]) || 1}, ${JSON.stringify(setup)}`);
    w.notebook = await rig.page.eval(async base => { const NB = await import(base + "src/vcrp/notebook/index.js"); return NB.notebookOn() && NB.notebookCurrentPhase(window.SillyTavern.getContext().chat) === "setup"; }, base);
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });

    const problems = [];
    const counts = {};
    const quiet = helperOn ? 6500 : 3500;
    const seenErrors = new Set(rig.page.errors.map(String));
    const inPage = (fn, ...a) => rig.page.eval(fn, ...a);
    const lastIsReply = () => inPage(() => { const c = window.SillyTavern.getContext(); const m = c.chat[c.chat.length - 1]; return !!m && !m.is_user && c.chat.length > 1; });
    const chatLen = () => inPage(() => window.SillyTavern.getContext().chat.length);
    // One turn of the story a step; spare answers for a request sent again (the same turn, written again).
    const feed = (n = 3) => { advance(); rig.mock.queue.length = 0; const kinds = []; for (let i = 0; i < n; i++) { const r = reply(); kinds.push(r.kind); rig.mock.queue.push(r.script); } return kinds[0]; };
    const settleAfter = click => inPage((sel, quiet) => window.__e2e.settle({ gens: 1, timeout: 70000, quiet, started: async () => { document.querySelector(sel)?.click(); } }), click, quiet);

    // What the new features keep, read back; and the newest reply's own shape.
    const readState = () => inPage(async base => {
        const c = window.SillyTavern.getContext();
        const out = { errors: [] };
        const tryIt = async (what, fn) => { try { return await fn(); } catch (e) { out.errors.push(`${what}: ${e && e.message}`); return null; } };
        const TH = await import(base + "src/vcrp/threads.js");
        const V = await import(base + "src/vcrp/voice.js");
        const BT = await import(base + "src/vcrp/beats.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        const CA = await import(base + "src/vcrp/canon.js");
        const BE = await import(base + "src/vcrp/blocksEditor.js");
        const H = await import(base + "src/vcrp/health.js");
        const RC = await import(base + "src/vcrp/replyCost.js");
        const F = await import(base + "src/vcrp/focus/index.js");
        const M = await import(base + "src/vcrp/memory/index.js");
        const NB = await import(base + "src/vcrp/notebook/index.js");
        await tryIt("notebook", () => { out.notebook = NB.notebookOn() ? NB.notebookCurrentPhase(c.chat) : "off"; });
        await tryIt("threads", () => { TH.forgetThreadReading(); const l = TH.threadLedger(); out.open = l.open.length; out.stale = l.open.filter(i => i.stale).length; out.closed = l.closed.length; out.due = TH.threadsDue().length; TH.threadsNudge("reply"); });
        await tryIt("voices", () => { V.forgetVoiceReading(); out.voices = V.voiceCharacters().map(x => `${x.name}:${x.total}`).join(","); out.meter = V.driftReadings().map(r => `${r.name}:${r.level}`).join(","); V.voiceAnchorLines(); V.voiceForAudit(); });
        await tryIt("beats", () => { const q = BT.beatQueue(); out.beats = `${q.waiting.length}w${q.next ? "+box" : ""}/${q.fired.length}f`; });
        await tryIt("arc", () => { const a = ARC.arcs(); out.arc = a.current ? `${a.current.title.slice(0, 14)}(${a.current.replies})` : "-"; ARC.arcBlock(); });
        await tryIt("canon", () => { out.canon = CA.canonItems().length; CA.canonBlock(); });
        await tryIt("editor", () => { const s = BE.blocksAsTheyStand(); out.stand = s ? BE.envelopeParts(s.envelope).parts.length : 0; if (s) BE.sceneCast(s.envelope); });
        await tryIt("health", () => { out.warn = H.vcrpHealthCheck().items.filter(i => i.level === "warn").length; });
        await tryIt("cost", () => { const r = RC.costReport(c.chat, { goal: 0.2, ceiling: 0.5 }); out.priced = r ? r.replies : 0; });
        await tryIt("focus", () => { const st = F.peekFocusState() || {}; out.audits = st.audits || 0; out.note = (st.note || "").length; out.auditWaiting = st.pending ? 1 : 0; F.focusSchedule(); F.vcrpFocusBlock(); });
        await tryIt("memory", () => {
            const st = M.memoryState() || {}; const chat = M.memoryChat();
            out.chapters = (st.chapters || []).length; out.waiting = (st.pending || []).length; out.cut = Math.max(0, M.resolveAnchor(chat, st.cut));
            const lost = (st.chapters || []).filter(ch => M.resolveAnchor(chat, ch.end) < 0).length;
            if (lost) out.errors.push(`memory: ${lost} chapter(s) whose place in the chat is lost`);
        });
        const i = c.chat.length - 1, m = c.chat[i] || {};
        out.n = c.chat.length; out.hidden = c.chat.filter(x => x.is_system).length;
        if (m && !m.is_user && typeof m.mes === "string") {
            const story = m.mes.replace(/^[\s\S]*<\/think(?:ing)?\s*>/i, "");
            out.envelopes = (story.match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi) || []).length;
            if (Array.isArray(m.swipes) && typeof m.swipe_id === "number" && m.swipes[m.swipe_id] !== m.mes) out.errors.push("the newest reply and its swipe differ");
            if (out.envelopes > 1) out.errors.push(`the newest reply has ${out.envelopes} <Blocks> sections`);
            out.note = out.note || 0;
            out.cnote = document.querySelector(`#chat .mes[mesid="${i}"] .vcrp-continuity-note`) ? 1 : 0;
        }
        return out;
    }, base);

    // One thing in the settings window or the chat, as the reader would do it.
    const uiAction = (what, n) => inPage(async (base, what, n) => {
        const c = window.SillyTavern.getContext();
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const BT = await import(base + "src/vcrp/beats.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        const CA = await import(base + "src/vcrp/canon.js");
        const BE = await import(base + "src/vcrp/blocksEditor.js");
        const V = await import(base + "src/vcrp/voice.js");
        const F = await import(base + "src/vcrp/focus/index.js");
        const M = await import(base + "src/vcrp/memory/index.js");
        const S = await import(base + "src/vcrp/memory/summarize.js");
        const T = await import(base + "src/ui/tabs.js");
        const state = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        switch (what) {
            case "tabs": {
                document.querySelector("#prompt-slot-fixed-btn")?.click(); await wait(600);
                const seen = [];
                for (const i of [n % T.tabsUI.length, (n * 7 + 3) % T.tabsUI.length, T.tabsUI.findIndex(t => t.title === "Plot"), T.tabsUI.findIndex(t => t.title === "Focus"), T.tabsUI.findIndex(t => t.title === "Memory")]) {
                    document.querySelector(`#dot_${i}`)?.click(); await wait(300);
                    seen.push(`${T.tabsUI[i].title}:${(document.querySelector("#ps_stage_content")?.innerText || "").trim().length}`);
                }
                document.querySelector("#ps_btn_save_close")?.click(); await wait(400);
                return seen.join(" ");
            }
            case "editor": {
                if (!BE.openBlocksEditor()) return "no blocks";
                await wait(250);
                const rm = document.querySelector("#vcrp_blocks_editor .vcrp-be-remove");
                const who = rm ? rm.getAttribute("data-name") : "";
                if (rm && n % 2) { rm.click(); await wait(150); }
                document.querySelector("#vcrp_blocks_editor .vcrp-be-save")?.click(); await wait(700);
                return `saved${rm && n % 2 ? `, ${who} out` : ""}`;
            }
            case "canon": { const a = CA.addCanon(`Fact ${n}: Mara keeps the Lantern's books herself.`); if (n % 3 === 0) { const items = CA.canonItems(); if (items.length > 2) CA.removeCanon(items[1].id); } await c.saveMetadata(); return a ? "added" : "there already"; }
            case "beat": { await BT.addBeat(`Beat ${n}: a knock at the Lantern's door.`, { after: n % 4 }); return `queued, after ${n % 4}`; }
            case "fire": { const q = BT.beatQueue(); if (!q.waiting.length) return "none waiting"; return BT.fireBeat(q.waiting[0].id); }
            case "arc": { if (ARC.arcs().current && n % 2) { await ARC.endArc(); return "ended"; } const r = await ARC.startArc({ title: `Arc ${n}`, genre: "Mystery / Thriller", tone: "tense", premise: `The harbour freezes over (${n}).`, opens: n % 3 ? "Ice locks the boats in." : "" }); return r ? `started${r.beat ? ", opening " + r.beat.fired : ""}` : "not started"; }
            case "pitch": { const r = await ARC.pitchArcs({ wish: "Something with Jonah's debts." }); if (r.status !== "ok") return r.status; const p = r.pitches[n % r.pitches.length]; await ARC.startArc({ title: p.title, premise: p.premise, opens: p.opens }); const cl = await S.closeStoryArc(`Before ${p.title}`); return `started "${p.title}", memory ${cl.status}`; }
            case "nudges": { const q = state.localProfile; q.plot = { ...(q.plot || {}), threadNudges: !(q.plot && q.plot.threadNudges !== false) }; prof.saveProfileToMemory(); return String(q.plot.threadNudges); }
            case "voice": { const ch = V.voiceCharacters()[0]; if (!ch) return "nobody"; if (n % 3 === 0) return String(await V.acceptVoiceNow(ch.key)); if (n % 3 === 1) return String(await V.resetVoiceStart(ch.key)); if (ch.anchors[0] && !ch.anchors[0].own) return String(await V.hideLine(ch.key, ch.anchors[0].text, ch.name)); return String(await V.addOwnLine(ch.key, `Line ${n}, in her own voice, short and curt.`, ch.name)); }
            case "audit": { const st = F.peekFocusState() || {}; if (st.applied) return n % 2 ? String(await F.undoAppliedAudit()) : (await F.keepAppliedAudit(), "kept"); if (st.pending) return n % 2 ? String(await F.approveFocusAudit()) : (await F.discardFocusAudit(), "discarded"); return "nothing waiting"; }
            case "approve": { const st = M.memoryState(); if (!st || !(st.pending || []).length) return "nothing waiting"; S.approvePending(st, S.storyChat()); await c.saveMetadata(); return `approved, ${st.pending.length} left`; }
            case "cut": { const st = M.memoryState(); const r = M.forceCut(st, M.memoryChat()); await c.saveMetadata(); return r.result; }
            case "edit": { const i = c.chat.length - 1, m = c.chat[i]; if (!m || m.is_user) return "no reply"; m.mes = m.mes.replace(/(The lamps burn low)/, "$1, guttering,"); if (Array.isArray(m.swipes)) m.swipes[m.swipe_id || 0] = m.mes; c.updateMessageBlock(i, m); await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, i); await c.saveChat(); return "edited"; }
            default: return "?";
        }
    }, base, what, n);

    for (let step = 1; step <= STEPS; step++) {
        const before = rig.mock.log.length;
        let did = "", detail = "";
        try {
            const r = rnd();
            const canAct = step > 3 && await lastIsReply();
            if (!canAct || r < 0.46) { const kind = feed(); did = "send"; detail = kind; await rig.send(pick(["I ask about it.", "I wait.", "I look around the bar.", "I push the coin across.", "I say nothing."]), { timeout: 70000, quiet }); }
            else if (r < 0.56) { const kind = feed(); did = "swipe"; detail = kind; await rig.swipe({ timeout: 70000, quiet }); }
            else if (r < 0.60) { const kind = feed(); did = "regenerate"; detail = kind; await settleAfter("#option_regenerate"); }
            else if (r < 0.64) { rig.mock.queue.length = 0; rig.mock.queue.push(R.script({ content: " She does not look up again." })); did = "continue"; await settleAfter("#option_continue"); }
            else if (r < 0.69) { did = "delete"; const n = await chatLen(); if (n > 8) { await inPage(async () => { const c = window.SillyTavern.getContext(); await c.executeSlashCommandsWithOptions("/del 2", { handleParserErrors: false, handleExecutionErrors: false }); await new Promise(r2 => setTimeout(r2, 900)); }); detail = "the last two"; } else detail = "too short"; }
            else if (r < 0.74) { did = "hide"; const n = await chatLen(); const upTo = Math.max(0, Math.min(n - 8, int(3, 14))); const un = chance(0.35); await inPage(async (cmd) => { const c = window.SillyTavern.getContext(); await c.executeSlashCommandsWithOptions(cmd, { handleParserErrors: false, handleExecutionErrors: false }); await new Promise(r2 => setTimeout(r2, 700)); }, `/${un ? "unhide" : "hide"} 0-${upTo}`); detail = `${un ? "unhide" : "hide"} 0-${upTo}`; }
            else if (r < 0.77) {
                did = "reload";
                await sleep(1500);
                await rig.page.send("Page.navigate", { url: `http://127.0.0.1:${R.PORTS.st}/` });
                await rig.page.waitFor(() => !!(window.SillyTavern && window.SillyTavern.getContext && document.querySelector("#send_textarea")) && !document.getElementById("preloader"), 240000);
                await sleep(2500);
                await inPage(fs.readFileSync(path.join(HERE, "rig.mjs"), "utf8").match(/function installHelpers\(\) \{[\s\S]*?\n\}\n/)[0].trim());
                detail = await inPage(async () => {
                    const c = window.SillyTavern.getContext();
                    window.confirm = () => true;
                    c.extensionSettings.VCRP.globalSettings.promptPreview = false;
                    c.powerUserSettings.reasoning.auto_parse = false;
                    await c.executeSlashCommandsWithOptions(`/go "${(c.characters[0] || {}).name}"`, { handleParserErrors: false, handleExecutionErrors: false });
                    await new Promise(r2 => setTimeout(r2, 2500));
                    return `chat of ${window.SillyTavern.getContext().chat.length}`;
                });
            } else { did = pick(["tabs", "editor", "canon", "beat", "beat", "fire", "arc", "pitch", "nudges", "voice", "audit", "approve", "cut", "edit"]); detail = String(await uiAction(did, step)); await sleep(did === "pitch" ? 2500 : 500); }
        } catch (e) { problems.push(`step ${step} (${did}): the scenario itself failed: ${e && e.message}`); }
        counts[did] = (counts[did] || 0) + 1;

        // ── After the step ──
        const issues = [];
        for (const e of rig.page.errors.map(String)) { if (seenErrors.has(e)) continue; seenErrors.add(e); if (!/Generation was aborted|AbortError|signal is aborted/.test(e)) issues.push(`page error: ${e.slice(0, 220)}`); }
        for (const t of await rig.toasts()) if (t.kind === "error") issues.push(`error toast: ${t.title}: ${t.text.slice(0, 160)}`);
        const stories = rig.mock.log.slice(before).filter(e => e.story);
        for (const e of stories) {
            const ms = e.body.messages || [], all = textOf(e.body);
            const left = all.match(/\[\[[A-Za-z_ ]+\]\]/g);
            if (left) issues.push(`a tag left in the request: ${[...new Set(left)].join(" ")}`);
            const first = ms.findIndex(x => x.role !== "system");
            if (first >= 0 && ms.slice(first).some(x => x.role === "system")) issues.push("a system message after the chat (Gemini drops or misplaces it)");
            if (!ms.length) issues.push("an empty request went out");
        }
        let st = null;
        try { st = await readState(); } catch (e) { issues.push(`the state could not be read: ${e && e.message}`); }
        if (st) for (const e of st.errors) issues.push(e);
        if (st) w.notebook = st.notebook === "setup";
        const req = stories.length ? ` | request: ${stories[stories.length - 1].body.messages.length} msgs${/\[VOICES\]/.test(textOf(stories.at(-1).body)) ? " V" : ""}${/\[OPEN ENDS\]/.test(textOf(stories.at(-1).body)) ? " O" : ""}${/\[ARC\]/.test(textOf(stories.at(-1).body)) ? " A" : ""}${/### Direction for this reply/.test(textOf(stories.at(-1).body)) ? " D" : ""}${/\[FOCUS\]/.test(textOf(stories.at(-1).body)) ? " F" : ""}${/<story_memory>/.test(textOf(stories.at(-1).body)) ? " M" : ""}` : "";
        log(`${String(step).padStart(3)} ${did}${detail ? ` (${detail})` : ""}${req}${st ? ` | chat ${st.n} (${st.hidden} hidden), open ${st.open}/${st.stale} stale/${st.closed} gone, due ${st.due}, voices ${st.voices || "-"} [${st.meter || "-"}], beats ${st.beats}, arc ${st.arc}, canon ${st.canon}, blocks ${st.stand}, chapters ${st.chapters}+${st.waiting}w cut@${st.cut}, audits ${st.audits}${st.auditWaiting ? "+w" : ""}, priced ${st.priced}${st.cnote ? ", NOTE" : ""}` : ""}`.slice(0, 520));
        for (const i of issues) { log(`    PROBLEM: ${i}`); problems.push(`step ${step} (${did}): ${i}`); }
    }
    log(`did: ${JSON.stringify(counts)}`);
    log(`the mock answered: ${JSON.stringify(stats)}`);
    log(problems.length ? `${problems.length} PROBLEM(S):\n  ${problems.join("\n  ")}` : `NO PROBLEM IN ${STEPS} STEPS`);
}
