// The cache with everything on, in the real app. A story in progress with the Canon sheet,
// Story Memory (chapters with dates, a cut, recall), the voices, an arc with its opening beat,
// the plot focus, a Focus correction, a stale thread and the blocks, on OpenRouter + Gemini.
// Five replies, and between them the things a reader does: a beat fires, the blocks are edited
// by hand, a line is added to the Canon sheet. For each request: how much of it is word for
// word the request before it (what a cache can read), by the requests themselves as the
// provider received them, and by VCRP's own cache check.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const str = m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const WORLD = "<Blocks>\n<Scene>\nHere: Mara\nRemote:\n</Scene>\n<World_State>\n**📅 Time:** Day 2, dusk | **🌤 Loc:** The pier | Saltmere | **🌡 Wx:** Rain\n\n---\n**👥 NPCs Present:**\n**Mara:**\n* *Outfit:* a wet coat\n* *Mood:* wary\n\n---\n**📡 Off-Screen:**\n* Jonah: mending nets\n\n---\n**🔥 Unresolved Threads:**\n* Who sent the unsigned letter to Mara?\n**🎯 Arc Phase:** Setup\n</World_State>\n<Bonds>\nMara: Affection: 48/100 (=) | Trust: 30/100 (=)\n</Bonds>\n</Blocks>";
    // Each reply starts a moment late, so VCRP's own verdict on its request can be read before anything else is asked.
    const reply = text => R.script({ pre: [{ wait: 1800, comment: true }], content: `<think>\n${L.COT}\n</think>\nMara shrugs at the rain. <font color="#a855f7" title="Mara">"${text}"</font>\n\n${WORLD}` });

    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world", "bonds"] }, focus: { enabled: true, every: 100, checks: { drift: true, motifs: true, slop: true } } });
    const seeded = await rig.page.eval(async (WORLD, base) => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        const g = c.extensionSettings.VCRP.globalSettings;
        g.blankRetry = false;
        g.memoryBudget = { ...(g.memoryBudget || {}), customPrice: { "google/gemini-4-argon": { input: 2, output: 10, read: 0.1 } }, recallTokens: 400 };
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        const st8 = await import(base + "src/core/state.js");
        reg.meguminSyncLegacyBlockIds();
        st8.localProfile.vcrpMemory = { ...(st8.localProfile.vcrpMemory || {}), enabled: true };
        prof.saveProfileToMemory();
        const THINGS = "anvil barrel candle dagger ember flask gauntlet hammer inkwell jar kettle lantern mallet needle oar pulley quill rope saddle tankard urn vial wagon".split(" ");
        const t0 = Date.now() - 3600e3;
        for (let i = 0; i < 21; i++) {
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date(t0 + i * 2000).toISOString(), mes: `I ask Mara about the ${THINGS[i]}.`, extra: {} });
            c.chat.push({ name: c.name2, is_user: false, is_system: false, send_date: new Date(t0 + i * 2000 + 1000).toISOString(), extra: {},
                mes: `The lamps burn low over the pier. <font color="#a855f7" title="Mara">"Tch. Do not waste my time with that ${THINGS[i]}, kid."</font>\n\n${WORLD}` });
        }
        await c.saveChat();
        await c.reloadCurrentChat();
        await new Promise(r => setTimeout(r, 2500));
        // Everything on: the Canon sheet, Story Memory with dated chapters and a cut, an arc with its opening beat, the plot focus, a Focus correction.
        const canon = await import(base + "src/vcrp/canon.js");
        const memory = await import(base + "src/vcrp/memory/index.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        const focus = await import(base + "src/vcrp/focus/index.js");
        canon.addCanon("Mara is the traveler's older sister.");
        canon.addCanon("The Lantern stands on the pier at Saltmere.");
        const chat = memory.memoryChat();
        Object.assign(memory.memoryState(), {
            cut: null, summarized: memory.anchorOf(chat, 6), shown: "", hiddenFacts: [], arcs: [], pending: [], lastRequestAt: Date.now(),
            ledger: [{ id: "F1", cat: "relationship", text: "Mara distrusts Jonah.", since: "C1", updated: "C1" }],
            chapters: [
                { id: "C1", gist: "Mara hid a letter that was not hers.", chapter: "Mara hid the unsigned letter under the Lantern's till and told nobody.", from: 0, to: 2, start: null, end: memory.anchorOf(chat, 3), when: "Day 1 · The pier" },
                { id: "C2", gist: "The town began to ask who sent it.", chapter: "By the second day the whole pier was asking about the letter.", from: 3, to: 5, start: memory.anchorOf(chat, 3), end: memory.anchorOf(chat, 6), when: "Day 2, noon · The Lantern" },
            ],
        });
        // The cut Story Memory itself would make after a break: the chapters' messages leave the prompt, the memory text takes their place.
        const cut = memory.forceCut(memory.memoryState(), chat);
        await ARC.startArc({ title: "The Long Freeze", genre: "Mystery / Thriller", tone: "tense", premise: "The harbour freezes over and the town turns on its smugglers.", opens: "Ice locks the fishing boats in overnight." });
        await focus.setPlotFocus({ active: true, text: "The unsigned letter" });
        Object.assign(focus.focusState(), { note: "Mara stays curt: short lines, no apologies.", noteAt: Date.now() });
        await c.saveMetadata();
        const V = await import(base + "src/vcrp/voice.js");
        const TH = await import(base + "src/vcrp/threads.js");
        V.forgetVoiceReading(); TH.forgetThreadReading();
        return { messages: window.SillyTavern.getContext().chat.length, anchors: V.voiceAnchorLines().slice(0, 60), threadsDue: TH.threadsDue().length, cut, memoryText: memory.memoryState().shown.split("\n").filter(l => l.startsWith("- ")) };
    }, WORLD, base);
    log("seeded:", JSON.stringify(seeded));
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    rig.mock.aside = () => "OK.";

    const bodies = [];
    const send = async (said, line) => {
        rig.mock.queue.length = 0;
        rig.mock.queue.push(reply(line));
        const before = rig.mock.log.length;
        const sending = rig.send(said, { timeout: 60000, quiet: 5000 });
        const t0 = Date.now();
        while (!rig.mock.log.slice(before).some(e => e.story) && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
        const story = rig.mock.log.slice(before).find(e => e.story);
        // Now: the comparison of this reply's request with the reply before it. (A background call
        // that follows the reply is compared too, and its comparison then takes this one's place.)
        const verdict = await rig.page.eval(async base => {
            const cc = await import(base + "src/vcrp/cacheCheck.js");
            const r = cc.vcrpCacheCheckReport();
            return r ? { kind: r.kind, stable: r.stableTokens, total: r.totalTokens, trouble: cc.vcrpCacheCheckTrouble(), firstChange: r.change ? `${r.change.index + 1} of ${r.change.of} (${r.change.role})` : "none" } : null;
        }, base);
        await sending;
        const later = await rig.page.eval(async base => { const cc = await import(base + "src/vcrp/cacheCheck.js"); const r = cc.vcrpCacheCheckReport(); return r ? { kind: r.kind, trouble: cc.vcrpCacheCheckTrouble() } : null; }, base);
        bodies.push({ said, messages: story.body.messages, verdict, later, calls: rig.mock.log.slice(before).length });
        return story.body.messages;
    };
    const where = (messages, mark) => { const i = messages.findIndex(m => str(m).includes(mark)); return i < 0 ? "-" : i === messages.length - 1 ? "last" : String(i); };
    const describe = (n, note) => {
        const cur = bodies[n], prev = bodies[n - 1];
        const m = cur.messages;
        const marks = [["<canon>", "Canon"], ["<story_memory>", "memory"], ["<story_recall>", "recall"], ["[FOCUS]", "correction"], ["[VOICES]", "voices"], ["[OPEN ENDS]", "open ends"], ["[ARC]", "arc"], ["[PLOT FOCUS]", "plot focus"], ["### Direction for this reply", "beat"], ["The blocks as they stood", "blocks carried"]];
        log(`── request ${n + 1} (${note}): ${m.length} messages | where each part rides: ${marks.map(([k, name]) => `${name} ${where(m, k)}`).join(", ")}`);
        if (!prev) return;
        const a = prev.messages;
        let i = 0;
        while (i < a.length && i < m.length && a[i].role === m[i].role && str(a[i]) === str(m[i])) i++;
        const chars = x => x.reduce((s, y) => s + str(y).length, 0);
        const kept = chars(a.slice(0, i)), all = chars(a);
        log(`   against the request before it: the first ${i} of its ${a.length} messages are word for word the same (${Math.round(100 * kept / all)}% of its text); everything before its last message kept: ${i >= a.length - 1}`);
        log(`   VCRP's own cache check, as the request went out: ${JSON.stringify(cur.verdict)} | a few seconds later, after ${cur.calls - 1} background call(s): ${JSON.stringify(cur.later)}`);
    };

    await send("I ask Mara what she is not telling me.", "Tch. Nothing you need, kid.");
    describe(0, "the thread's reminder and the arc's opening beat go out");
    await send("I wait.", "Tch. Still here, kid.");
    describe(1, "an ordinary turn");
    // The blocks under the latest reply, edited by hand.
    const edited = await rig.page.eval(async base => {
        const BE = await import(base + "src/vcrp/blocksEditor.js");
        const s = BE.blocksAsTheyStand();
        const was = window.SillyTavern.getContext().chat[s.index].mes;
        return BE.saveBlocksAsTheyStand(s.index, s.envelope.replace("Day 2, dusk", "Day 3, dawn").replace("Affection: 48/100", "Affection: 52/100"), was);
    }, base);
    await send("I look at the sky.", "Tch. It will snow, kid.");
    describe(2, `after the blocks were edited by hand (${edited ? "saved" : "NOT saved"})`);
    log(`   the edit reached the model: ${/Day 3, dawn/.test(str(bodies[2].messages.at(-1))) && /Affection: 52\/100/.test(str(bodies[2].messages.at(-1)))}`);
    // A line added to the Canon sheet: the one change that is meant to cost a cache write, once.
    await rig.page.eval(async base => { const canon = await import(base + "src/vcrp/canon.js"); canon.addCanon("Jonah owes the harbourmaster forty crowns."); await window.SillyTavern.getContext().saveMetadata(); }, base);
    await send("I ask about Jonah.", "Tch. Ask him yourself, kid.");
    describe(3, "after a line was added to the Canon sheet");
    await send("I nod.", "Tch. Good, kid.");
    describe(4, "the turn after that");
    for (const t of await rig.toasts()) if (!/VCRP: blocks|Workflow/.test(`${t.title} ${t.text}`)) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 160)}`);
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
