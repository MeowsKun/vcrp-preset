// Characters that stay themselves, in the real app: a story in progress whose Mara turned soft
// half way. The voice anchors in the real request, the drift meter calling the audit, the
// audit shown her early lines, its correction applying itself and riding in the next request,
// then the Focus tab: the Voices panel, the applied audit, Undo.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const AUDIT = "<recurring>none</recurring>\n<findings>\n- [drift] Mara has gone soft and apologetic: \"I am so sorry, please\"\n</findings>\n<note>\nMara is curt again: short lines, no apologies, no trailing off.\n</note>";
    const SOFT = "Oh, I am so sorry, please, forgive me for keeping you waiting this long, okay...";

    await L.openChat(rig, { ...L.PROFILE, focus: { enabled: true, every: 10, checks: { drift: true, motifs: true, slop: true } } });
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    const seeded = await rig.page.eval(async () => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        c.extensionSettings.VCRP.globalSettings.blankRetry = false;
        const THINGS = ("anvil barrel candle dagger ember flask gauntlet hammer inkwell jar kettle lantern mallet needle oar pulley quill rope saddle tankard "
            + "urn vial wagon xylophone yoke zither apron bell chisel drum easel fiddle goblet harp idol jug kiln ladle mug net oven pan quiver rake spade "
            + "trowel urchin vase whistle yarn zipper arrow basket comb dice eel fan gong hinge ivory jewel knot lute mask nail orb").split(" ");
        const said = line => `<font color="#a855f7" title="Mara">"${line}"</font>`;
        const t0 = Date.now() - 3600e3;
        for (let i = 0; i < 59; i++) {
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date(t0 + i * 2000).toISOString(), mes: `I ask Mara about the ${THINGS[i]}.`, extra: {} });
            c.chat.push({ name: c.name2, is_user: false, is_system: false, send_date: new Date(t0 + i * 2000 + 1000).toISOString(), extra: {},
                mes: `The lamps burn low over the counter. ${said(i < 30 ? `Tch. Do not waste my time with that ${THINGS[i]}, kid.` : `Oh, I am so sorry, please, take all the time you need with the ${THINGS[i]} and then some more of it, okay...`)}` });
        }
        await c.saveChat();
        await c.reloadCurrentChat();
        await new Promise(r => setTimeout(r, 2500));
        return { messages: window.SillyTavern.getContext().chat.length };
    });
    log("seeded:", JSON.stringify(seeded));
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });

    // 1. A reply: the request carries her early lines; afterwards the meter calls the audit.
    rig.mock.aside = b => (/<earlier_findings>/.test(textOf(b)) ? AUDIT : "OK.");
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nMara looks away from the counter. <font color="#a855f7" title="Mara">"${SOFT}"</font>` }));
    let before = rig.mock.log.length;
    await rig.send("I ask Mara about the pearl.", { timeout: 60000, quiet: 3000 });
    await rig.page.waitFor(async () => {
        const f = await import("/scripts/extensions/third-party/vcrp-preset/src/vcrp/focus/index.js");
        const s = f.peekFocusState();
        return !!(s && s.audits >= 1) && !f.focusAuditRunning();
    }, 60000, 500);
    let sent = rig.mock.log.slice(before);
    const story = sent.find(e => e.story);
    const where = (story.body.messages || []).findIndex(m => typeof m.content === "string" && m.content.includes("[VOICES]"));
    const lastAssistant = story.body.messages.map(m => m.role).lastIndexOf("assistant");
    const voices = where >= 0 ? story.body.messages[where].content.slice(story.body.messages[where].content.indexOf("[VOICES]")).split("\n").slice(0, 3).join(" / ") : "";
    log(`── the request: ${story.body.messages.length} messages | [VOICES] in message ${where} (${where >= 0 ? story.body.messages[where].role : "-"}), after the last reply of the history (${lastAssistant}): ${where > lastAssistant}`);
    log(`   ${L.cut(voices, 330)}`);
    const audit = sent.find(e => !e.story && /<earlier_findings>/.test(textOf(e.body)));
    log(`── the audit: ${audit ? `asked (stream ${audit.body.stream}, ${audit.body.messages.length} messages), shown her early lines: ${/<early_voices>[\s\S]*- Mara: "Tch\. Do not waste my time with that anvil, kid\."/.test(textOf(audit.body))}, and what the meter counted: ${/Counted since \(a pointer, not a finding\): [^\n]*lines run longer/.test(textOf(audit.body))}` : "NOT asked"}`);
    const st = await rig.page.eval(async base => {
        const f = await import(base + "src/vcrp/focus/index.js");
        const v = await import(base + "src/vcrp/voice.js");
        const s = f.peekFocusState() || {};
        return { note: s.note, applied: !!f.appliedFocusAudit(), pending: !!s.pending, audits: s.audits, meter: s.meter, readings: v.driftReadings().map(r => ({ name: r.name, score: r.score, level: r.level, says: r.says })), plan: f.focusSchedule() };
    }, base);
    log(`── after it: correction ${JSON.stringify(st.note)} | applied by itself ${st.applied}, waiting for review ${st.pending} | audits ${st.audits}`);
    log(`   the meter: ${JSON.stringify(st.readings)}`);
    log(`   the next audit: ${JSON.stringify(st.plan)}`);
    for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 220)}`);

    // 2. The next reply's request carries the correction, and no second audit follows it.
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nMara snorts. <font color="#a855f7" title="Mara">"Tch. Took you long enough, kid."</font>` }));
    before = rig.mock.log.length;
    await rig.send("I wait.", { timeout: 60000, quiet: 9000 });
    sent = rig.mock.log.slice(before);
    const next = sent.find(e => e.story);
    log(`── the next request: carries the correction: ${/\[FOCUS\][\s\S]*Mara is curt again: short lines, no apologies, no trailing off\./.test(textOf(next.body))} | and the voices: ${textOf(next.body).includes("[VOICES]")} | audits asked after it: ${sent.filter(e => !e.story && /<earlier_findings>/.test(textOf(e.body))).length}`);

    // 3. The Focus tab in the real window.
    const tab = await rig.page.eval(async base => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const tabs = await import(base + "src/ui/tabs.js");
        const f = await import(base + "src/vcrp/focus/index.js");
        const flat = el => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
        document.querySelector("#prompt-slot-fixed-btn")?.click();
        await wait(700);
        document.querySelector(`#dot_${tabs.tabsUI.findIndex(t => t.title === "Focus")}`)?.click();
        await wait(600);
        const q = s => document.querySelector(`#ps_stage_content ${s}`);
        const out = {
            voices: flat(q("#focus_voice_panel .focus-voice-char summary")),
            width: q("#focus_voice_panel") ? Math.round(q("#focus_voice_panel").getBoundingClientRect().width) : 0,
            wide: q("#focus_voice_panel") ? q("#focus_voice_panel").scrollWidth > q("#focus_voice_panel").clientWidth + 2 : null,
            // (inside a closed <details>: textContent, which does not depend on its being shown)
            preview: q("#focus_voice_preview") ? q("#focus_voice_preview").textContent.replace(/\s+/g, " ").trim().slice(-170) : "",
            status: flat(q("#focus_status")),
            applied: (flat(q("#focus_applied_panel")) || "").slice(0, 260),
        };
        q("#focus_applied_undo")?.click();
        await wait(600);
        const s = f.peekFocusState() || {};
        out.undone = { note: s.note, pending: s.pending ? s.pending.note : null, applied: !!f.appliedFocusAudit(), panelGone: !q("#focus_applied_panel"), reviewBox: q("#focus_pending_note") ? q("#focus_pending_note").value : null };
        document.querySelector("#ps_btn_save_close")?.click();
        await wait(500);
        return out;
    }, base);
    log(`── the Focus tab: ${JSON.stringify(tab.voices)} | panel ${tab.width}px wide, scrolls sideways: ${tab.wide}`);
    log(`   what the next reply would get: ${JSON.stringify(tab.preview)}`);
    log(`   the schedule: ${JSON.stringify(tab.status)}`);
    log(`   applied by itself: ${JSON.stringify(tab.applied)}`);
    log(`   Undo: ${JSON.stringify(tab.undone)}`);
    for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 200)}`);
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
