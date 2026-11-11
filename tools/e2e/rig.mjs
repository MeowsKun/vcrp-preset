// End-to-end rig: a real SillyTavern, the real VCRP from this working tree, a real headless
// Chrome, and a scripted provider standing in for OpenRouter.
//
// The unit suites (test_fork, test_cache, test_ui) run VCRP against a stand-in for SillyTavern.
// This runs it inside the real one, which is where the causes of the empty replies of
// 10.0.0-vcrp.17 were found: SillyTavern's Reasoning Auto-Parse leaving a reply in the Thinking
// box, its server not noticing a provider connection that dropped, a Stop taken for a failure.
//
// Needs a SillyTavern checkout with its node_modules (VCRP_E2E_ST, default C:/ST/SillyTavern)
// and Chrome (VCRP_E2E_CHROME). Nothing in that checkout is changed: the run has a data root
// and a config of its own under VCRP_E2E_WORK (default: the system temp folder), seeded with a
// copy of that install's settings.json, a made-up API key, this repo's presets and this
// working tree as the extension. The server's requests to openrouter.ai are sent to the
// scripted provider by preload.mjs; no real provider is called and nothing is spent.
//
//   node tools/e2e/daemon.mjs            keeps the rig up (a minute or two to start)
//   node tools/e2e/call.mjs tools/e2e/s_trap.mjs [auto=0|1] [names...]     runs a scenario
//   node tools/e2e/call.mjs tools/e2e/s_reload.mjs                          this tree's code, reloaded
//   node tools/e2e/call.mjs --stop
// Scenarios: s_trap (how a reply's thinking is closed), s_stream (the ways a stream ends),
// s_stall (a stream gone quiet, Stop), s_real (an engine with blocks and Gemini JB).
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ST = process.env.VCRP_E2E_ST || "C:/ST/SillyTavern";
export const REPO = path.resolve(HERE, "../..");
// Everything the run writes (the data root, the config, Chrome's profile, the server's log)
// goes here, outside the repo: the working tree is copied into the data root as the extension.
export const WORK = process.env.VCRP_E2E_WORK || path.join(os.tmpdir(), "vcrp-e2e");
const CHROME = process.env.VCRP_E2E_CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => fs.existsSync(p)) || "chrome";
export const PORTS = { st: 8791, mock: 8792, cdp: 8793 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── The mock provider ────────────────────────────────────────────────────────
const MODEL = {
    id: "google/gemini-4-argon", name: "Google: Gemini 4 Argon", context_length: 2000000,
    pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000002" },
    architecture: { modality: "text->text", tokenizer: "Gemini", instruct_type: null },
    top_provider: { context_length: 2000000, max_completion_tokens: 65536, is_moderated: false },
    per_request_limits: null, supported_parameters: ["reasoning", "include_reasoning", "max_tokens", "temperature", "top_p", "stop"],
};
let genSeq = 0;
const chunkOf = (script, step) => ({
    id: script.id, provider: script.provider || "Google AI Studio", model: MODEL.id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
    choices: step.noChoice ? [] : [{
        index: 0,
        delta: { role: "assistant", content: step.content ?? "", ...(step.reasoning !== undefined ? { reasoning: step.reasoning } : {}) },
        finish_reason: step.finish ?? null, native_finish_reason: step.native ?? null, logprobs: null,
    }],
    ...(step.usage ? { usage: step.usage } : {}),
    ...(step.error ? { error: step.error } : {}),
});

async function play(script, res) {
    script.id = script.id || `gen-e2e-${++genSeq}`;
    if (script.status && script.status !== 200) {
        res.writeHead(script.status, { "content-type": "application/json" });
        res.end(JSON.stringify(script.errorBody || { error: { message: "Provider returned error", code: script.status } }));
        return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    for (const step of script.steps) {
        if (step.wait) await sleep(step.wait);
        if (res.destroyed) return;
        if (step.comment) { res.write(": OPENROUTER PROCESSING\n\n"); continue; }
        if (step.raw !== undefined) { res.write(step.raw); continue; }
        res.write(`data: ${JSON.stringify(chunkOf(script, step))}\n\n`);
    }
    if (script.end === "abrupt") { res.socket && res.socket.destroy(); return; }
    if (script.end === "silent") { res.end(); return; }   // closes without [DONE]
    res.write("data: [DONE]\n\n");
    res.end();
}

/** Text as a stream of content steps. */
export const pieces = (text, size = 28) => { const out = []; for (let i = 0; i < text.length; i += size) out.push({ content: text.slice(i, i + size), wait: 4 }); return out; };
export const thoughts = (text, size = 40) => { const out = []; for (let i = 0; i < text.length; i += size) out.push({ reasoning: text.slice(i, i + size), wait: 4 }); return out; };
/** A whole scripted answer: optional native reasoning, the content, how it ended. */
export function script({ reasoning = "", content = "", finish = "stop", native = "STOP", usage = null, end = "done", extra = [], provider, pre = [] } = {}) {
    const out = Math.ceil(content.length / 4), think = Math.ceil(reasoning.length / 4);
    const u = usage || { prompt_tokens: 30000, completion_tokens: out + think, total_tokens: 30000 + out + think, completion_tokens_details: { reasoning_tokens: think }, prompt_tokens_details: { cached_tokens: 0 } };
    const steps = [...pre, ...thoughts(reasoning), ...pieces(content), ...extra];
    if (finish !== null) steps.push({ content: "", finish, native });
    if (u !== false && finish !== null) steps.push({ content: "", usage: u });
    return { steps, end, provider };
}

export function startMock() {
    const state = { queue: [], log: [], server: null };
    const json = (res, body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    state.server = http.createServer((req, res) => {
        let body = "";
        req.on("data", c => { body += c; });
        req.on("end", async () => {
            const url = req.url || "";
            try {
                if (req.method === "GET" && url.startsWith("/api/v1/models")) return json(res, { data: [MODEL] });
                if (req.method === "POST" && url.startsWith("/api/v1/chat/completions")) {
                    let b = {};
                    try { b = JSON.parse(body); } catch (e) { b = {}; }
                    const text = JSON.stringify(b.messages || []);
                    const task = /___PS_[A-Z_]+___|\[VCRP MEMORY TASK/.test(text);
                    const entry = { at: Date.now(), body: b, task, story: false, played: null };
                    state.log.push(entry);
                    if (b.stream && !task && state.queue.length) { entry.story = true; entry.played = state.queue.shift(); return await play(entry.played, res); }
                    if (b.stream) return await play(script({ content: "OK." }), res);
                    return json(res, { id: `gen-e2e-${++genSeq}`, provider: "Google AI Studio", model: MODEL.id, choices: [{ index: 0, message: { role: "assistant", content: "OK." }, finish_reason: "stop", native_finish_reason: "STOP" }], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } });
                }
                return json(res, { data: {} });
            } catch (e) { console.error("[mock]", e); try { res.end(); } catch (e2) { /* gone */ } }
        });
    });
    return new Promise(resolve => state.server.listen(PORTS.mock, "127.0.0.1", () => resolve(state)));
}

// ── The data root for the run ────────────────────────────────────────────────
function prepareData({ autoParse = true, template = null, settingsPatch = null } = {}) {
    const data = path.join(WORK, "data");
    // Only ever a folder this rig made: it is cleared for each run.
    if (path.resolve(data).startsWith(path.resolve(REPO)) || path.resolve(data).startsWith(path.resolve(ST))) throw new Error("the work folder must be outside the repo and SillyTavern: " + data);
    if (fs.existsSync(data) && !fs.existsSync(path.join(data, ".vcrp-e2e"))) throw new Error("refusing to clear a folder this rig did not make: " + data);
    fs.rmSync(data, { recursive: true, force: true });
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, ".vcrp-e2e"), "made by tools/e2e/rig.mjs; cleared on every run\n");
    const user = path.join(data, "default-user");
    fs.mkdirSync(path.join(user, "OpenAI Settings"), { recursive: true });
    fs.mkdirSync(path.join(user, "extensions"), { recursive: true });
    // The reader's own settings (a copy), pointed at the mock's model.
    const s = JSON.parse(fs.readFileSync(path.join(ST, "data/default-user/settings.json"), "utf8"));
    s.main_api = "openai";
    Object.assign(s.oai_settings, { chat_completion_source: "openrouter", openrouter_model: MODEL.id, stream_openai: true });
    s.power_user.auto_connect = true;
    s.power_user.auto_load_chat = false;
    s.power_user.reasoning = { ...(s.power_user.reasoning || {}), auto_parse: !!autoParse, ...(template || {}) };
    s.active_character = "";
    s.extension_settings.preset_allowed_regex = { openai: ["VCRP V11 Megumin Original", "VCRP V10 Universal", "VCRP V10 Megumin Original"] };
    s.extension_settings.disabledExtensions = [...new Set([...(s.extension_settings.disabledExtensions || []), "third-party/Extension-Summaryception", "third-party/SillyTavern-MemoryBooks"])];
    // The prompt-preview popup (the reader has it on) waits for a tap before every request.
    if (s.extension_settings.VCRP && s.extension_settings.VCRP.globalSettings) Object.assign(s.extension_settings.VCRP.globalSettings, { whatsNewSeen: "e2e", promptPreview: false });
    if (typeof settingsPatch === "function") settingsPatch(s);
    fs.writeFileSync(path.join(user, "settings.json"), JSON.stringify(s, null, 1));
    fs.writeFileSync(path.join(user, "secrets.json"), JSON.stringify({ api_key_openrouter: [{ id: "e2e", value: "sk-or-e2e-not-a-key", label: "e2e", active: true }] }, null, 1));
    for (const f of fs.readdirSync(path.join(REPO, "Presets")).filter(x => x.endsWith(".json"))) fs.copyFileSync(path.join(REPO, "Presets", f), path.join(user, "OpenAI Settings", f));
    // The extension: the repo's working tree as it stands.
    const dest = path.join(user, "extensions", "vcrp-preset");
    fs.cpSync(REPO, dest, { recursive: true, filter: src => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) });
    // A config of its own, so the reader's config.yaml is never read or rewritten.
    let cfg = fs.readFileSync(path.join(ST, "default/config.yaml"), "utf8");
    cfg = cfg.replace(/^enableDownloadableTokenizers: true/m, "enableDownloadableTokenizers: false").replace(/^(\s+)autoUpdate: true/m, "$1autoUpdate: false").replace(/^(\s+)autoDownload: true/m, "$1autoDownload: false");
    fs.writeFileSync(path.join(WORK, "config.yaml"), cfg);
    return data;
}

/** Copies the repo's current code over the extension in the running data root (then reload the page). */
export function syncExtension() {
    const dest = path.join(WORK, "data", "default-user", "extensions", "vcrp-preset");
    fs.cpSync(REPO, dest, { recursive: true, force: true, filter: src => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) });
}

// ── Chrome over the DevTools protocol ────────────────────────────────────────
class Page {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.waiting = new Map(); this.console = []; this.errors = [];
        ws.addEventListener("message", ev => {
            const m = JSON.parse(ev.data);
            if (m.id && this.waiting.has(m.id)) { const { resolve, reject } = this.waiting.get(m.id); this.waiting.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); return; }
            if (m.method === "Runtime.consoleAPICalled") {
                const text = m.params.args.map(a => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(" ");
                this.console.push({ type: m.params.type, text });
            }
            if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        });
    }
    send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject })); }
    /** Runs `fn(...args)` in the page (a function or its source); a promise is awaited. */
    async eval(fn, ...args) {
        const expression = `(${typeof fn === "function" ? fn.toString() : fn})(${args.map(a => JSON.stringify(a)).join(",")})`;
        const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    }
    async waitFor(fn, timeout = 120000, every = 300) {
        const t0 = Date.now();
        for (;;) {
            let ok = false;
            try { ok = await this.eval(fn); } catch (e) { ok = false; }
            if (ok) return true;
            if (Date.now() - t0 > timeout) throw new Error("timed out waiting for " + fn.toString().slice(0, 120));
            await sleep(every);
        }
    }
}

async function httpOk(url) { try { const r = await fetch(url); return r.status < 500; } catch (e) { return false; } }
async function until(fn, timeout, what) { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > timeout) throw new Error("timed out: " + what); await sleep(400); } }

// In-page helpers, installed once per load.
function installHelpers() {
    const c = window.SillyTavern.getContext();
    window.__toasts = [];
    for (const kind of ["info", "success", "warning", "error"]) {
        const orig = window.toastr[kind].bind(window.toastr);
        window.toastr[kind] = (text, title, opts) => { window.__toasts.push({ kind, title: String(title || ""), text: String(text || "") }); return orig(text, title, opts); };
    }
    // Every reply as it stood when it arrived (after VCRP's own handlers; a retry comes later).
    window.__received = [];
    c.eventSource.on(c.eventTypes.MESSAGE_RECEIVED, (id, type) => {
        const m = c.chat[Number(id)] || {};
        const x = m.extra || {};
        window.__received.push({ id: Number(id), type, mes: String(m.mes ?? ""), reasoning: String(x.reasoning || ""), reasoning_type: x.reasoning_type || null, finish: x.vcrp_finish ? JSON.parse(JSON.stringify(x.vcrp_finish)) : null, rescued: x.vcrp_rescued || null, retry: x.vcrp_blank_retry || null });
    });
    const generating = () => { const b = document.querySelector("#mes_stop"); return !!b && getComputedStyle(b).display !== "none"; };
    const settle = async ({ gens = 1, quiet = 2500, timeout = 120000, started = null } = {}) => {
        let ended = 0;
        const onEnd = () => { ended++; };
        c.eventSource.on(c.eventTypes.GENERATION_ENDED, onEnd);
        if (started) await started();
        const t0 = Date.now();
        let since = null;
        while (Date.now() - t0 < timeout) {
            await new Promise(r => setTimeout(r, 150));
            if (ended >= gens && !generating()) { since = since ?? Date.now(); if (Date.now() - since >= quiet) break; } else since = null;
        }
        c.eventSource.removeListener(c.eventTypes.GENERATION_ENDED, onEnd);
        return { ended, ms: Date.now() - t0 };
    };
    window.__e2e = {
        settle,
        send: (text, opts) => settle({ ...opts, started: async () => {
            const ta = document.querySelector("#send_textarea");
            ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true }));
            document.querySelector("#send_but").click();
        } }),
        swipe: opts => settle({ ...opts, started: async () => { document.querySelector("#chat .mes.last_mes .swipe_right").click(); } }),
        last: () => {
            const i = c.chat.length - 1, m = c.chat[i] || {};
            const el = document.querySelector(`#chat .mes[mesid="${i}"]`);
            return {
                n: c.chat.length, is_user: !!m.is_user, mes: m.mes, extra: m.extra || null, swipe_id: m.swipe_id, swipes: Array.isArray(m.swipes) ? m.swipes.map(s => String(s).length) : null,
                note: el && el.querySelector(".vcrp-finish-note") ? el.querySelector(".vcrp-finish-note").textContent : null,
                noteDetail: el && el.querySelector(".vcrp-finish-note") ? el.querySelector(".vcrp-finish-note").title : null,
                shown: el && el.querySelector(".mes_text") ? el.querySelector(".mes_text").innerText : "",
                reasoningShown: el && el.querySelector(".mes_reasoning") ? el.querySelector(".mes_reasoning").innerText.slice(0, 160) : "",
            };
        },
        toasts: () => { const t = window.__toasts; window.__toasts = []; return t; },
        received: () => { const t = window.__received.slice(); window.__received.length = 0; return t; },
    };
    return true;
}

// ── Start and stop ───────────────────────────────────────────────────────────
export async function start(opts = {}) {
    const data = prepareData(opts);
    const mock = await startMock();
    const logPath = path.join(WORK, "st-server.log");
    const log = fs.openSync(logPath, "w");
    const st = spawn(process.execPath, ["--import", pathToFileURL(path.join(HERE, "preload.mjs")).href, "server.js",
        "--dataRoot", data, "--configPath", path.join(WORK, "config.yaml"), "--port", String(PORTS.st), "--listen", "false", "--browserLaunchEnabled", "false"],
    { cwd: ST, env: { ...process.env, VCRP_MOCK_PORT: String(PORTS.mock) }, stdio: ["ignore", log, log] });
    const prof = path.join(WORK, "chrome-prof");
    fs.rmSync(prof, { recursive: true, force: true });
    let chrome = null, page = null;
    const stop = async () => {
        try { page && page.ws.close(); } catch (e) { /* closed */ }
        for (const p of [chrome, st]) { try { p && p.kill(); } catch (e) { /* gone */ } }
        await new Promise(r => mock.server.close(() => r())); mock.server.closeAllConnections && mock.server.closeAllConnections();
    };
    try {
        await until(() => httpOk(`http://127.0.0.1:${PORTS.st}/`), 180000, "SillyTavern to start");
        chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORTS.cdp}`, `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=430,900", "about:blank"], { stdio: "ignore" });
        await until(() => httpOk(`http://127.0.0.1:${PORTS.cdp}/json/version`), 30000, "Chrome to start");
        const targets = await (await fetch(`http://127.0.0.1:${PORTS.cdp}/json/list`)).json();
        const ws = new globalThis.WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
        page = new Page(ws);
        await page.send("Runtime.enable");
        await page.send("Page.enable");
        const load = async () => {
            await page.send("Page.navigate", { url: `http://127.0.0.1:${PORTS.st}/` });
            await page.waitFor(() => !!(window.SillyTavern && window.SillyTavern.getContext && document.querySelector("#send_textarea")) && !document.getElementById("preloader"), 240000);
            await sleep(2500);   // extensions finish loading
            await page.eval(installHelpers);
        };
        await load();
        const rig = {
            mock, page, logPath, stop, reload: load,
            /** Opens a fresh chat with the default character and sets the VCRP profile for it. */
            async openChat(profile = {}, preset = "VCRP V11 Megumin Original") {
                return page.eval(async (profile, preset) => {
                    const c = window.SillyTavern.getContext();
                    const run = cmd => c.executeSlashCommandsWithOptions(cmd, { handleParserErrors: false, handleExecutionErrors: false });
                    await run(`/preset "${preset}"`);
                    const name = (c.characters[0] || {}).name;
                    if (c.characterId === undefined || c.characterId === null) await run(`/go "${name}"`); else await run("/newchat");
                    await new Promise(r => setTimeout(r, 1500));
                    const base = "/scripts/extensions/third-party/vcrp-preset/";
                    const state = await import(base + "src/core/state.js");
                    const prof = await import(base + "src/core/profile.js");
                    const q = state.localProfile;
                    for (const [k, v] of Object.entries(profile)) {
                        if (v && typeof v === "object" && !Array.isArray(v) && q[k] && typeof q[k] === "object") Object.assign(q[k], v); else q[k] = v;
                    }
                    prof.saveProfileToMemory();
                    await new Promise(r => setTimeout(r, 300));
                    return { char: name, chat: c.chat.length, mode: q.mode, model: q.model, cot: q.cotEnabled, addons: q.addons, online: c.onlineStatus, preset: c.chatCompletionSettings.preset_settings_openai, src: c.chatCompletionSettings.chat_completion_source, orModel: c.chatCompletionSettings.openrouter_model };
                }, profile, preset);
            },
            send: (text, o = {}) => page.eval((text, o) => window.__e2e.send(text, o), text, o),
            swipe: (o = {}) => page.eval(o => window.__e2e.swipe(o), o),
            last: () => page.eval(() => window.__e2e.last()),
            toasts: () => page.eval(() => window.__e2e.toasts()),
            received: () => page.eval(() => window.__e2e.received()),
            /** The repo's code as it stands now, loaded afresh. */
            async refresh() { syncExtension(); await load(); },
        };
        return rig;
    } catch (e) {
        await stop();
        throw e;
    }
}
