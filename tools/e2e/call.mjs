// node call.mjs <scenario.mjs> [args...]   |   node call.mjs --stop
// node:http, not fetch: a scenario may run for many minutes before it answers.
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
const arg = process.argv[2];
const body = JSON.stringify(arg === "--stop" ? { stop: true } : { file: path.resolve(arg), args: process.argv.slice(3) });
const out = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: 8794, path: "/", method: "POST", headers: { "content-length": Buffer.byteLength(body) } }, res => {
        let t = "";
        res.on("data", c => { t += c; });
        res.on("end", () => { try { resolve(JSON.parse(t)); } catch (e) { reject(new Error("bad answer: " + t.slice(0, 200))); } });
    });
    req.on("error", reject);
    req.end(body);
});
for (const l of out.lines || []) console.log(l);
if (!out.ok) { console.error("SCENARIO FAILED:\n" + out.error); process.exit(1); }
