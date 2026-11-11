// Loaded into the SillyTavern server process (node --import): every request the server makes
// to openrouter.ai goes to the mock on this machine instead. Nothing else is touched, and
// nothing in the SillyTavern folder is changed: this only lives in the test process.
import https from "node:https";
import http from "node:http";

const PORT = Number(process.env.VCRP_MOCK_PORT || 0);
const orig = https.request;
https.request = function vcrpE2eRequest(input, options, cb) {
    try {
        const u = typeof input === "string" ? new URL(input) : (input instanceof URL ? input : null);
        const opts = (u ? (typeof options === "object" && options ? options : {}) : (input || {}));
        const host = u ? u.hostname : (opts.hostname || opts.host || "");
        if (PORT && /(^|\.)openrouter\.ai$/.test(String(host))) {
            const done = typeof options === "function" ? options : cb;
            return http.request({
                hostname: "127.0.0.1", port: PORT,
                path: u ? u.pathname + u.search : opts.path,
                method: opts.method || "GET", headers: opts.headers, signal: opts.signal,
            }, done);
        }
    } catch (e) { console.error("[e2e preload]", e); }
    return orig.apply(this, arguments);
};
console.info("[e2e preload] openrouter.ai -> 127.0.0.1:" + PORT);
