// Calibrates the drift meter (src/vcrp/voice.js) on a folder of real SillyTavern chats.
// It prints numbers only: never a word of any chat. Nothing is written or sent anywhere.
//
//   node tools/voice_calibrate.mjs <SillyTavern>/data/default-user/chats
//
// What it measures, with the meter's own functions:
//   - the same lines, split at random into a "before" and a "now": what chance alone reads
//     (the meter's "drifting" mark should be reached about once in a hundred of these);
//   - a speaker's earliest lines against their latest: what long stories really read;
//   - one speaker's earliest against another's latest: voices that really are different;
//   - two windows side by side early in a story against the first window and the last: how
//     much of a reading is only one scene being unlike the next.
// Speakers are taken by the color of their lines, so chats from before the speaker names on
// the tags can be used too (a model that changed a character's color mid-story blurs them).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) { console.log("Usage: node tools/voice_calibrate.mjs <folder of chats: one folder per character, .jsonl files inside>"); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const stub = await import(pathToFileURL(path.join(HERE, "st_stub.mjs")).href);
globalThis.__ST__ = {
    extension_settings: {}, getContext: () => ({ chat: [], chatMetadata: {} }), substituteParams: s => s, saveSettingsDebounced() {}, saveMetadata() {}, saveChat() {},
    chat_metadata: {}, isGenerating: () => false, debounce: fn => fn, cancelDebounce() {}, humanizedDateTime: () => "now", generateQuietPrompt: async () => "",
    checkWorldInfo: async () => ({}), getSortedEntries: async () => [],
    event_types: new Proxy({}, { get: (t, k) => String(k) }), eventSource: { on() {}, once() {}, emit: async () => {}, removeListener() {} },
};
stub.installBrowserGlobals();
globalThis.extension_settings = globalThis.__ST__.extension_settings;
const { ext } = stub.buildFakeTree("voice-calibrate");
const V = await import(pathToFileURL(path.join(ext, "src/vcrp/voice.js")).href);

const FONT = /<font\b([^>]*)>([\s\S]*?)<\/font\s*>/gi;
const colorOf = a => { const m = a.match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i); return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim().toLowerCase() : ""; };
const clean = t => t.replace(/<[^>]+>/g, " ").replace(/[*_~`]+/g, "").replace(/\s+/g, " ").trim().replace(/^["“„«]+|["”»]+$/g, "").trim();

// A seeded shuffle, so a run can be repeated.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const q = (arr, p) => { if (!arr.length) return NaN; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const groups = [];   // every color with enough lines: its lines, in order
for (const dir of fs.readdirSync(root)) {
    const d = path.join(root, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(x => x.endsWith(".jsonl"))) {
        const by = new Map();
        for (const l of fs.readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).slice(1)) {
            let m; try { m = JSON.parse(l); } catch (e) { continue; }
            if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
            const body = m.mes.replace(/<Blocks\b[^>]*>[\s\S]*?(?:<\/Blocks\s*>|$)/gi, "").replace(/^[\s\S]*<\/think(?:ing)?\s*>/i, "");
            for (const x of body.matchAll(FONT)) {
                const c = colorOf(x[1]); const t = clean(x[2]);
                if (!c || !t) continue;
                if (!by.has(c)) by.set(c, []);
                by.get(c).push(t);
            }
        }
        for (const lines of by.values()) if (lines.length >= V.METER_MIN_LINES) groups.push(lines);
    }
}
if (!groups.length) { console.log(`No speaker in these chats has ${V.METER_MIN_LINES} colored lines: nothing to measure.`); process.exit(0); }
console.log(`speakers with at least ${V.METER_MIN_LINES} lines: ${groups.length}; lines each: min ${Math.min(...groups.map(g => g.length))}, median ${q(groups.map(g => g.length), 0.5)}, max ${Math.max(...groups.map(g => g.length))}`);

const drift = (a, b) => V.voiceDrift(V.voiceProfile(a), V.voiceProfile(b));
const noise = [], noiseParts = {}, real = [], realParts = {}, cross = [], adjacent = [], farApart = [];
for (const g of groups) for (let rep = 0; rep < 40; rep++) {
    const s = V.meterSamples(shuffle(g));
    const d = drift(s.base, s.recent);
    noise.push(d.score);
    for (const p of d.parts) (noiseParts[p.key] = noiseParts[p.key] || []).push(p.amount);
}
for (const g of groups) {
    const s = V.meterSamples(g);
    const d = drift(s.base, s.recent);
    real.push(d.score);
    for (const p of d.parts) (realParts[p.key] = realParts[p.key] || []).push(p.amount);
}
for (let i = 0; i < groups.length; i++) for (let j = 0; j < groups.length; j++) {
    if (i !== j) cross.push(drift(V.meterSamples(groups[i]).base, V.meterSamples(groups[j]).recent).score);
}
for (const g of groups.filter(x => x.length >= 120)) {
    adjacent.push(drift(g.slice(0, 30), g.slice(30, 60)).score, drift(g.slice(30, 60), g.slice(60, 90)).score);
    farApart.push(drift(g.slice(0, 30), g.slice(-30)).score);
}
const row = (name, a) => `${name.padEnd(40)} n ${String(a.length).padStart(5)} | median ${String(q(a, 0.5)).padStart(3)} | p75 ${String(q(a, 0.75)).padStart(3)} | p90 ${String(q(a, 0.9)).padStart(3)} | p95 ${String(q(a, 0.95)).padStart(3)} | max ${Math.max(...a)}`;
console.log(row("the same lines, split at random", noise));
console.log(row("earliest against latest", real));
if (cross.length) console.log(row("one speaker against another", cross));
if (adjacent.length) { console.log(row("two early windows side by side", adjacent)); console.log(row("the first window against the last", farApart)); }
const share = (a, t) => (a.length ? `${Math.round(100 * a.filter(x => x >= t).length / a.length)}%` : "n/a");
for (const t of [V.DRIFT_SHIFTING, V.DRIFT_MARK]) console.log(`reading ${t} or more: random split ${share(noise, t)} | earliest-latest ${share(real, t)} | another speaker ${share(cross, t)} | side by side ${share(adjacent, t)} | first-last ${share(farApart, t)}`);
console.log("each measure, on the same lines split at random: how often it shows at all");
for (const [k, a] of Object.entries(noiseParts)) console.log(`  ${k.padEnd(10)} ${Math.round(100 * a.length / noise.length)}%`);
console.log("each measure, earliest against latest: how many speakers it showed for");
for (const [k, a] of Object.entries(realParts)) console.log(`  ${k.padEnd(10)} ${a.length} of ${real.length}`);
