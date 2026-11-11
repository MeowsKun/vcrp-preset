// How the real SillyTavern + VCRP take the ways a stream can end with nothing (or badly).
//   node call.mjs s_stream.mjs [auto=0|1] [retry=0|1] [names...]
export default async function ({ rig, R, log, args }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const { COT, GOOD } = L;
    const think = "Weighing the scene, the cast and what each of them wants before a word is written. ".repeat(12);
    const usage = (out, reasoning) => ({ prompt_tokens: 41000, completion_tokens: out, total_tokens: 41000 + out, completion_tokens_details: { reasoning_tokens: reasoning }, prompt_tokens_details: { cached_tokens: 38000 } });
    const CASES = {
        length_in_reasoning: [R.script({ reasoning: think, content: "", finish: "length", native: "MAX_TOKENS", usage: usage(20000, 20000) })],
        length_in_cot: [R.script({ content: `<think>\n${COT}\n2b. Still weighing`, finish: "length", native: "MAX_TOKENS", usage: usage(20000, 19000) })],
        filter_prohibited: [R.script({ content: "", finish: "content_filter", native: "PROHIBITED_CONTENT", usage: usage(0, 0) })],
        other_as_filter: [R.script({ content: "", finish: "content_filter", native: "OTHER", usage: usage(0, 0) })],
        other_as_stop: [R.script({ reasoning: think, content: "", finish: "stop", native: "OTHER", usage: usage(900, 900) })],
        malformed_call: [R.script({ reasoning: think, content: "", finish: "error", native: "MALFORMED_FUNCTION_CALL", usage: usage(700, 700) })],
        stop_after_reasoning: [R.script({ reasoning: think, content: "", finish: "stop", native: "STOP", usage: usage(1200, 1200) })],
        abrupt_close: [{ steps: [...R.thoughts(think), { reasoning: " and", wait: 300 }], end: "abrupt" }],
        silent_close: [{ steps: [...R.thoughts(think)], end: "silent" }],
        error_chunk: [{ steps: [...R.thoughts(think.slice(0, 200)), { content: "", finish: "error", native: "error", error: { code: 502, message: "Provider returned error", metadata: { provider_name: "Google AI Studio" } } }], end: "done" }],
        http_502: [{ status: 502, errorBody: { error: { message: "Provider returned error", code: 502 } }, steps: [] }],
        http_429: [{ status: 429, errorBody: { error: { message: "Rate limit exceeded: free-models-per-min", code: 429 } }, steps: [] }],
        slow_keepalive: [R.script({ pre: [{ comment: true, wait: 3000 }, { comment: true, wait: 3000 }, { comment: true, wait: 3000 }], reasoning: think.slice(0, 160), content: GOOD })],
        good_with_reasoning: [R.script({ pre: [{ reasoning: "Considering. ", wait: 5 }, { reasoning: "The cast.", wait: 300 }, { content: "", wait: 300 }], content: GOOD })],
    };
    const flags = Object.fromEntries(args.filter(a => /^\w+=/.test(a)).map(a => a.split("=")));
    const names = args.filter(a => !/^\w+=/.test(a));
    const set = await rig.page.eval((auto, retry) => {
        const c = window.SillyTavern.getContext();
        if (auto !== null) c.powerUserSettings.reasoning.auto_parse = auto === "1";
        if (retry !== null) c.extensionSettings.VCRP.globalSettings.blankRetry = retry === "1";
        return { auto_parse: c.powerUserSettings.reasoning.auto_parse, blankRetry: c.extensionSettings.VCRP.globalSettings.blankRetry !== false };
    }, flags.auto ?? null, flags.retry ?? null);
    log("settings:", JSON.stringify(set));
    for (const name of names.length ? names : Object.keys(CASES)) {
        const out = await L.runOne(rig, R, log, name, [...CASES[name], R.script({ content: GOOD })]);
        if (out.m.noteDetail) log(`   note detail: ${out.m.noteDetail.replace(/\n/g, " ⏎ ").slice(0, 420)}`);
    }
}
