// The plot in the reader's hands, in the real app: a story in progress with one thread left
// hanging. The reminder of the stale thread in the real request; an arc with its opening move;
// a beat that fires by itself; three pitches asked for and one started; Story Memory closing
// the old arc; the Plot tab and VCRP Quick.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const WORLD = "<Blocks>\n<World_State>\n**📅 Time:** Day 2, dusk | **🌤 Loc:** The pier | Saltmere | **🌡 Wx:** Rain\n\n---\n**👥 NPCs Present:**\n**Mara:**\n* *Outfit:* a wet coat\n* *Mood:* wary\n\n---\n**🔥 Unresolved Threads:**\n* Who sent the unsigned letter to Mara?\n**🌱 Planted Seeds:** the cracked locket | Mara's mother | 3 turns\n**⏳ Consequence Timers:** none\n**🎯 Arc Phase:** Setup\n**🎬 Scene Phase:** Building\n</World_State>\n</Blocks>";
    const reply = text => R.script({ content: `<think>\n${L.COT}\n</think>\n${text}\n\n${WORLD}` });
    const PITCHES = "<pitch>\nTitle: The Ice Ledger\nPremise: The harbourmaster calls in every debt at once, and Jonah's name is first on the list.\nOpens with: A notice is nailed to the Lantern's door.\n</pitch>\n<pitch>\nTitle: What the Gulls Carry\nPremise: The ring on the gull's leg was a message, and someone is still waiting for the answer.\nOpens with: The gull comes back.\n</pitch>\n<pitch>\nTitle: Mother's Locket\nPremise: The cracked locket opens, and what is inside is not Mara's mother.\nOpens with: The locket's hinge gives way.\n</pitch>";
    const sends = async (said, text, opts = {}) => {
        rig.mock.queue.length = 0;
        rig.mock.queue.push(reply(text));
        const before = rig.mock.log.length;
        await rig.send(said, { timeout: 60000, quiet: 5000, ...opts });
        return rig.mock.log.slice(before);
    };

    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world"] }, focus: { enabled: false, live: { swipes: false, repeats: false, user: false } } });
    const seeded = await rig.page.eval(async (WORLD, base) => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        c.extensionSettings.VCRP.globalSettings.blankRetry = false;
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
        const t0 = Date.now() - 3600e3;
        // Twenty-one exchanges after the greeting (the greeting is reply 1 and lists nothing), so
        // the thread first listed in reply 2 has stood twenty replies when the next one is asked for.
        for (let i = 0; i < 21; i++) {
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date(t0 + i * 2000).toISOString(), mes: `I ask Mara about day ${i + 1}.`, extra: {} });
            c.chat.push({ name: c.name2, is_user: false, is_system: false, send_date: new Date(t0 + i * 2000 + 1000).toISOString(), mes: `Mara shrugs at the rain, and the lamps burn low over the pier.\n\n${WORLD}`, extra: {} });
        }
        await c.saveChat();
        await c.reloadCurrentChat();
        await new Promise(r => setTimeout(r, 2500));
        const TH = await import(base + "src/vcrp/threads.js");
        TH.forgetThreadReading();
        const l = TH.threadLedger();
        return { messages: window.SillyTavern.getContext().chat.length, replies: l.replies, open: l.open.map(i => `${i.kind}: ${i.text} (age ${i.age}, still ${i.still}, stale ${i.stale})`), due: TH.threadsDue().length };
    }, WORLD, base);
    log("seeded:", JSON.stringify(seeded));
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    rig.mock.aside = b => (/<pitch>/.test(textOf(b)) ? PITCHES : /MEMORY TASK FOLD/.test(textOf(b)) ? "<arc>Mara hid a letter that was not hers, and the town began to ask who sent it.</arc>" : "OK.");

    // 1. The thread has stood twenty replies: the next request names it.
    let sent = await sends("I ask Mara what she is not telling me.", "Mara looks at the water for a long time.");
    let story = sent.find(e => e.story);
    const at = story.body.messages.findIndex(m => typeof m.content === "string" && m.content.includes("[OPEN ENDS]"));
    const lastAssistant = story.body.messages.map(m => m.role).lastIndexOf("assistant");
    log(`── the reminder: [OPEN ENDS] in message ${at} of ${story.body.messages.length} (${at >= 0 ? story.body.messages[at].role : "-"}), after the history's last reply (${lastAssistant}): ${at > lastAssistant}`);
    if (at >= 0) log(`   ${L.cut(story.body.messages[at].content.slice(story.body.messages[at].content.indexOf("[OPEN ENDS]")).split("\n").slice(2).join(" / "), 200)}`);
    sent = await sends("I wait.", "She says nothing yet.");
    log(`   the reply after: named again: ${textOf(sent.find(e => e.story).body).includes("[OPEN ENDS]")} (it is named when it goes stale, then every eight replies)`);

    // 2. An arc with its opening move, and a beat set to fire one reply later.
    const arc = await rig.page.eval(async base => {
        const ARC = await import(base + "src/vcrp/arc.js");
        const BT = await import(base + "src/vcrp/beats.js");
        const r = await ARC.startArc({ title: "The Long Freeze", genre: "Mystery / Thriller", tone: "tense", premise: "The harbour freezes over and the town turns on its smugglers.", opens: "Ice locks the fishing boats in overnight." });
        const b = await BT.addBeat("Jonah's boat is found empty.", { after: 1 });
        return { arc: r.arc.title, opening: r.beat && r.beat.fired, queued: b && b.dueAt, box: (await import(base + "src/vcrp/oneShot.js")).oneShot().text };
    }, base);
    log("── the arc:", JSON.stringify(arc));
    sent = await sends("I walk out onto the pier.", "By morning the boats do not move: the harbour has frozen them in.");
    story = sent.find(e => e.story);
    const all = textOf(story.body);
    log(`   the request: [ARC] after the newest message: ${all.indexOf("[ARC]") > all.lastIndexOf("I walk out onto the pier.")} | carries the premise: ${all.includes("The harbour freezes over and the town turns on its smugglers.")} | the opening move as this reply's direction: ${/### Direction for this reply[\s\S]*Ice locks the fishing boats in overnight\./.test(all)}`);
    let state = await rig.page.eval(async base => {
        const BT = await import(base + "src/vcrp/beats.js");
        const q = BT.beatQueue();
        return { fired: q.fired.map(b => b.text), next: q.next && q.next.text, waiting: q.waiting.map(b => `${b.text} (in ${b.in})`), box: (await import(base + "src/vcrp/oneShot.js")).oneShot().text };
    }, base);
    log(`   after the reply: ${JSON.stringify(state)}`);
    for (const t of await rig.toasts()) if (/beats/.test(t.title)) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 200)}`);
    sent = await sends("I look for Jonah.", "His boat sits in the ice with nobody aboard.");
    log(`   the next request carries the beat that fired by itself: ${/### Direction for this reply[\s\S]*Jonah's boat is found empty\./.test(textOf(sent.find(e => e.story).body))}`);

    // 3. The Plot tab: three pitches asked for, one started; then VCRP Quick.
    let before = rig.mock.log.length;
    const tab = await rig.page.eval(async base => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const tabs = await import(base + "src/ui/tabs.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        const BT = await import(base + "src/vcrp/beats.js");
        const flat = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
        document.querySelector("#prompt-slot-fixed-btn")?.click();
        await wait(700);
        document.querySelector(`#dot_${tabs.tabsUI.findIndex(t => t.title === "Plot")}`)?.click();
        await wait(600);
        const q = s => document.querySelector(`#ps_stage_content ${s}`);
        const wide = id => { const el = q(id); return el ? el.scrollWidth > el.clientWidth + 2 : null; };
        const out = {
            badge: flat(q(".mtab-header-badge")), current: flat(q("#plot_arc_current"))?.slice(0, 60),
            threads: [...document.querySelectorAll("#ps_stage_content .plot-thread")].map(el => flat(el).slice(0, 110)),
            sideways: { arc: wide("#plot_arc_panel"), beats: wide("#plot_beat_panel"), threads: wide("#plot_thread_panel") },
            cost: flat(q("#plot_pitch_cost")),
        };
        q("#plot_new_wish").value = "Something with Jonah's debts.";
        q("#plot_new_wish").dispatchEvent(new Event("input", { bubbles: true }));
        q("#plot_pitch").click();
        for (let i = 0; i < 80 && !document.querySelector("#ps_stage_content .plot-pitch"); i++) await wait(250);
        out.pitches = [...document.querySelectorAll("#ps_stage_content .plot-pitch b")].map(el => el.textContent);
        document.querySelector("#ps_stage_content .plot-pitch-start")?.click();
        await wait(1200);
        out.started = ARC.arcs().current && { title: ARC.arcs().current.title, premise: ARC.arcs().current.premise.slice(0, 60) };
        out.past = ARC.arcs().past.map(a => a.title);
        out.next = BT.beatQueue().next && BT.beatQueue().next.text;
        document.querySelector("#ps_btn_save_close")?.click();
        await wait(500);
        return out;
    }, base);
    const pitchCall = rig.mock.log.slice(before).find(e => /<pitch>/.test(textOf(e.body)));
    log(`── the Plot tab: badge ${JSON.stringify(tab.badge)} | running ${JSON.stringify(tab.current)} | scrolls sideways ${JSON.stringify(tab.sideways)}`);
    log(`   open ends: ${JSON.stringify(tab.threads)}`);
    log(`   the pitch call: ${pitchCall ? `asked (stream ${pitchCall.body.stream}, ${pitchCall.body.messages.length} messages), reads the story and the wish: ${/<story_so_far>/.test(textOf(pitchCall.body)) && /Something with Jonah's debts\./.test(textOf(pitchCall.body))}, the open thread: ${/<open_threads>\n- Who sent the unsigned letter/.test(textOf(pitchCall.body))}, the arc ending: ${/<arc_ending_now>\n"The Long Freeze"/.test(textOf(pitchCall.body))}` : "NOT asked"} | priced: ${JSON.stringify(tab.cost)}`);
    log(`   the pitches: ${JSON.stringify(tab.pitches)} | started ${JSON.stringify(tab.started)} | earlier arcs ${JSON.stringify(tab.past)} | its opening move in the box: ${JSON.stringify(tab.next)}`);
    const quick = await rig.page.eval(async base => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const BT = await import(base + "src/vcrp/beats.js");
        const QP = await import(base + "src/vcrp/quickPanel.js");
        await BT.addBeat("A storm closes the harbour.");
        QP.openQuickPanel();
        await wait(300);
        const d = document.getElementById("vcrp_quick_overlay");
        const out = { open: !!d && (d.open === true || d.tagName !== "DIALOG"), row: d && d.querySelector("#vcrp_quick_beat_row") ? d.querySelector("#vcrp_quick_beat_row").textContent.replace(/\s+/g, " ").trim() : null, box: d && d.querySelector("#vcrp_quick_shot") ? d.querySelector("#vcrp_quick_shot").value : null };
        QP.closeQuickPanel();
        return out;
    }, base);
    log(`── VCRP Quick: ${JSON.stringify(quick)}`);

    // 4. Story Memory closes an arc: its chapters fold into one entry under its name.
    before = rig.mock.log.length;
    const closed = await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const st8 = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        const memory = await import(base + "src/vcrp/memory/index.js");
        const S = await import(base + "src/vcrp/memory/summarize.js");
        const L = await import(base + "src/vcrp/memory/ledger.js");
        const g = c.extensionSettings.VCRP.globalSettings;
        g.memoryBudget = { ...(g.memoryBudget || {}), customPrice: { "google/gemini-4-argon": { input: 2, output: 10, read: 0.1 } } };
        st8.localProfile.vcrpMemory = { ...(st8.localProfile.vcrpMemory || {}), enabled: true };
        prof.saveProfileToMemory();
        const st = memory.memoryState();
        Object.assign(st, { arcs: [], ledger: [], pending: [], chapters: [
            { id: "C1", gist: "Mara hid a letter that was not hers.", chapter: "Mara hid the unsigned letter under the Lantern's till.", start: null, end: null, undo: {}, when: "Day 1 · The pier" },
            { id: "C2", gist: "The town began to ask who sent it.", chapter: "By the second day the whole pier was asking.", start: null, end: null, undo: {} },
        ] });
        const r = await S.closeStoryArc("The Long Freeze");
        const text = L.composeMemoryText({ arcs: st.arcs, chapters: st.chapters, ledger: [] });
        st8.localProfile.vcrpMemory.enabled = false;
        prof.saveProfileToMemory();
        return { result: r, arcs: st.arcs.map(a => a.text), folded: st.chapters.map(ch => !!ch.folded), memoryText: text.split("\n").filter(l => l.startsWith("- ")) };
    }, base);
    const foldCall = rig.mock.log.slice(before).find(e => /MEMORY TASK FOLD/.test(textOf(e.body)));
    log(`── Story Memory closes the arc: ${JSON.stringify(closed.result)} | the call ${foldCall ? `asked (${foldCall.body.messages.length} messages, names the arc: ${/closed a story arc called "The Long Freeze"/.test(textOf(foldCall.body))})` : "NOT asked"}`);
    log(`   the memory text now: ${JSON.stringify(closed.memoryText)} | chapters folded ${JSON.stringify(closed.folded)}`);
    for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks" && !/Workflow/.test(t.text)) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 200)}`);
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
