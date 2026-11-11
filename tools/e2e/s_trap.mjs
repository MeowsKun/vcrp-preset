// What does the real SillyTavern keep of a reply whose thinking is not closed the way its
// Reasoning template expects? One fresh chat per variant; the mock answers a retry with a
// plain good reply, so a second story request shows VCRP retried.
//   node call.mjs s_trap.mjs [auto=0|1] [retry=0|1] [variant names...]
export default async function ({ rig, R, log, args }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const { COT, STORY, GOOD } = L;
    const VARIANTS = {
        A_good: { content: GOOD },
        B_close_same_line: { content: `<think>\n${COT}</think>\n${STORY}` },
        C_thinking_tag: { content: `<think>\n${COT}\n</thinking>\n${STORY}` },
        D_never_closed: { content: `<think>\n${COT}\n\n${STORY}` },
        E_api_reasoning_then_B: { reasoning: "Considering the scene and the cast before writing.", content: `<think>\n${COT}</think>\n${STORY}` },
        F_stops_after_think: { content: `<think>\n${COT}\n</think>\n` },
        G_caret_close: { content: `<think>\n^1. ^Where ^are ^we.\n^</think>\n^Seraphina ^kneels ^beside ^the ^bed ^of ^moss.` },
        H_space_before_close: { content: `<think>\n${COT}\n </think>\n${STORY}` },
        I_only_api_reasoning: { reasoning: "Thinking about the scene at length. ".repeat(20), content: "" },
        J_nothing: { content: "" },
        K_api_reasoning_then_good: { reasoning: "Considering the scene and the cast before writing.", content: GOOD },
        L_crlf_close: { content: `<think>\r\n${COT}\r\n</think>\r\n${STORY}` },
        M_no_newline_after_open: { content: `<think>${COT}\n</think>\n${STORY}` },
        N_slow_api_reasoning_then_B: { pre: [{ reasoning: "Considering the scene. ", wait: 5 }, { reasoning: "And the cast.", wait: 400 }, { content: "", wait: 400 }], content: `<think>\n${COT}</think>\n${STORY}` },
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
    for (const name of names.length ? names : Object.keys(VARIANTS)) {
        const out = await L.runOne(rig, R, log, name, [R.script(VARIANTS[name]), R.script({ content: GOOD })]);
        if (flags.show === "1") log(`   shown: ${L.cut(out.m.shown, 200)}`);
    }
}
