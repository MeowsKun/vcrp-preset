// The sweep before a first run, in the real app (10.0.0-vcrp.24). What the scenarios before
// this one never put together:
//   A. the continuity check while the helper writes the same reply's blocks (the helper does
//      one job at a time: the blocks land under the reply while the check waits its turn);
//   B. its corrected swipe with a beat waiting in the Next reply only box;
//   C. a long chat whose early part the reader hides (/hide): the ages of the open ends, a
//      beat's wait, an arc's length and the characters' first lines must not move;
//   D. settings and chat data from before these versions, loaded afresh: every tab opens, and
//      a reply goes out whole.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const BLOCKS = "<Blocks>\n<World_State>\n**📅 Time:** Day 1, dusk | **🌤 Loc:** The glade | Eldoria | **🌡 Wx:** Mist\n\n---\n**👥 NPCs Present:**\n**Seraphina:**\n* *Outfit:* a green cloak\n\n---\n**🔥 Unresolved Threads:**\n* Who hunts the traveler through the forest?\n**🎯 Arc Phase:** Setup\n</World_State>\n<Bonds>\nSeraphina: Affection: 40/100 (=) | Trust: 30/100 (=)\n</Bonds>\n</Blocks>";
    const say = (line, eyes) => `<think>\n${L.COT}\n</think>\nSeraphina looks up, her ${eyes} eyes catching the firelight. <font color="#a855f7" title="Seraphina">"${line}"</font>`;
    const problems = [];
    const expect = (ok, what) => { log(`   ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };

    // ── A. The continuity check while the helper writes the reply's blocks ──
    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world", "bonds"] } }, "VCRP V10 Universal");
    const setup = await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const cm = c.extensionSettings.connectionManager || (c.extensionSettings.connectionManager = { profiles: [] });
        cm.profiles = (cm.profiles || []).filter(p => p.id !== "e2e-helper");
        cm.profiles.push({ id: "e2e-helper", name: "E2E helper", mode: "cc", api: "openrouter", model: "google/gemini-4-argon", preset: "Default" });
        const g = c.extensionSettings.VCRP.globalSettings;
        g.helper = { enabled: true, profileId: "e2e-helper", testedProfileId: "e2e-helper", jobs: {}, blockRoutes: {} };
        g.blankRetry = false;
        c.powerUserSettings.reasoning.auto_parse = false;
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
        const canon = await import(base + "src/vcrp/canon.js");
        canon.addCanon("Seraphina has amber eyes.");
        await c.saveMetadata();
        const HS = await import(base + "src/vcrp/helper/settings.js");
        const aside = await import(base + "src/vcrp/helper/aside.js");
        return { blocksToHelper: HS.helperRoutesBlocks(), continuity: aside.helperAnswers("continuity") };
    }, base);
    log("── A. setup:", JSON.stringify(setup));
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    // The helper: slow to write the blocks (as a model is), then asked the check.
    rig.mock.aside = async b => {
        const t = textOf(b);
        if (/<established_facts>/.test(t)) return 'CONTRADICTION: "her brown eyes" | Seraphina has amber eyes.';
        if (/Write these blocks for the moment/.test(t)) { await sleep(3500); return BLOCKS; }
        return "OK.";
    };
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: say("Rest. You are safe here.", "brown") }));
    let before = rig.mock.log.length;
    await rig.send("How long was I out?", { timeout: 60000, quiet: 10000 });
    let sent = rig.mock.log.slice(before);
    const order = sent.filter(e => !e.story).map(e => (/<established_facts>/.test(textOf(e.body)) ? "check" : /Write these blocks/.test(textOf(e.body)) ? "blocks" : "other"));
    let m = await rig.last();
    const note = () => rig.page.eval(() => document.querySelector("#chat .mes.last_mes .vcrp-continuity-note")?.textContent || null);
    log(`   the helper's calls, in order: ${order.join(", ")} | the reply now: ${String(m.mes).length} chars, blocks ${/<World_State>/.test(m.mes)}, helper ${m.extra && m.extra.vcrp_helper_blocks}`);
    expect(order.includes("blocks") && order.includes("check") && /<World_State>/.test(m.mes), "the helper wrote the reply's blocks and was asked the check");
    expect(!!(m.extra && m.extra.vcrp_continuity && m.extra.vcrp_continuity.findings) && /May contradict the story/.test(String(await note())), `the finding is kept and shown under the reply, though its blocks were written while the check waited: ${JSON.stringify(await note())}`);

    // ── B. The corrected swipe, with a beat waiting in the box ──
    const boxed = await rig.page.eval(async base => {
        const BT = await import(base + "src/vcrp/beats.js");
        const shot = await import(base + "src/vcrp/oneShot.js");
        const b = await BT.addBeat("A horn sounds from the ridge.");
        const fired = await BT.fireBeat(b.id);
        return { fired, box: shot.oneShot().text };
    }, base);
    log(`── B. a beat in the box: ${JSON.stringify(boxed)}`);
    rig.mock.aside = async b => { const t = textOf(b); if (/Write these blocks for the moment/.test(t)) { await sleep(1200); return BLOCKS; } return "OK."; };
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: say("Rest. You are safe here.", "amber") }));
    before = rig.mock.log.length;
    await rig.page.eval(async () => {
        document.querySelector("#chat .mes.last_mes .vcrp-continuity-note")?.click();
        await new Promise(r => setTimeout(r, 300));
        document.querySelector("dialog.vcrp-continuity-dialog .vcrp-cont-fix")?.click();
    });
    await rig.page.eval(() => window.__e2e.settle({ gens: 1, timeout: 60000, quiet: 7000 }));
    sent = rig.mock.log.slice(before);
    const swipe = sent.find(e => e.story);
    const swipeText = swipe ? textOf(swipe.body) : "";
    expect(!!swipe && /Established: Seraphina has amber eyes\./.test(swipeText) && !/A horn sounds from the ridge/.test(swipeText), "the corrected swipe carries the correction, and not the beat that waits for the next message");
    let after = await rig.page.eval(async base => {
        const BT = await import(base + "src/vcrp/beats.js");
        const shot = await import(base + "src/vcrp/oneShot.js");
        const q = BT.beatQueue();
        return { box: shot.oneShot().text, next: q.next && q.next.text, waiting: q.waiting.length, fired: q.fired.length, once: !!(window.SillyTavern.getContext().chatMetadata.vcrp_oneshot || {}).once };
    }, base);
    m = await rig.last();
    expect(after.box === "A horn sounds from the ridge." && after.next === after.box && !after.once, `the box still holds the beat after the swipe: ${JSON.stringify(after)}`);
    expect(m.swipe_id === 1 && /amber eyes/.test(m.mes) && (await note()) === null, `the swipe is in, and carries no finding: swipe ${m.swipe_id}, note ${JSON.stringify(await note())}`);
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: say("Did you hear that horn?", "amber") }));
    before = rig.mock.log.length;
    await rig.send("I try to sit up.", { timeout: 60000, quiet: 6000 });
    const nextStory = rig.mock.log.slice(before).find(e => e.story);
    after = await rig.page.eval(async base => { const BT = await import(base + "src/vcrp/beats.js"); const shot = await import(base + "src/vcrp/oneShot.js"); const q = BT.beatQueue(); return { box: shot.oneShot().text, next: !!q.next, fired: q.fired.map(b => b.text) }; }, base);
    expect(!!nextStory && /### Direction for this reply[\s\S]*A horn sounds from the ridge\./.test(textOf(nextStory.body)) && after.fired.includes("A horn sounds from the ridge.") && after.box === "", `the next message takes the beat, and its reply spends it: ${JSON.stringify(after)}`);

    // ── C. A long chat whose early part is hidden ──
    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world", "bonds"] }, focus: { enabled: false, live: { swipes: false, repeats: false, user: false } } }, "VCRP V10 Universal");
    const readNumbers = () => rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const TH = await import(base + "src/vcrp/threads.js");
        const BT = await import(base + "src/vcrp/beats.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        const V = await import(base + "src/vcrp/voice.js");
        TH.forgetThreadReading(); V.forgetVoiceReading();
        const l = TH.threadLedger();
        const mara = V.voiceCharacters()[0];
        return {
            messages: c.chat.length, hidden: c.chat.filter(x => x.is_system).length, replies: BT.replyCount(),
            thread: l.open.map(i => `${i.age}/${i.still}${i.stale ? " stale" : ""}`).join(), due: TH.threadsDue().length,
            beatIn: (BT.beatQueue().waiting[0] || {}).in, arcReplies: (ARC.arcs().current || {}).replies,
            lines: mara ? mara.total : 0, firstAnchor: mara && mara.anchors[0] ? mara.anchors[0].text.slice(0, 44) : null, sends: V.voiceAnchorLines().slice(0, 60),
        };
    }, base);
    await rig.page.eval(async (BLOCKS, base) => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        c.extensionSettings.VCRP.globalSettings.blankRetry = false;
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
        const THINGS = "anvil barrel candle dagger ember flask gauntlet hammer inkwell jar kettle lantern mallet needle oar pulley quill rope saddle tankard urn vial wagon".split(" ");
        const t0 = Date.now() - 3600e3;
        for (let i = 0; i < 21; i++) {
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date(t0 + i * 2000).toISOString(), mes: `I ask about the ${THINGS[i]}.`, extra: {} });
            c.chat.push({ name: c.name2, is_user: false, is_system: false, send_date: new Date(t0 + i * 2000 + 1000).toISOString(), extra: {},
                mes: `The fire burns low. <font color="#a855f7" title="Seraphina">"Hush now. Leave that ${THINGS[i]} be, traveler."</font>\n\n${BLOCKS}` });
        }
        await c.saveChat();
        await c.reloadCurrentChat();
        await new Promise(r => setTimeout(r, 2500));
        const BT = await import(base + "src/vcrp/beats.js");
        const ARC = await import(base + "src/vcrp/arc.js");
        await ARC.startArc({ title: "The Hunt", premise: "Whoever hunts the traveler closes in on the glade." });
        await BT.addBeat("A second horn answers the first.", { after: 3 });
        await c.saveMetadata();
    }, BLOCKS, base);
    const shown = await readNumbers();
    log(`── C. the chat as written: ${JSON.stringify(shown)}`);
    // The reader hides the first thirty messages, as they would to keep an old chat's prompt small.
    await rig.page.eval(async () => {
        const c = window.SillyTavern.getContext();
        await c.executeSlashCommandsWithOptions("/hide 0-29", { handleParserErrors: false, handleExecutionErrors: false });
        await new Promise(r => setTimeout(r, 800));
    });
    const hidden = await readNumbers();
    log(`   with messages 0-29 hidden: ${JSON.stringify(hidden)}`);
    expect(hidden.hidden === 30 && hidden.replies === shown.replies && hidden.thread === shown.thread && hidden.due === shown.due && hidden.beatIn === shown.beatIn && hidden.arcReplies === shown.arcReplies,
        "hiding the old part moves no count: replies, the open end's age, the reminder due, the beat's wait, the arc's length");
    expect(hidden.lines === shown.lines && hidden.firstAnchor === shown.firstAnchor && /anvil/.test(String(hidden.firstAnchor)) && hidden.sends === shown.sends && /anvil/.test(hidden.sends), "her first lines are still her first lines, and still what is sent");
    rig.mock.aside = () => "OK.";
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `${say("Hush now. They will not find you tonight.", "amber")}\n\n${BLOCKS}` }));
    before = rig.mock.log.length;
    await rig.send("I listen to the forest.", { timeout: 60000, quiet: 5000 });
    const req = rig.mock.log.slice(before).find(e => e.story);
    const reqText = req ? textOf(req.body) : "";
    log(`   the request after hiding: ${req ? req.body.messages.length : 0} messages | hidden messages left out: ${!/Leave that anvil be/.test(reqText.replace(/\[VOICES\][\s\S]*?(?=\n\n|$)/, ""))} | [VOICES] ${/\[VOICES\][\s\S]*Leave that anvil be/.test(reqText)} | [OPEN ENDS] ${/\[OPEN ENDS\]/.test(reqText)} | [ARC] ${/\[ARC\]/.test(reqText)}`);
    expect(!!req && /\[VOICES\][\s\S]*Leave that anvil be/.test(reqText) && /\[ARC\]/.test(reqText) && (shown.due ? /\[OPEN ENDS\]/.test(reqText) : true), "the reply's request carries her earliest lines from the hidden part, the arc, and the reminder when one is due");

    // ── D. Settings and chat data from before these versions ──
    await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const state = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        const q = state.localProfile;
        delete q.plot;
        if (q.focus) { delete q.focus.autoApply; delete q.focus.voice; }
        prof.saveProfileToMemory();
        const g = c.extensionSettings.VCRP.globalSettings;
        if (g.memoryBudget) { delete g.memoryBudget.ceilingCost; delete g.memoryBudget.autoApprove; g.memoryBudget.holdTarget = true; }
        if (g.helper) { g.helper.enabled = false; g.helper.jobs = {}; }
        delete g.whatsNewSeen;
        for (const k of ["vcrp_canon", "vcrp_voice", "vcrp_threads", "vcrp_beats", "vcrp_arc", "vcrp_oneshot"]) delete c.chatMetadata[k];
        await c.saveMetadata();
        c.saveSettingsDebounced();
        await new Promise(r => setTimeout(r, 2500));
    }, base);
    const errorsBefore = rig.page.errors.length;
    await rig.page.send("Page.navigate", { url: `http://127.0.0.1:${R.PORTS.st}/` });
    await rig.page.waitFor(() => !!(window.SillyTavern && window.SillyTavern.getContext && document.querySelector("#send_textarea")) && !document.getElementById("preloader"), 240000);
    await sleep(2500);
    const src = fs.readFileSync(path.join(HERE, "rig.mjs"), "utf8");
    await rig.page.eval(src.match(/function installHelpers\(\) \{[\s\S]*?\n\}\n/)[0].trim());
    const tabs = await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const wait = ms => new Promise(r => setTimeout(r, ms));
        c.extensionSettings.VCRP.globalSettings.promptPreview = false;
        const run = cmd => c.executeSlashCommandsWithOptions(cmd, { handleParserErrors: false, handleExecutionErrors: false });
        await run(`/go "${(c.characters[0] || {}).name}"`);
        await wait(2500);
        const T = await import(base + "src/ui/tabs.js");
        const state = await import(base + "src/core/state.js");
        document.querySelector("#prompt-slot-fixed-btn")?.click();
        await wait(900);
        const out = { chat: window.SillyTavern.getContext().chat.length, plot: JSON.stringify(state.localProfile.plot), seen: [], empty: [] };
        for (let i = 0; i < T.tabsUI.length; i++) {
            document.querySelector(`#dot_${i}`)?.click();
            await wait(350);
            const stage = document.querySelector("#ps_stage_content");
            const chars = stage ? stage.innerText.trim().length : 0;
            out.seen.push(`${T.tabsUI[i].title}:${chars}`);
            if (chars < 80) out.empty.push(T.tabsUI[i].title);
        }
        // The pencil's editor, and the tab list, on a chat that has blocks.
        const BE = await import(base + "src/vcrp/blocksEditor.js");
        out.editor = BE.openBlocksEditor();
        await wait(300);
        out.editorBoxes = document.querySelectorAll("#vcrp_blocks_editor textarea.vcrp-be-area").length;
        document.querySelector("#vcrp_blocks_editor .vcrp-be-close")?.click();
        T.openTabMenu();
        await wait(200);
        out.menuItems = document.querySelectorAll("#vcrp_tab_menu .vcrp-tab-menu-item").length;
        document.querySelector("#vcrp_tab_menu .vcrp-tab-menu-close")?.click();
        document.querySelector("#ps_btn_save_close")?.click();
        await wait(500);
        const health = await import(base + "src/vcrp/health.js");
        out.health = health.vcrpHealthCheck().items.filter(i => i.level === "warn").map(i => i.title.slice(0, 90));
        return out;
    }, base);
    log(`── D. after a reload on settings without the new keys: chat of ${tabs.chat} messages, profile.plot ${tabs.plot}`);
    log(`   tabs drawn (title:characters): ${tabs.seen.join(" | ")}`);
    log(`   blocks editor ${tabs.editor} with ${tabs.editorBoxes} boxes | All tabs lists ${tabs.menuItems} | Setup Check warnings: ${JSON.stringify(tabs.health)}`);
    expect(tabs.empty.length === 0 && tabs.menuItems === tabs.seen.length && tabs.editor === true && tabs.editorBoxes >= 2, `every tab draws, the tab list has them all, the blocks editor opens (empty: ${tabs.empty.join(", ") || "none"})`);
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `${say("Hush now. Morning is near.", "amber")}\n\n${BLOCKS}` }));
    before = rig.mock.log.length;
    await rig.send("I close my eyes.", { timeout: 60000, quiet: 5000 });
    const last = rig.mock.log.slice(before).find(e => e.story);
    const lastText = last ? textOf(last.body) : "";
    m = await rig.last();
    expect(!!last && !/\[\[[A-Za-z_ ]+\]\]/.test(lastText) && /Morning is near/.test(String(m.mes)), `a reply goes out whole on them: ${last ? last.body.messages.length : 0} messages, tags left over ${JSON.stringify(lastText.match(/\[\[[A-Za-z_ ]+\]\]/g) || [])}, max_tokens ${last && last.body.max_tokens}`);
    const newErrors = rig.page.errors.slice(errorsBefore);
    expect(newErrors.length === 0, `no page error since the reload: ${JSON.stringify(newErrors.slice(-3))}`);
    for (const t of await rig.toasts()) if (t.kind === "error" || t.kind === "warning") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 200)}`);
    log(problems.length ? `${problems.length} PROBLEM(S): ${problems.join(" | ")}` : "ALL OF THE SWEEP HOLDS IN THE REAL APP");
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
