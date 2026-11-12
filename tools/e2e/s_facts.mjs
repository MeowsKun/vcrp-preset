// Facts and memory in the real app: the Canon sheet in the request, the continuity check by a
// helper on its own connection profile (the finding under the reply, the corrected swipe), and
// the helper's recall pick asked before a reply and used in it.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

    await L.openChat(rig);
    // A helper with a connection profile of its own, and two lines on this chat's Canon sheet.
    const setup = await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const cm = c.extensionSettings.connectionManager || (c.extensionSettings.connectionManager = { profiles: [] });
        cm.profiles = (cm.profiles || []).filter(p => p.id !== "e2e-helper");
        cm.profiles.push({ id: "e2e-helper", name: "E2E helper", mode: "cc", api: "openrouter", model: "google/gemini-4-argon", preset: "Default" });
        const g = c.extensionSettings.VCRP.globalSettings;
        g.helper = { enabled: true, profileId: "e2e-helper", testedProfileId: "e2e-helper", jobs: {}, blockRoutes: {} };
        g.blankRetry = false;
        g.memoryBudget = { ...(g.memoryBudget || {}), customPrice: { "google/gemini-4-argon": { input: 2, output: 10, read: 0.1 } }, recallTokens: 400 };
        c.powerUserSettings.reasoning.auto_parse = false;
        const canon = await import(base + "src/vcrp/canon.js");
        canon.addCanon("Seraphina has amber eyes.");
        canon.addCanon("The glade lies in the forest of Eldoria.");
        await c.saveMetadata();
        const aside = await import(base + "src/vcrp/helper/aside.js");
        return { canon: canon.canonItems().length, continuity: aside.helperAnswers("continuity"), recall: aside.helperAnswers("recall"), service: typeof c.ConnectionManagerRequestService?.sendRequest };
    }, base);
    log("setup:", JSON.stringify(setup));
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });

    // 1. A reply that contradicts the sheet: the helper is asked, and says so.
    rig.mock.aside = b => (/<established_facts>/.test(textOf(b)) ? 'CONTRADICTION: "her brown eyes" | Seraphina has amber eyes.' : /<chapters>/.test(textOf(b)) ? "C1" : "OK.");
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nSeraphina looks up, her brown eyes catching the firelight. "Rest," she says.` }));
    let before = rig.mock.log.length;
    await rig.send("How long was I out?", { timeout: 45000, quiet: 6000 });
    let sent = rig.mock.log.slice(before);
    const story = sent.find(e => e.story);
    const canonAt = (story.body.messages || []).findIndex(m => typeof m.content === "string" && m.content.includes("<canon>"));
    log(`── the request: ${story.body.messages.length} messages, roles ${story.body.messages.map(m => m.role[0]).join("")} | <canon> in message ${canonAt} (${story.body.messages[canonAt]?.role})`);
    const check = sent.find(e => !e.story && /<established_facts>/.test(textOf(e.body)));
    log(`── the helper's check: ${check ? `asked (${check.body.messages.length} messages, stream ${check.body.stream}), answered ${JSON.stringify(check.answered)}` : "NOT asked"}`);
    if (check) log(`   its question ends: ${JSON.stringify(textOf(check.body).slice(-330))}`);
    let m = await rig.last();
    const noteText = await rig.page.eval(() => document.querySelector("#chat .mes.last_mes .vcrp-continuity-note")?.textContent || null);
    log(`── under the reply: ${JSON.stringify(noteText)} | kept: ${JSON.stringify(m.extra && m.extra.vcrp_continuity)}`);

    // 2. A tap, then "Swipe with the correction": the swipe carries the facts as its direction.
    rig.mock.aside = () => "OK.";
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nSeraphina looks up, her amber eyes catching the firelight. "Rest," she says.` }));
    before = rig.mock.log.length;
    const dialog = await rig.page.eval(async () => {
        document.querySelector("#chat .mes.last_mes .vcrp-continuity-note")?.click();
        await new Promise(r => setTimeout(r, 300));
        const d = document.querySelector("dialog.vcrp-continuity-dialog");
        const out = { open: !!d && d.open, text: d ? d.innerText.replace(/\s+/g, " ").slice(0, 260) : "" };
        d?.querySelector(".vcrp-cont-fix")?.click();
        return out;
    });
    log(`── the dialog: open ${dialog.open} | ${JSON.stringify(dialog.text)}`);
    await rig.page.eval(() => window.__e2e.settle({ gens: 1, timeout: 45000, quiet: 6000 }));
    sent = rig.mock.log.slice(before);
    const swipe = sent.find(e => e.story);
    log(`── the corrected swipe: ${swipe ? `sent; its last message carries the direction: ${/Keep to what the story has established:\n- Established: Seraphina has amber eyes\./.test(textOf(swipe.body))}` : "NOT sent"}`);
    m = await rig.last();
    log(`   now: swipe ${m.swipe_id} of ${JSON.stringify(m.swipes)} | ${L.cut(m.mes, 90)} | note ${JSON.stringify(await rig.page.eval(() => document.querySelector("#chat .mes.last_mes .vcrp-continuity-note")?.textContent || null))}`);

    // 3. The recall pick: Story Memory with two old chapters cut from the prompt; before the next
    //    reply the helper is asked which to bring back, and the request carries its choice.
    const mem = await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        const state = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        const memory = await import(base + "src/vcrp/memory/index.js");
        state.localProfile.vcrpMemory = { ...(state.localProfile.vcrpMemory || {}), enabled: true };
        prof.saveProfileToMemory();
        const chat = memory.memoryChat();
        const st = memory.memoryState();
        Object.assign(st, {
            cut: memory.anchorOf(chat, 2), summarized: memory.anchorOf(chat, 2), shown: "", hiddenFacts: [], ledger: [], arcs: [], pending: [], lastRequestAt: Date.now(),
            chapters: [
                { id: "C1", gist: "Seraphina promised to guide the traveler to the old shrine.", chapter: "Seraphina promised the traveler she would guide him to the old shrine beyond the river once he could walk.", from: 0, to: 0, start: null, end: memory.anchorOf(chat, 1), when: "Day 1 · the glade" },
                { id: "C2", gist: "A beast prowled near the glade at night.", chapter: "A beast prowled near the glade at night and Seraphina drove it off with a ward.", from: 1, to: 1, start: memory.anchorOf(chat, 1), end: memory.anchorOf(chat, 2) },
            ],
        });
        await c.saveMetadata();
        return { messages: chat.length, cutAt: memory.resolveAnchor(chat, st.cut), candidates: (memory.recallCandidates() || { chapters: [] }).chapters.length };
    }, base);
    log("memory:", JSON.stringify(mem));
    rig.mock.aside = b => (/<chapters>/.test(textOf(b)) ? "C1" : "OK.");
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: L.GOOD }));
    before = rig.mock.log.length;
    await rig.send("When can we leave, as you said we would?", { timeout: 45000, quiet: 5000 });
    sent = rig.mock.log.slice(before);
    const pickAt = sent.findIndex(e => !e.story && /<chapters>/.test(textOf(e.body)));
    const storyAt = sent.findIndex(e => e.story);
    log(`── the recall pick: ${pickAt >= 0 ? `asked (request ${pickAt + 1} of ${sent.length}), before the reply's request (${storyAt + 1}): ${pickAt < storyAt}` : "NOT asked"}`);
    for (const e of sent) log(`   ${e.story ? "the reply" : "a helper or background call"}: ${(e.body.messages || []).length} messages, max_tokens ${e.body.max_tokens}, ends ${L.cut(textOf(e.body).slice(-70), 70)}`);
    if (storyAt >= 0) log(`   the reply's request carries the picked chapter: ${/<story_recall>[\s\S]*old shrine beyond the river/.test(textOf(sent[storyAt].body))} | and not the other: ${!/drove it off with a ward/.test(textOf(sent[storyAt].body))}`);
    for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 200)}`);

    // 4. The Canon sheet's panel in the settings window (Memory tab): what it shows, and a line
    //    added, reworded and taken off through it.
    const panel = await rig.page.eval(async base => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const canon = await import(base + "src/vcrp/canon.js");
        const tabs = await import(base + "src/ui/tabs.js");
        const at = tabs.tabsUI.findIndex(t => t.title === "Memory");
        document.querySelector("#prompt-slot-fixed-btn")?.click();
        await wait(700);
        document.querySelector(`#dot_${at}`)?.click();
        await wait(500);
        const read = () => {
            const p = document.querySelector("#ps_stage_content .vcrp-canon");
            return p ? { title: p.querySelector(".mtab-panel-title").textContent.trim(), lines: [...p.querySelectorAll(".vcanon-line")].map(i => i.value), offers: p.querySelectorAll(".vcanon-offer").length, check: (p.innerText.match(/Continuity check: (on|off)/) || [])[1], width: Math.round(p.getBoundingClientRect().width) } : null;
        };
        const out = { first: read() };
        const box = document.querySelector("#vcanon_new");
        box.value = "The shrine stands beyond the river.";
        document.querySelector("#vcanon_add").click();
        await wait(500);
        out.added = read();
        const line = document.querySelector("#ps_stage_content .vcanon-line");
        line.value = "Seraphina's eyes are amber.";
        line.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(500);
        out.reworded = read();
        document.querySelectorAll("#ps_stage_content .vcanon-remove")[1].click();
        await wait(500);
        out.removed = read();
        out.kept = canon.canonItems().map(i => i.text);
        out.saved = (window.SillyTavern.getContext().chatMetadata.vcrp_canon || { items: [] }).items.length;
        document.querySelector("#ps_btn_save_close")?.click();
        await wait(500);
        return out;
    }, base);
    log(`── the panel: ${JSON.stringify(panel.first)}`);
    log(`   a line added: ${JSON.stringify(panel.added && panel.added.lines)}`);
    log(`   the first reworded: ${JSON.stringify(panel.reworded && panel.reworded.lines)}`);
    log(`   the second taken off: ${JSON.stringify(panel.removed && panel.removed.lines)} | the sheet now: ${JSON.stringify(panel.kept)} (${panel.saved} in the chat's data)`);
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
