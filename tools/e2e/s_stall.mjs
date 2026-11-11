// A stream that goes quiet (the provider connection dropped; SillyTavern waits for good):
// the notice, a tap on it (stop and send again), and the reader's own Stop.
export default async function ({ rig, R, log, args }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const think = "Weighing the scene, the cast and what each of them wants before a word is written. ".repeat(6);
    const hang = () => ({ steps: [...R.thoughts(think), { reasoning: " and", wait: 200 }], end: "abrupt" });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    await rig.page.eval(async base => {
        const t = await import(base + "src/vcrp/generationTrace.js");
        t.vcrpSetStallTimes(4000, 1000);
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = true;
        c.extensionSettings.VCRP.globalSettings.blankRetry = true;
    }, base);
    const which = args[0] || "all";
    const state = () => rig.page.eval(() => {
        const c = window.SillyTavern.getContext();
        const m = c.chat[c.chat.length - 1] || {};
        return {
            generating: getComputedStyle(document.querySelector("#mes_stop")).display !== "none",
            toastsOnScreen: [...document.querySelectorAll("#toast-container .toast")].map(t => (t.querySelector(".toast-title")?.innerText || "") + " | " + (t.querySelector(".toast-message")?.innerText || "").slice(0, 150)),
            last: { u: !!m.is_user, mes: String(m.mes).slice(0, 50), swipes: (m.swipes || []).map(s => s.length), finish: (m.extra || {}).vcrp_finish ? { reason: m.extra.vcrp_finish.reason, ended: m.extra.vcrp_finish.ended, ms: m.extra.vcrp_finish.ms, quietMs: m.extra.vcrp_finish.quietMs, think: m.extra.vcrp_finish.think } : null },
            note: document.querySelector("#chat .mes.last_mes .vcrp-finish-note")?.textContent || null,
        };
    });
    const begin = async scripts => {
        await L.openChat(rig);
        await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); document.querySelectorAll("#toast-container .toast").forEach(t => t.remove()); });
        rig.mock.queue.length = 0;
        rig.mock.queue.push(...scripts);
        const before = rig.mock.log.filter(e => e.story).length;
        await rig.page.eval(() => { const ta = document.querySelector("#send_textarea"); ta.value = "How long was I out?"; ta.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#send_but").click(); });
        return () => rig.mock.log.filter(e => e.story).length - before;
    };

    if (which === "all" || which === "tap") {
        log("── a stream goes quiet; the reader taps the notice");
        const used = await begin([hang(), R.script({ content: L.GOOD })]);
        await sleep(8000);
        const s1 = await state();
        log("   after 8 s:", JSON.stringify(s1));
        const tapped = await rig.page.eval(() => { const t = [...document.querySelectorAll("#toast-container .toast")].find(x => /gone quiet/.test(x.innerText)); if (t) t.click(); return !!t; });
        log("   tapped the notice:", tapped);
        await rig.page.eval(() => window.__e2e.settle({ gens: 1, timeout: 40000 }));
        const s2 = await state();
        log("   then:", JSON.stringify(s2), "| story requests", used());
        for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 330)}`);
    }
    if (which === "all" || which === "stop") {
        log("── the reader presses Stop on a reply that is still reasoning");
        const used = await begin([{ steps: [...R.thoughts(think), { reasoning: " more", wait: 15000 }], end: "done" }, R.script({ content: L.GOOD })]);
        await sleep(2500);
        await rig.page.eval(() => document.querySelector("#mes_stop").click());
        await sleep(5000);
        const s = await state();
        log("   after Stop:", JSON.stringify(s), "| story requests", used());
        for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 330)}`);
        log("   received:", JSON.stringify((await rig.page.eval(() => window.__e2e.received())).map(r => ({ type: r.type, mes: r.mes.length, retry: r.retry, ended: r.finish && r.finish.ended, reason: r.finish && r.finish.reason }))));
    }
    if (which === "all" || which === "resume") {
        log("── a stream goes quiet and then goes on by itself");
        const used = await begin([R.script({ pre: [{ reasoning: "Considering. ", wait: 5 }, { reasoning: "Still considering.", wait: 7000 }], content: L.GOOD })]);
        await sleep(6000);
        log("   after 6 s:", JSON.stringify((await state()).toastsOnScreen));
        await rig.page.eval(() => window.__e2e.settle({ gens: 1, timeout: 40000 }));
        const s = await state();
        log("   then:", JSON.stringify(s), "| story requests", used());
    }
    await rig.page.eval(async base => { const t = await import(base + "src/vcrp/generationTrace.js"); t.vcrpSetStallTimes(0, 0); }, base);
}
