// The cost rule in the real app: a reply that comes to more than the target arrives whole; a
// prompt that leaves no room under the ceiling is not sent (and the app stays usable); a
// background call goes out with no limit of VCRP's; each reply is priced from the API's count.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const PRICE = { "google/gemini-4-argon": { input: 2, output: 10, read: 0.1 } };
    const setBudget = b => rig.page.eval((b, price) => {
        const c = window.SillyTavern.getContext();
        const g = c.extensionSettings.VCRP.globalSettings;
        g.memoryBudget = { ...(g.memoryBudget || {}), customPrice: price, ...b };
        c.powerUserSettings.reasoning.auto_parse = false;
        g.blankRetry = false;
        return g.memoryBudget;
    }, b, PRICE);
    const usage = (input, cached, out, reasoning = 0) => ({ prompt_tokens: input, completion_tokens: out, total_tokens: input + out, completion_tokens_details: { reasoning_tokens: reasoning }, prompt_tokens_details: { cached_tokens: cached } });
    const lastStory = () => rig.mock.log.filter(e => e.story).at(-1);
    const report = async (name, before) => {
        const m = await rig.last();
        const sent = rig.mock.log.slice(before);
        const c = (m.extra && m.extra.vcrp_cost) || null;
        const badge = await rig.page.eval(() => document.querySelector("#chat .mes.last_mes .vcrp-cost-badge")?.textContent || null);
        log(`── ${name}: requests ${sent.length} (story ${sent.filter(e => e.story).length}) | last message ${m.is_user ? "yours" : "the reply"}, ${String(m.mes || "").length} chars | note ${JSON.stringify(m.note)} | badge ${JSON.stringify(badge)}`);
        if (c && !m.is_user) log(`   cost: total $${c.total.toFixed(4)}, from the bill ${c.billedIn}, cold ${c.cold}, tokens ${JSON.stringify(c.tokens)}, output ${c.output}`);
        for (const t of await rig.toasts()) if (t.title !== "VCRP: blocks") log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 420)}`);
        return { m, sent, c };
    };
    const send = async (said, scripts, opts = {}) => {
        rig.mock.queue.length = 0;
        rig.mock.queue.push(...scripts);
        const before = rig.mock.log.length;
        await rig.send(said, { timeout: 45000, ...opts });
        return before;
    };

    await L.openChat(rig);
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    log("budget:", JSON.stringify(await setBudget({ targetCost: 0.2, ceilingCost: 0.5 })));

    // 1. An ordinary reply, mostly read from the cache by the API's own count.
    let before = await send("How long was I out?", [R.script({ content: L.GOOD, usage: usage(60000, 52000, 3000, 1200) })]);
    let r = await report("an ordinary reply (60k prompt, 52k from the cache, 3k written)", before);
    log(`   the request's own limit: max_tokens ${lastStory().body.max_tokens}`);

    // 2. A reply that comes to more than the $0.20 target: it arrives whole.
    const long = `<think>\n${L.COT}\n</think>\n` + (L.STORY + " ").repeat(40).trim();
    before = await send("Tell me everything.", [R.script({ content: long, usage: usage(80000, 0, 9000, 6000) })]);
    r = await report("a reply that comes to $0.25 (over the target, under the ceiling)", before);
    log(`   arrived whole: ${String(r.m.mes).endsWith("fireflies.")} (${String(r.m.mes).length} of ${long.length} chars) | max_tokens ${lastStory().body.max_tokens}`);

    // 3. A prompt that leaves no room under the ceiling: not sent, said why, and the app goes on.
    await setBudget({ ceilingCost: 0.03 });
    before = await send("And then?", [R.script({ content: L.GOOD })], { timeout: 12000 });
    r = await report("a ceiling the prompt cannot fit under ($0.03)", before);
    const state = await rig.page.eval(() => ({ generating: getComputedStyle(document.querySelector("#mes_stop")).display !== "none", messages: window.SillyTavern.getContext().chat.length }));
    log(`   after it: still generating ${state.generating} | ${state.messages} messages in the chat`);
    await setBudget({ ceilingCost: 0.5 });
    before = await send("Go on.", [R.script({ content: L.GOOD, usage: usage(60000, 50000, 2500, 900) })]);
    r = await report("the ceiling back at $0.50: the next message goes out", before);

    // 4. A background call (the second call for missing blocks) carries no limit of VCRP's.
    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world", "bonds"] } });
    await rig.page.eval(async () => {
        const base = "/scripts/extensions/third-party/vcrp-preset/";
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
    });
    before = await send("Where are we?", [R.script({ content: L.GOOD, usage: usage(60000, 50000, 2500, 0) })], { quiet: 6000 });
    const sent = rig.mock.log.slice(before);
    log(`── a reply without its blocks: ${sent.length} requests`);
    for (const e of sent) log(`   ${e.story ? "the reply" : "a background call"}: max_tokens ${e.body.max_tokens}, stream ${e.body.stream}, ${(e.body.messages || []).length} messages`);
    await rig.toasts();
}
