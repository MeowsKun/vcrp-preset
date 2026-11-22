// Gemini through NanoGPT, in the real app (10.0.0-vcrp.25 and .26). SillyTavern's own NanoGPT
// source, its requests answered by the mock: what the request looks like on that route beside
// the OpenRouter one (the after-chat rules, the turns, what is said about reasoning), what
// becomes of reasoning the provider sends back, and what Setup Check says when no thinking
// block shows: reasoning billed and none returned, thinking in reasoning_details alone (shown
// by VCRP), nothing back and no token counts, thinking sealed, VCRP's own block not written.
export default async function ({ rig, R, log }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const str = m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const problems = [];
    const expect = (ok, what) => { log(`   ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
    const STORY = "Seraphina kneels beside the bed of moss and presses a cool cloth to his brow. <font color=\"#a855f7\" title=\"Seraphina\">\"Easy now. The forest has you.\"</font>";

    // Connects SillyTavern's Chat Completion to a source, as the reader would in API Connections.
    const connect = source => rig.page.eval(async source => {
        const c = window.SillyTavern.getContext();
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const sel = document.querySelector("#chat_completion_source");
        sel.value = source;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(600);
        document.querySelector("#api_button_openai")?.click();
        for (let i = 0; i < 60 && c.onlineStatus === "no_connection"; i++) await wait(250);
        await wait(1200);
        const s = c.chatCompletionSettings;
        return { source: s.chat_completion_source, model: source === "nanogpt" ? s.nanogpt_model : s.openrouter_model, online: c.onlineStatus };
    }, source);
    const setProfile = (cot, effort = "auto", thoughts = true) => rig.page.eval(async (base, cot, effort, thoughts) => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        const g = c.extensionSettings.VCRP.globalSettings;
        g.blankRetry = false;
        if (g.helper) g.helper.enabled = false;
        const state = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        state.localProfile.cotEnabled = cot;
        prof.saveProfileToMemory();
        const set = (id, value, checked) => { const el = document.querySelector(id); if (!el) return; if (checked !== undefined) el.checked = checked; else el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
        set("#openai_reasoning_effort", effort);
        set("#openai_show_thoughts", null, thoughts);
        await new Promise(r => setTimeout(r, 300));
        return { effort: c.chatCompletionSettings.reasoning_effort, thoughts: c.chatCompletionSettings.show_thoughts };
    }, base, cot, effort, thoughts);
    const send = async (text, script) => {
        rig.mock.queue.length = 0;
        rig.mock.queue.push(script);
        const before = rig.mock.log.length;
        await rig.send(text, { timeout: 60000, quiet: 3500 });
        return rig.mock.log.slice(before).find(e => e.story) || null;
    };
    const shape = e => {
        const ms = e.body.messages, first = ms.findIndex(m => m.role !== "system");
        const roles = ms.slice(first).map(m => m.role[0]).join("");
        const userSide = ms.slice(first).filter(m => m.role === "user").map(str).join("\n");
        return {
            via: e.via, model: e.body.model, messages: ms.length, roles, systemAfterChat: ms.slice(first).some(m => m.role === "system"),
            alternates: !/uu|aa/.test(roles), endsOn: ms.at(-1).role, thinkAsked: /Open every reply with your own <think> block|<think>/.test(userSide), thinkInSystem: ms.filter(m => m.role === "system").some(m => /<think>/.test(str(m))),
            reasoning: JSON.stringify(e.body.reasoning), include: e.body.include_reasoning, effort: e.body.reasoning_effort,
        };
    };
    const whole = e => e.body.messages.map(m => `${m.role}: ${str(m)}`).join("\n\n");
    const plain = R.script({ content: STORY });

    for (const preset of ["VCRP V10 Universal", "VCRP V11 Megumin Original"]) {
        const profile = preset.includes("V10") ? { ...L.PROFILE, mode: "v10-core", model: "cot-v10-ukiyo-english" } : L.PROFILE;
        // The same chat and message through each provider.
        log(`── ${preset}, VCRP's thinking on ──`);
        const out = {};
        for (const source of ["openrouter", "nanogpt"]) {
            const c = await connect(source);
            await L.openChat(rig, { ...profile, notebook: { enabled: false } }, preset);
            await setProfile(true);
            const e = await send("How long was I out?", plain);
            if (!e) { expect(false, `${source}: no request reached the provider (${JSON.stringify(c)})`); continue; }
            out[source] = { e, s: shape(e) };
            log(`   ${source}: ${JSON.stringify(out[source].s)}`);
        }
        if (out.openrouter && out.nanogpt) {
            const a = out.openrouter, b = out.nanogpt;
            expect(b.s.via === "nanogpt" && a.s.via === "openrouter", "each request went to its own provider");
            expect(!b.s.systemAfterChat && b.s.alternates && b.s.endsOn === "user", "through NanoGPT nothing after the chat is a system message, the turns alternate, and the request ends on the reader's side");
            expect(b.s.thinkAsked && !b.s.thinkInSystem, "the thinking steps reach Gemini with the chat's last turns, not in the system instruction");
            expect(whole(a.e) === whole(b.e), "message for message, the NanoGPT request is the OpenRouter one");
        }
    }

    // What SillyTavern says to each provider about reasoning (its own doing, not VCRP's).
    log("── what SillyTavern sends about reasoning ──");
    await connect("nanogpt");
    await L.openChat(rig, { ...L.PROFILE, notebook: { enabled: false } });
    await setProfile(false, "auto", true);
    let e = await send("I try to sit up.", plain);
    log(`   NanoGPT, Reasoning Effort Auto, Request model reasoning on: reasoning ${JSON.stringify(e.body.reasoning)}, include_reasoning ${JSON.stringify(e.body.include_reasoning)}, reasoning_effort ${JSON.stringify(e.body.reasoning_effort)}`);
    expect(e.body.include_reasoning === undefined && e.body.reasoning_effort === undefined && JSON.stringify(e.body.reasoning) === "{}", "on Auto, NanoGPT is sent an empty reasoning setting and no request for the thinking");
    await setProfile(false, "medium", true);
    e = await send("I look around.", plain);
    log(`   NanoGPT, Reasoning Effort Medium: reasoning ${JSON.stringify(e.body.reasoning)}`);
    expect(!!(e.body.reasoning && e.body.reasoning.effort), "with an effort picked, it is named to NanoGPT");
    await setProfile(false, "auto", true);

    // The newest reply's Thinking box as SillyTavern drew it (its text is there while the box is
    // folded shut, which is how it starts).
    const thinkingBox = () => rig.page.eval(() => {
        const c = window.SillyTavern.getContext();
        const el = document.querySelector(`#chat .mes[mesid="${c.chat.length - 1}"]`);
        const box = el && el.querySelector(".mes_reasoning"), details = el && el.querySelector(".mes_reasoning_details");
        return { text: box ? box.textContent.trim() : null, drawn: !!el && el.classList.contains("reasoning"), state: el ? (el.dataset.reasoningState || null) : null, hasContent: details ? (details.dataset.hasContent || null) : null };
    });

    // Reasoning the provider does send back is shown.
    log("── reasoning NanoGPT sends back ──");
    e = await send("I listen.", R.script({ reasoning: "She is tending him; keep her gentle and brief. The forest is quiet tonight.", content: STORY }));
    let m = await rig.last();
    expect(/keep her gentle and brief/.test(String(m.extra && m.extra.reasoning)), `reasoning that arrives on this route is kept and shown (${String((m.extra && m.extra.reasoning) || "").length} characters)`);
    const nativeBox = await thinkingBox();
    log(`   SillyTavern's Thinking box for it: ${JSON.stringify(nativeBox)}`);
    const fate = () => rig.page.eval(async base => {
        const H = await import(base + "src/vcrp/health.js");
        const items = H.vcrpHealthCheck().items;
        const line = items.find(i => /thinking (came back|arrived)|No thinking came back|has no thinking block/.test(i.title));
        return { line: line ? `${line.title} | ${line.detail}` : null, route: (items.find(i => /after-chat instructions go as user messages/.test(i.title)) || {}).title || null };
    }, base);
    let f = await fate();
    expect(f.line === null && f.route === "NanoGPT + Gemini: after-chat instructions go as user messages", `Setup Check: nothing about missing thinking, and the route by its name (${f.route})`);

    // The model reasons (it is billed) and none of its thinking comes back.
    log("── reasoning billed, none returned ──");
    const billed = { prompt_tokens: 30000, completion_tokens: 3600, total_tokens: 33600, completion_tokens_details: { reasoning_tokens: 3200 }, prompt_tokens_details: { cached_tokens: 0 } };
    e = await send("I close my eyes.", R.script({ content: STORY, usage: billed }));
    m = await rig.last();
    f = await fate();
    log(`   the reply: reasoning kept ${String((m.extra && m.extra.reasoning) || "").length} characters; stamp ${JSON.stringify(m.extra && m.extra.vcrp_finish && { think: m.extra.vcrp_finish.think, usage: m.extra.vcrp_finish.usage })}`);
    log(`   Setup Check: ${f.line}`);
    expect(!!f.line && /none of its thinking came back/.test(f.line) && /but not to NanoGPT/.test(f.line) && /Pick a Reasoning Effort/.test(f.line), "Setup Check says the model reasoned and nothing came back, and what SillyTavern can send NanoGPT about it");
    // The same reply with the thinking written by VCRP's own Chain of Thought: nothing to say.
    await setProfile(true, "auto", true);
    e = await send("I wait.", R.script({ content: `<think>\n${L.COT}\n</think>\n${STORY}`, usage: billed }));
    f = await fate();
    m = await rig.last();
    expect(f.line === null && /<think>/.test(String(m.mes)), "with VCRP's own thinking in the reply there is nothing to say");

    // 10.0.0-vcrp.26. The ways a model's thinking can come back and not show, as NanoGPT streams
    // by default: no token counts. An effort is named, as in the report this came from.
    await setProfile(false, "high", true);
    const summary = text => ({ details: [{ type: "reasoning.summary", summary: text, format: "google-gemini-v1", index: 0 }], wait: 4 });
    const sealedEntry = { details: [{ type: "reasoning.encrypted", data: "AbCdEf0123456789==", format: "google-gemini-v1", index: 0 }], wait: 4 };
    const priced = { content: "", top: { x_nanogpt_pricing: { cost: 0.012 } } };

    log("── thinking in reasoning_details alone ──");
    e = await send("I open my eyes.", R.script({ content: STORY, usage: false, pre: [summary("She is tending him; "), summary("keep her gentle and brief.")], extra: [priced] }));
    m = await rig.last();
    f = await fate();
    log(`   the reply: reasoning ${JSON.stringify(String((m.extra && m.extra.reasoning) || ""))} (${m.extra && m.extra.reasoning_type}, mark ${m.extra && m.extra.vcrp_reasoning}); in the Thinking box: ${JSON.stringify(m.reasoningShown)}; stamp ${JSON.stringify(m.extra && m.extra.vcrp_finish && { think: m.extra.vcrp_finish.think, thinkElse: m.extra.vcrp_finish.thinkElse, also: m.extra.vcrp_finish.also, usage: m.extra.vcrp_finish.usage })}`);
    expect(String((m.extra && m.extra.reasoning) || "") === "She is tending him; keep her gentle and brief." && m.extra.vcrp_reasoning === "details", "thinking that came in reasoning_details alone is the reply's reasoning");
    const box = await thinkingBox();
    log(`   SillyTavern's Thinking box for it: ${JSON.stringify(box)}`);
    expect(box.text === "She is tending him; keep her gentle and brief." && box.drawn === nativeBox.drawn && box.state === nativeBox.state && box.hasContent === nativeBox.hasContent, "and SillyTavern's own Thinking box holds it, drawn as it draws a model's reasoning that came the usual way");
    expect(m.mes === STORY && f.line === null, "the reply's text is as it came, and Setup Check has nothing to say");
    const saved = await rig.page.eval(async () => {
        const c = window.SillyTavern.getContext();
        await c.saveChat();
        const last = c.chat[c.chat.length - 1];
        const info = Array.isArray(last.swipe_info) ? last.swipe_info[last.swipe_id] : null;
        return { reasoning: String((last.extra && last.extra.reasoning) || "").length, swipe: info && info.extra ? String(info.extra.reasoning || "").length : null };
    });
    expect(saved.reasoning === 46 && (saved.swipe === null || saved.swipe === 46), `it stays with the reply, and with its swipe (${JSON.stringify(saved)})`);

    log("── nothing back, and no token counts ──");
    e = await send("I breathe in.", R.script({ content: STORY, usage: false, extra: [priced] }));
    m = await rig.last();
    f = await fate();
    log(`   the reply: reasoning kept ${String((m.extra && m.extra.reasoning) || "").length} characters; stamp ${JSON.stringify(m.extra && m.extra.vcrp_finish && { think: m.extra.vcrp_finish.think, also: m.extra.vcrp_finish.also, usage: m.extra.vcrp_finish.usage, source: m.extra.vcrp_finish.source })}`);
    log(`   Setup Check: ${f.line}`);
    expect(!!f.line && /^No thinking came back with your last reply/.test(f.line) && /SillyTavern asked NanoGPT for the model's reasoning \(Reasoning Effort: High\)/.test(f.line) && /no token counts/.test(f.line) && /nothing more to ask with/.test(f.line), "Setup Check says nothing came back, what was asked, and that SillyTavern has no more to ask NanoGPT with");
    const card = await rig.page.eval(async base => {
        const H = await import(base + "src/vcrp/health.js");
        const report = H.vcrpThinkingReportText();
        const el = H.buildHealthCard(() => {});
        const btn = el.find(".vcrp-health-copy-thinking");
        const before = document.querySelectorAll("dialog.vcrp-text-dialog").length;
        btn.trigger("click");
        await new Promise(r => setTimeout(r, 600));
        const dlg = [...document.querySelectorAll("dialog.vcrp-text-dialog")].at(-1) || null;
        const shown = dlg && document.querySelectorAll("dialog.vcrp-text-dialog").length > before ? dlg.querySelector("textarea").value : null;
        if (dlg) { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); }
        const chatText = window.SillyTavern.getContext().chat.map(x => String(x.mes || "")).filter(Boolean);
        return { report, button: btn.length, shown, leaks: chatText.some(t => t.length > 12 && report.includes(t.slice(0, 40))) };
    }, base);
    log(`   the details to copy:\n${String(card.report).split("\n").map(l => "      " + l).join("\n")}`);
    expect(card.button === 1 && /^VCRP thinking details \(10\.0\.0-vcrp\.\d+\)\nconnection: nanogpt google\/gemini-4-argon/.test(card.report) && /Chain of Thought: off/.test(card.report) && /Request model reasoning on; Reasoning Effort high; streaming on/.test(card.report) && /token counts: none sent/.test(card.report) && /fields VCRP does not know: x_nanogpt_pricing/.test(card.report), "the card offers the thinking details, and they say what the answer carried");
    expect(card.leaks === false, "nothing of the chat's text is in them");

    log("── sealed, nothing to read ──");
    e = await send("I turn my head.", R.script({ content: STORY, usage: false, pre: [sealedEntry] }));
    m = await rig.last();
    f = await fate();
    log(`   Setup Check: ${f.line}`);
    expect(!!f.line && /^The model's thinking came back sealed on your last reply \| NanoGPT sent the reasoning encrypted \(1 sealed entry\)/.test(f.line) && String((m.extra && m.extra.reasoning) || "") === "", "sealed thinking is said as sealed, and nothing is put on the reply");

    log("── VCRP's own thinking asked for, none written ──");
    await setProfile(true, "high", true);
    e = await send("I say her name.", R.script({ content: STORY, usage: false }));
    f = await fate();
    log(`   Setup Check: ${f.line}`);
    expect(!!e && /Open every reply with your own <think> block/.test(whole(e)) && !!f.line && /^Chain of Thought is on, and your last reply has no thinking block/.test(f.line), "the block was asked for, the model wrote none, and Setup Check says so");
    await setProfile(false, "auto", true);

    await connect("openrouter");
    for (const t of await rig.toasts()) if (t.kind === "error") log(`   toast[error] ${t.title}: ${t.text.slice(0, 200)}`);
    log(problems.length ? `${problems.length} PROBLEM(S): ${problems.join(" | ")}` : "GEMINI THROUGH NANOGPT HOLDS IN THE REAL APP");
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
