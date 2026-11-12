// The story's state by hand and the regrouped window, in the real app: the pencil on a reply's
// blocks card, the editor (a character taken out of the scene, the edit saved, the next request
// handed the edited blocks); the dock as a phone's bar with its all-tabs menu, and as a
// desktop rail under its headings. Pass a folder as the first argument to get screenshots.
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

export default async function ({ rig, R, log, args }) {
    const L = await import(new URL("./lib.mjs?t=" + Date.now(), import.meta.url));
    const base = "/scripts/extensions/third-party/vcrp-preset/";
    const shots = args[0] || "";
    const textOf = b => (b.messages || []).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const shot = async name => {
        if (!shots) return;
        const r = await rig.page.send("Page.captureScreenshot", { format: "png" });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.data, "base64"));
    };
    const size = (width, height, mobile) => rig.page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    const BLOCKS = "<Blocks>\n<Scene>\nHere: Mara, +Old Martin\nRemote: Jonah\n</Scene>\n<World_State>\n**📅 Time:** Day 2, dusk | **🌤 Loc:** The pier | Saltmere | **🌡 Wx:** Rain\n\n---\n\n**🧍 Traveler:**\n* *Outfit:* a wet coat\n\n---\n\n**👥 NPCs Present:**\n**Mara Voss:**\n* *Outfit:* an oilskin\n* *Mood:* wary\n**Old Martin:**\n* *Outfit:* a patched jersey\n\n---\n**📡 Off-Screen:**\n* Jonah: mending nets at the harbour\n\n---\n**🔥 Unresolved Threads:**\n* Who sent the letter?\n**🎯 Arc Phase:** Setup\n</World_State>\n<Bonds>\nMara Voss: Affection: 48/100 (+2 she laughed) | Trust: 30/100 (=)\nOld Martin: Affection: 10/100 (=) | Trust: 12/100 (=)\n</Bonds>\n</Blocks>";

    await size(430, 900, true);
    await L.openChat(rig, { ...L.PROFILE, blocks: undefined, blockStack: { order: ["world", "bonds"] }, focus: { enabled: false, live: { swipes: false, repeats: false, user: false } } });
    await rig.page.eval(async base => {
        const c = window.SillyTavern.getContext();
        c.powerUserSettings.reasoning.auto_parse = false;
        c.extensionSettings.VCRP.globalSettings.blankRetry = false;
        const reg = await import(base + "src/features/blocks/registry.js");
        const prof = await import(base + "src/core/profile.js");
        reg.meguminSyncLegacyBlockIds();
        prof.saveProfileToMemory();
    }, base);
    await rig.page.eval(() => { window.__e2e.toasts(); window.__e2e.received(); });
    rig.mock.aside = () => "OK.";

    // 1. A reply with its blocks; the pencil on its card opens the editor.
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nMara looks away from the rail, and Old Martin spits over the side.\n\n${BLOCKS}` }));
    await rig.send("I ask Mara about the letter.", { timeout: 60000, quiet: 5000 });
    const card = await rig.page.eval(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const el = document.querySelector("#chat .mes.last_mes");
        const pencil = el && el.querySelector(".meg-blocks-edit");
        const out = { card: !!(el && el.querySelector(".meg-blocks")), pencil: !!pencil, tabs: el ? [...el.querySelectorAll(".meg-blocks-tab")].map(b => b.getAttribute("aria-label")) : [] };
        if (pencil) pencil.click();
        await wait(400);
        const d = document.getElementById("vcrp_blocks_editor");
        out.editor = d ? { open: d.open, boxes: d.querySelectorAll("textarea.vcrp-be-area").length, cast: [...d.querySelectorAll(".vcrp-be-remove")].map(b => b.getAttribute("data-name")), width: Math.round(d.getBoundingClientRect().width), fits: d.scrollWidth <= d.clientWidth + 2, top: Math.round(d.getBoundingClientRect().top), height: Math.round(d.getBoundingClientRect().height) } : null;
        return out;
    });
    log(`── the card: ${JSON.stringify({ card: card.card, pencil: card.pencil, tabs: card.tabs })}`);
    log(`── the editor: ${JSON.stringify(card.editor)}`);
    await shot("1-editor-phone");
    const edited = await rig.page.eval(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const d = () => document.getElementById("vcrp_blocks_editor");
        d().querySelector('.vcrp-be-remove[data-name="Mara"]').click();
        await wait(300);
        const scene = d().querySelectorAll("textarea.vcrp-be-area")[0].value;
        const world = d().querySelectorAll("textarea.vcrp-be-area")[1].value;
        d().querySelector(".vcrp-be-save").click();
        await wait(1500);
        const c = window.SillyTavern.getContext();
        const m = c.chat[c.chat.length - 1];
        const el = document.querySelector("#chat .mes.last_mes");
        return { scene, maraGone: !/Mara Voss:\*\*/.test(world), offscreen: /\* Mara: left the scene/.test(world), closed: !d(), saved: /Here: \+Old Martin/.test(m.mes) && /\* Mara: left the scene/.test(m.mes), swipe: Array.isArray(m.swipes) ? m.swipes[m.swipe_id] === m.mes : null, cardAgain: !!(el && el.querySelector(".meg-blocks")), proseKept: /Mara looks away from the rail/.test(m.mes) };
    });
    log(`── Remove, then Save: ${JSON.stringify(edited)}`);
    for (const t of await rig.toasts()) if (/VCRP: blocks/.test(t.title) && !/missing blocks/.test(t.text)) log(`   toast[${t.kind}] ${t.title}: ${t.text.slice(0, 160)}`);
    rig.mock.queue.length = 0;
    rig.mock.queue.push(R.script({ content: `<think>\n${L.COT}\n</think>\nOld Martin watches her go.\n\n${BLOCKS}` }));
    const before = rig.mock.log.length;
    await rig.send("I watch her leave.", { timeout: 60000, quiet: 5000 });
    const next = textOf(rig.mock.log.slice(before).find(e => e.story).body);
    log(`── the next request: handed the edited blocks: ${/The blocks as they stood at the end of your last reply\.[\s\S]*Here: \+Old Martin[\s\S]*\* Mara: left the scene/.test(next)} | her old entry gone: ${!/\*\*Mara Voss:\*\*\n\* \*Outfit:\* an oilskin/.test(next)} | her Bonds line kept: ${/Mara Voss: Affection: 48\/100/.test(next)}`);

    // 2. The window on a phone: the bar, the all-tabs menu, the pill brought into view.
    const phone = await rig.page.eval(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        document.querySelector("#prompt-slot-fixed-btn")?.click();
        await wait(900);
        const dock = document.getElementById("ps_dynamic_dots");
        const shown = el => !!el && getComputedStyle(el).display !== "none";
        const out = {
            bar: Math.round(dock.getBoundingClientRect().height) < 90 && getComputedStyle(dock).flexDirection === "row",
            menuFirst: dock.firstElementChild && dock.firstElementChild.id === "ps_dock_menu" && shown(dock.firstElementChild),
            headingsShown: [...dock.querySelectorAll(".dock-group-label")].filter(shown).length,
            pills: [...dock.querySelectorAll(".sidebar-step")].filter(shown).map(el => el.textContent.trim()),
        };
        dock.firstElementChild.click();
        await wait(400);
        const menu = document.getElementById("vcrp_tab_menu");
        out.menu = menu ? { open: menu.open, items: menu.querySelectorAll(".vcrp-tab-menu-item").length, width: Math.round(menu.getBoundingClientRect().width), fits: menu.scrollWidth <= menu.clientWidth + 2 } : null;
        return out;
    });
    log(`── the phone's bar: ${JSON.stringify({ bar: phone.bar, menuFirst: phone.menuFirst, headingsShown: phone.headingsShown })}`);
    log(`   pills, in order: ${phone.pills.join(" | ")}`);
    log(`   the all-tabs menu: ${JSON.stringify(phone.menu)}`);
    await shot("2-menu-phone");
    const picked = await rig.page.eval(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        [...document.querySelectorAll("#vcrp_tab_menu .vcrp-tab-menu-item")].find(b => /Plot/.test(b.textContent)).click();
        await wait(700);
        const dock = document.getElementById("ps_dynamic_dots");
        const dot = dock.querySelector(".sidebar-step.active");
        const r = dot.getBoundingClientRect(), d = dock.getBoundingClientRect();
        return { menuClosed: !document.getElementById("vcrp_tab_menu"), tab: dot.getAttribute("title"), page: !!document.querySelector("#ps_stage_content #plot_arc_panel"), pillInView: r.left >= d.left - 1 && r.right <= d.right + 1, scrolled: Math.round(dock.scrollLeft) };
    });
    log(`   a tap on Plot: ${JSON.stringify(picked)}`);
    await shot("3-plot-phone");

    // 3. The same window on a desktop: a rail under its headings, every tab reachable.
    await size(1366, 768, false);
    const desk = await rig.page.eval(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        await wait(600);
        const dock = document.getElementById("ps_dynamic_dots");
        const shown = el => !!el && getComputedStyle(el).display !== "none";
        const d = dock.getBoundingClientRect();
        const dots = [...dock.querySelectorAll(".sidebar-step")];
        const last = dots[dots.length - 1].getBoundingClientRect();
        return {
            rail: getComputedStyle(dock).flexDirection === "column", width: Math.round(d.width), height: Math.round(d.height),
            menuShown: shown(document.getElementById("ps_dock_menu")), headings: [...dock.querySelectorAll(".dock-group-label")].filter(shown).map(el => el.textContent.trim()),
            dots: dots.filter(shown).length, row: Math.round(dots[0].getBoundingClientRect().height),
            needsScroll: dock.scrollHeight > dock.clientHeight + 1, scrolls: getComputedStyle(dock).overflowY, lastInView: last.bottom <= d.bottom + 1,
        };
    });
    log(`── the desktop rail (1366×768): ${JSON.stringify(desk)}`);
    await shot("4-rail-desktop");
    // Opened, as the pointer over it would: the headings read.
    const at = await rig.page.eval(() => { const d = document.getElementById("ps_dynamic_dots").getBoundingClientRect(); return { x: Math.round(d.left + d.width / 2), y: Math.round(d.top + d.height / 2) }; });
    await rig.page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await new Promise(r => setTimeout(r, 900));
    const hover = await rig.page.eval(() => {
        const dock = document.getElementById("ps_dynamic_dots");
        const label = dock.querySelector(".dock-group-label span");
        return { width: Math.round(dock.getBoundingClientRect().width), headingOpacity: label ? getComputedStyle(label).opacity : null };
    });
    log(`   with the pointer over it: ${JSON.stringify(hover)}`);
    await shot("5-rail-open-desktop");
    await rig.page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 800, y: 400 });
    await rig.page.eval(async () => { document.querySelector("#ps_btn_save_close")?.click(); await new Promise(r => setTimeout(r, 500)); });
    await size(430, 900, true);
    log("page errors:", JSON.stringify(rig.page.errors.slice(-3)));
}
