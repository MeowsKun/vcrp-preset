// Keeps the rig up (SillyTavern + Chrome + mock) and runs scenario files against it on request,
// so a scenario takes seconds instead of a server start each time.
//   node tools/e2e/daemon.mjs [1|0: SillyTavern's Reasoning Auto-Parse]      then:  node tools/e2e/call.mjs <scenario.mjs> [args...]
import http from "node:http";
import { pathToFileURL } from "node:url";
import * as R from "./rig.mjs";

const autoParse = process.argv[2] !== "0";
const rig = await R.start({ autoParse });
console.log("[daemon] rig up, autoParse=" + autoParse);

const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
        const lines = [];
        const log = (...a) => lines.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x, null, 1))).join(" "));
        let ok = true, error = "";
        try {
            const cmd = JSON.parse(body || "{}");
            if (cmd.stop) { res.end(JSON.stringify({ ok: true, lines: ["stopping"] })); await rig.stop(); server.close(); process.exit(0); }
            const mod = await import(pathToFileURL(cmd.file).href + "?t=" + Date.now());
            await mod.default({ rig, R, log, args: cmd.args || [] });
        } catch (e) { ok = false; error = String((e && e.stack) || e); }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok, error, lines }));
    });
});
server.listen(8794, "127.0.0.1", () => console.log("[daemon] listening on 8794"));
