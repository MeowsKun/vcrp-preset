// The reader's own setup (their engine, thinking, add-ons and blocks, on the V10 Megumin
// Original preset), with replies the way Gemini writes them: blocks at the end, and with the
// Gemini JB add-on a ^ before every word. A reply whose thinking closes on the same line.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const BLOCKS = "\n\n<Blocks>\n<Scene>\nHere: Seraphina\nRemote:\n</Scene>\n<World_State>\nDusk in the glade; the reader rests on a bed of moss.\n</World_State>\n<NPC_Inner_Chatter>\nSeraphina: He is awake at last.\n</NPC_Inner_Chatter>\n<Bonds>\nSeraphina: Mood: relieved | Affection: 12/100 (+1)\n</Bonds>\n</Blocks>";
    const reply = (close, caret = false) => {
        const cot = "The reader has just woken. Seraphina would keep him still and answer plainly; no speaking for him.";
        const story = `Seraphina kneels beside the bed of moss and presses a cool cloth to his brow. <font color="#7fd1c7" title="Seraphina">"A day and a night,"</font> she says. <font color="#7fd1c7" title="Seraphina">"The forest kept you."</font>`;
        const c = s => (caret ? s.replace(/(^|[\s>])([A-Za-z"'(])/g, "$1^$2") : s);
        return `<think>\n${c(cot)}${close}${c(story)}${BLOCKS}`;
    };
    const profile = { mode: "v10-shura-megumin", model: "cot-meg-shura-english", cotEnabled: true, npcBank: { enabled: false }, vcrpMemory: { enabled: false }, focus: { enabled: false } };
    await rig.page.eval(() => { const c = window.SillyTavern.getContext(); c.powerUserSettings.reasoning.auto_parse = true; c.extensionSettings.VCRP.globalSettings.blankRetry = true; });
    const cases = [
        ["Shura engine, blocks: thinking closed to the letter", profile, reply("\n</think>\n")],
        ["Shura engine, blocks: thinking closed on the same line", profile, reply("</think>\n")],
        ["with Gemini JB (a ^ before every word): closed on the same line", { ...profile, addons: ["color", "bold_npcs", "html", "gemini_jb"] }, reply("^</think>\n", true)],
    ];
    for (const [name, prof, content] of cases) {
        await L.openChat(rig, prof, "VCRP V10 Megumin Original");
        await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
        rig.mock.queue.length = 0;
        rig.mock.queue.push(R.script({ content }), R.script({ content: reply("\n</think>\n") }));
        const before = rig.mock.log.length;
        await rig.send("How long was I out?", { timeout: 60000 });
        const m = await rig.last();
        const reqs = rig.mock.log.slice(before);
        log(`── ${name}: requests ${reqs.length} (story ${reqs.filter(e => e.story).length}, other ${reqs.filter(e => !e.story).length}) | swipes ${JSON.stringify(m.swipes)} | rescued ${m.extra && m.extra.vcrp_rescued} | note ${JSON.stringify(m.note)}`);
        log(`   mes: ${L.cut(m.mes, 110)} … ${L.cut(String(m.mes).slice(-40), 40)}`);
        log(`   has ^: ${/\^/.test(m.mes)} | has <Blocks>: ${/<Blocks>/.test(m.mes)} | thinking box: ${L.cut(m.extra && m.extra.reasoning, 60)}`);
        log(`   shown: ${L.cut(m.shown, 150)}`);
        for (const t of await rig.toasts()) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 160)}`);
    }
    // Setup Check in the real app.
    const check = await rig.page.eval(async () => {
        const h = await import("/scripts/extensions/third-party/vcrp-preset/src/vcrp/health.js");
        const r = h.vcrpHealthCheck();
        return { items: r.items.filter(i => /Auto-Parse|came back empty|last \d+ repl|Of the last/.test(i.title)).map(i => `[${i.level}] ${i.title} :: ${i.detail.slice(0, 260)}`), copy: h.vcrpEmptyRepliesText().slice(0, 700) };
    });
    log("Setup Check:", JSON.stringify(check, null, 1));
}
