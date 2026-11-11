// Shared by the scenarios (imported afresh on every call, so edits here need no rig restart).
export const COT = "1. Where are we: the glade at dusk.\n2. What does she want: to keep him resting.\n3. Final check: no speaking for the reader.";
export const STORY = "Seraphina kneels beside the bed of moss and presses a cool cloth to his brow. \"Easy now,\" she murmurs. \"The forest has you.\" Outside, the glade hums with fireflies.";
export const GOOD = `<think>\n${COT}\n</think>\n${STORY}`;
export const PROFILE = { mode: "v11-voice-megumin", model: "cot-v11-voice-english", cotEnabled: true, addons: ["color"], blocks: [], blockStack: { order: [] }, npcBank: { enabled: false }, vcrpMemory: { enabled: false }, focus: { enabled: false } };
export const cut = (s, n = 80) => JSON.stringify(String(s || "").slice(0, n));

/** Waits until nothing is generating, opens a fresh chat, sets the VCRP profile for it. */
export async function openChat(rig, profile = PROFILE, preset = "VCRP V11 Megumin Original") {
    return rig.page.eval(async (profile, preset) => {
        const c = window.SillyTavern.getContext();
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const busy = () => { const b = document.querySelector("#mes_stop"); return !!b && getComputedStyle(b).display !== "none"; };
        for (let i = 0; i < 200 && busy(); i++) await wait(150);
        await wait(1200);   // debounced saves of the chat being left
        const run = cmd => c.executeSlashCommandsWithOptions(cmd, { handleParserErrors: false, handleExecutionErrors: false });
        if (c.chatCompletionSettings.preset_settings_openai !== preset) await run(`/preset "${preset}"`);
        const name = (c.characters[0] || {}).name;
        const cur = window.SillyTavern.getContext().characterId;
        if (cur === undefined || cur === null) await run(`/go "${name}"`); else await run("/newchat");
        await wait(1500);
        const base = "/scripts/extensions/third-party/vcrp-preset/";
        const state = await import(base + "src/core/state.js");
        const prof = await import(base + "src/core/profile.js");
        const q = state.localProfile;
        for (const [k, v] of Object.entries(profile)) {
            if (v && typeof v === "object" && !Array.isArray(v) && q[k] && typeof q[k] === "object") Object.assign(q[k], v); else q[k] = v;
        }
        prof.saveProfileToMemory();
        await wait(400);
        return { chat: c.chat.length, mode: q.mode, cot: q.cotEnabled, addons: q.addons, blocks: q.blocks, order: q.blockStack && q.blockStack.order };
    }, profile, preset);
}

/** One reply (and whatever VCRP does after it), reported: what arrived each time, the toasts, the end state. */
export async function runOne(rig, R, log, name, scripts, { profile = PROFILE, said = "How long was I out?", quiet = 2500, timeout = 60000 } = {}) {
    await openChat(rig, profile);
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    rig.mock.queue.length = 0;
    rig.mock.queue.push(...scripts);
    const before = rig.mock.log.filter(e => e.story).length;
    const sent = await rig.send(said, { timeout, quiet });
    const m = await rig.last();
    const used = rig.mock.log.filter(e => e.story).length - before;
    const received = await rig.page.eval(() => window.__e2e.received());
    const toasts = (await rig.toasts()).filter(t => t.title !== "VCRP: blocks");
    log(`── ${name}: story requests ${used}${used > 1 ? " (RETRIED)" : ""} | final: mes ${String(m.mes || "").length} chars, swipe ${m.swipe_id} of ${JSON.stringify(m.swipes)}, ${m.n} messages | note ${JSON.stringify(m.note)}`);
    for (const r of received) {
        const f = r.finish || {};
        log(`   received(${r.type}): mes ${r.mes.length} ${cut(r.mes, 56)} | reasoning ${r.reasoning.length} (${r.reasoning_type}) ${cut(r.reasoning, 40)}…${cut(r.reasoning.slice(-36), 36)} | stamp ${f.reason}/${f.native}${f.raw ? "/" + f.raw : ""} out ${f.usage && f.usage.out}${f.ms !== undefined ? ` | ${f.ms} ms, first ${f.firstMs} ms, text ${f.text}, think ${f.think}, ended ${f.ended}` : ""}${r.rescued ? " | RESCUED" : ""}${f.error ? ` | error ${cut(f.error, 60)}` : ""}`);
    }
    for (const t of toasts) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 300)}`);
    return { m, used, received, toasts, sent };
}
