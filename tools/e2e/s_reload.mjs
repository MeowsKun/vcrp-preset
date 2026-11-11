// Copies the repo's current code into the running SillyTavern and reloads the page.
// The daemon imported rig.mjs once, so in-page helpers are installed again here from the file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function ({ rig, R, log }) {
    R.syncExtension();
    await rig.page.send("Page.navigate", { url: `http://127.0.0.1:${R.PORTS.st}/` });
    await rig.page.waitFor(() => !!(window.SillyTavern && window.SillyTavern.getContext && document.querySelector("#send_textarea")) && !document.getElementById("preloader"), 240000);
    await new Promise(r => setTimeout(r, 2500));
    // installHelpers from the file as it is now
    const src = fs.readFileSync(path.join(HERE, "rig.mjs"), "utf8");
    const m = src.match(/function installHelpers\(\) \{[\s\S]*?\n\}\n/);
    await rig.page.eval(m[0].trim());
    if (!rig.received) rig.received = () => rig.page.eval(() => window.__e2e.received());
    const v = await rig.page.eval(async () => {
        const mod = await import("/scripts/extensions/third-party/vcrp-preset/src/vcrp/whatsNew.js");
        const c = window.SillyTavern.getContext();
        c.extensionSettings.VCRP.globalSettings.promptPreview = false;
        return mod.WHATS_NEW_ID;
    });
    log("reloaded, VCRP " + v);
}
