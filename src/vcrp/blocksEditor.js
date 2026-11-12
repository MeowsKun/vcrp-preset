// ─────────────────────────────────────────────────────────────────────────────
// VCRP: the blocks editor. The story's state by hand.
//
// The blocks under the latest reply (World State, Bonds, the sheets, the scene list, the
// custom ones) are the state the next reply is handed: "the blocks as they stood" travel with
// the block instructions every turn (blockHistory.js), and the model writes its own from them.
// So when one of them is wrong (someone still listed who left an hour ago, a number that
// jumped, an outfit never changed back), the mistake is copied forward until someone fixes
// it. SillyTavern's own message editor can, in the raw markup of a long reply, on a phone.
// This is the same edit made easy: each block in a box of its own, and one tap to take a
// character out of the scene (off the scene list and out of the World State's cast, noted as
// off-screen) or to bring one in.
//
// What is edited is the blocks as they stand (blockHistory.js, lastBlocksInfo): the latest
// reply's, with any state block it left out filled in from where it was last written whole.
// Saving writes them into the latest reply, so the card under it shows them and the next
// prompt carries them. No model call. Megumin Suite keeps a state store with a journal for
// this; VCRP reads the chat, so the chat is where the edit goes.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, saveChat, updateMessageBlock } from "../st.js";
import { lastBlocksInfo } from "./blockHistory.js";
import { meguminRenderRegistry } from "../features/blocks/registry.js";
import { parseScene } from "../state/scene.js";
import { parseWorldState } from "../blocks/treatments.js";
import { escapeHtmlAttr } from "../utils/html.js";

const esc = s => escapeHtmlAttr(s == null ? "" : s);

// ── The envelope, taken apart and put back ───────────────────────────────────

/**
 * A <Blocks> envelope's children, in order (pure): { open, close, parts: [{ before, tag,
 * openTag, body, closeTag }], after }. `before` and `after` are the text between the blocks,
 * kept as written. null when `envelope` is not one.
 */
export function envelopeParts(envelope) {
    const m = String(envelope || "").trim().match(/^(<Blocks\b[^>]*>)([\s\S]*?)(<\/Blocks\s*>)$/i);
    if (!m) return null;
    const inner = m[2];
    const parts = [];
    let at = 0;
    for (const b of inner.matchAll(/<([A-Za-z][\w-]*)\b([^>]*)>([\s\S]*?)<\/\1\s*>/g)) {
        parts.push({ before: inner.slice(at, b.index), tag: b[1], openTag: `<${b[1]}${b[2]}>`, body: b[3], closeTag: `</${b[1]}>` });
        at = b.index + b[0].length;
    }
    return { open: m[1], close: m[3], parts, after: inner.slice(at) };
}

/** The envelope again, from its parts (pure). A body is kept on lines of its own. */
export function envelopeText(env) {
    const body = b => { const t = String(b.body || "").replace(/^\s*\n|\s+$/g, ""); return t ? `\n${t}\n` : "\n"; };
    return `${env.open}${env.parts.map(p => `${p.before}${p.openTag}${body(p)}${p.closeTag}`).join("")}${env.after}${env.close}`;
}

// A reply without its thinking: where the story part starts (a model may draft blocks in its thinking).
function storyStart(mes) {
    const s = String(mes || "");
    if (/<think(?:ing)?\b[^>]*>/i.test(s) && !/<\/think(?:ing)?\s*>/i.test(s)) return s.length;
    let at = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(s)) !== null) at = m.index + m[0].length;
    return at;
}

/** A reply's own complete <Blocks> (the last one after its thinking), or "". */
export function ownEnvelope(mes) {
    const s = String(mes || "");
    const all = s.slice(storyStart(s)).match(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi);
    return all ? all[all.length - 1] : "";
}

/**
 * A reply's text with `envelope` as its blocks (pure): in place of its own, of blocks the
 * reply was cut off inside, or added at its end when it wrote none.
 */
export function withBlocks(mes, envelope) {
    const s = String(mes || "");
    const from = storyStart(s);
    const head = s.slice(0, from), story = s.slice(from);
    const whole = [...story.matchAll(/<Blocks\b[^>]*>[\s\S]*?<\/Blocks\s*>/gi)];
    if (whole.length) {
        const last = whole[whole.length - 1];
        return head + story.slice(0, last.index) + envelope + story.slice(last.index + last[0].length);
    }
    const cut = story.search(/<Blocks\b[^>]*>[\s\S]*$/i);
    const prose = (cut >= 0 ? story.slice(0, cut) : story).replace(/\s+$/, "");
    return `${head}${prose}${prose ? "\n\n" : ""}${envelope}`;
}

// ── The blocks as they stand ─────────────────────────────────────────────────

/**
 * What the editor opens on: { index, envelope, filled: [label], back } or null when no reply
 * has blocks yet. `index`: the latest reply, where the edit is saved. `envelope`: its own
 * blocks whole (the reply's own notes included), plus any state block it left out, from where
 * it was last written whole (`filled`); or, when it wrote none, the blocks as an earlier
 * reply left them (`back` replies earlier).
 */
export function blocksAsTheyStand() {
    let chat = [];
    try { chat = ((getContext() || {}).chat) || []; } catch (e) { return null; }
    let index = -1;
    for (let i = chat.length - 1; i >= 0; i--) { const m = chat[i]; if (m && !m.is_user && !m.is_system && typeof m.mes === "string") { index = i; break; } }
    if (index < 0) return null;
    let info;
    try { info = lastBlocksInfo(); } catch (e) { return null; }
    const state = envelopeParts(info.state);
    if (!state || !state.parts.length) return null;
    const own = envelopeParts(ownEnvelope(chat[index].mes));
    if (!own) return { index, envelope: info.state, filled: (info.filled || []).map(f => f.label), back: info.back || 0 };
    // The latest reply's own blocks, with what it lacks added from the state at the end.
    const has = new Set(own.parts.map(p => p.tag.toLowerCase()));
    const missing = state.parts.filter(p => !has.has(p.tag.toLowerCase()));
    for (const p of missing) own.parts.push({ ...p, before: "\n" });
    if (missing.length && !/\n\s*$/.test(own.after)) own.after = `\n${own.after}`;
    return { index, envelope: envelopeText(own), filled: (info.filled || []).map(f => f.label), back: 0 };
}

// Whoever draws on a reply (the blocks card) is told when its blocks were edited: redrawing
// the message takes the card away with the rest of its body.
const afterEdit = new Set();
export function onBlocksEdited(fn) { afterEdit.add(fn); }

/**
 * Saves `envelope` as the latest reply's blocks: into the message and its swipe, the chat
 * saved, the message redrawn. Returns false when that reply is gone or has changed meanwhile.
 */
export async function saveBlocksAsTheyStand(index, envelope, was) {
    const chat = ((getContext() || {}).chat) || [];
    const msg = chat[index];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return false;
    if (was !== undefined && msg.mes !== was) return false;
    if (!envelopeParts(envelope)) return false;
    msg.mes = withBlocks(msg.mes, envelope);
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = msg.mes;
    try { await saveChat(); } catch (e) { console.warn("[VCRP] Blocks editor: could not save the chat", e); }
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${index}"]`)) updateMessageBlock(Number(index), msg);
    } catch (e) { console.warn("[VCRP] Blocks editor: could not redraw the message", e); }
    for (const fn of afterEdit) { try { fn(Number(index)); } catch (e) { console.warn("[VCRP] Blocks editor: a follow-up failed", e); } }
    return true;
}

// ── Who is in the scene, and taking someone out ──────────────────────────────

const words = s => (String(s || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
/** The same character by name: the same words, or one name holding the other's ("Mara", "Mara Voss"). */
export function sameCharacter(a, b) {
    const A = words(a), B = words(b);
    if (!A.length || !B.length) return false;
    return A.every(w => B.includes(w)) || B.every(w => A.includes(w));
}

const partOf = (env, tag) => env.parts.find(p => p.tag.toLowerCase() === tag.toLowerCase()) || null;

/** Who the blocks have in the scene (pure): [{ name, where: "here" | "remote" }], the scene list first, then anyone only the World State has. */
export function sceneCast(envelope) {
    const env = typeof envelope === "string" ? envelopeParts(envelope) : envelope;
    if (!env) return [];
    const out = [];
    const add = (name, where) => { if (name && !out.some(c => sameCharacter(c.name, name))) out.push({ name, where }); };
    const scene = partOf(env, "Scene");
    if (scene) {
        const s = parseScene(`<Scene>${scene.body}</Scene>`);
        if (s) { s.here.forEach(n => add(n.name, "here")); s.remote.forEach(n => add(n.name, "remote")); }
    }
    const world = partOf(env, "World_State");
    if (world) {
        let parsed = null;
        try { parsed = parseWorldState(world.body); } catch (e) { parsed = null; }
        for (const p of (parsed && parsed.people) || []) if (p && !p.isPc) add(String(p.name || "").replace(/[*_]/g, "").trim(), "here");
    }
    return out;
}

const plainLine = l => String(l || "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[*_`]/g, "").trim();
const isHeader = l => /^\s*\*\*[^*]+\*\*\s*:?\s*$|^\s*\*\*[^*]+:\*\*\s*$/.test(l) || /^\s*-{3,}\s*$/.test(l);

// One "Here: A, +B" list without `name`; an emptied "Here" says so in the scene list's own words.
function sceneBodyWithout(body, name) {
    let changed = false;
    const lines = String(body || "").split(/\r?\n/).map(raw => {
        const m = raw.match(/^(\s*[*_•-]*\s*(?:\*\*)?\s*)(here|present|remote|on the line|on a call)(\s*(?:\*\*)?\s*:\s*)(.*)$/i);
        if (!m) return raw;
        const kept = m[4].split(/\s*,\s*/).filter(n => n.trim() && !sameCharacter(n.replace(/^\+\s*/, ""), name));
        if (kept.length === m[4].split(/\s*,\s*/).filter(n => n.trim()).length) return raw;
        changed = true;
        return `${m[1]}${m[2]}${m[3]}${kept.length ? kept.join(", ") : (/^(here|present)$/i.test(m[2]) ? "nobody" : "")}`;
    });
    return { body: lines.join("\n"), changed };
}

// The World State without `name` among those present: their header and the field lines under
// it (or their one line, in the compact form) taken out, and a line for them under Off-Screen
// when the block has that section.
function worldBodyWithout(body, name) {
    const lines = String(body || "").split(/\r?\n/);
    const out = [];
    let changed = false, skipping = false, section = "";
    for (const raw of lines) {
        const text = plainLine(raw);
        const bullet = /^\s*(?:[*•-])\s+/.test(raw);
        if (!bullet && /^(npcs?\s*present|present\s*npcs?|in\s*scene)\s*:?$/i.test(text)) section = "present";
        else if (!bullet && /^(off[\s-]?screen|elsewhere)\s*:?$/i.test(text)) section = "offscreen";
        else if (!bullet && /^(unresolved|open)?\s*threads\s*:?$/i.test(text)) section = "threads";
        if (skipping) {
            if (bullet && !isHeader(raw)) continue;   // their own field lines
            skipping = false;
        }
        // A person's header: a bold line that is a name ("**Mara:**"), outside the off-screen list.
        const head = !bullet && raw.match(/^\s*\*\*\s*(.+?)\s*:?\s*\*\*\s*:?\s*$/);
        if (head && section !== "offscreen" && sameCharacter(plainLine(head[1]).replace(/:$/, ""), name)) { changed = true; skipping = true; continue; }
        // The compact form: "* Mara: coat | at the rail" under NPCs Present.
        const one = bullet && section === "present" && plainLine(raw.replace(/^\s*[*•-]\s+/, "")).match(/^([^:|]{1,60}?)\s*:\s*.+$/);
        if (one && sameCharacter(one[1], name)) { changed = true; continue; }
        out.push(raw);
    }
    if (!changed) return { body, changed: false };
    // Off-screen, as they left: so the story knows they are somewhere, not nowhere.
    const at = out.findIndex(l => !/^\s*(?:[*•-])\s+/.test(l) && /^(off[\s-]?screen|elsewhere)\s*:?$/i.test(plainLine(l)));
    if (at >= 0 && !out.slice(at + 1).some(l => /^\s*[*•-]\s+/.test(l) && sameCharacter(plainLine(l.replace(/^\s*[*•-]\s+/, "")).split(/\s*[:—–]\s*/)[0], name))) {
        out.splice(at + 1, 0, `* ${name}: left the scene`);
    }
    return { body: out.join("\n").replace(/\n{3,}/g, "\n\n"), changed: true };
}

/**
 * The envelope with `name` taken out of the scene (pure): off the scene list, out of the World
 * State's cast (noted as off-screen there). Their Bonds line stays: feelings do not leave with
 * them. Returns { envelope, changed: [block label] }.
 */
export function removeFromScene(envelope, name) {
    const env = envelopeParts(envelope);
    if (!env || !String(name || "").trim()) return { envelope, changed: [] };
    const changed = [];
    const scene = partOf(env, "Scene");
    if (scene) { const r = sceneBodyWithout(scene.body, name); if (r.changed) { scene.body = r.body; changed.push("the scene list"); } }
    const world = partOf(env, "World_State");
    if (world) { const r = worldBodyWithout(world.body, name); if (r.changed) { world.body = r.body; changed.push("World State"); } }
    return { envelope: changed.length ? envelopeText(env) : envelope, changed };
}

/**
 * The envelope with `name` added to the scene list's Here line (pure). Only the list: what they
 * wear and where they stand is the story's to write. Returns { envelope, changed }.
 */
export function addToScene(envelope, name) {
    const env = envelopeParts(envelope);
    const who = String(name || "").replace(/[,<>]/g, " ").replace(/\s+/g, " ").trim();
    const scene = env && partOf(env, "Scene");
    if (!scene || !who || sceneCast(env).some(c => sameCharacter(c.name, who))) return { envelope, changed: false };
    let done = false;
    const lines = scene.body.split(/\r?\n/).map(raw => {
        const m = !done && raw.match(/^(\s*[*_•-]*\s*(?:\*\*)?\s*(?:here|present)\s*(?:\*\*)?\s*:\s*)(.*)$/i);
        if (!m) return raw;
        done = true;
        const now = m[2].split(/\s*,\s*/).filter(n => n.trim() && !/^(nobody|no one|none|empty|\[.*\])$/i.test(n.trim()));
        return `${m[1]}${[...now, who].join(", ")}`;
    });
    if (!done) lines.unshift(`Here: ${who}`);
    scene.body = lines.join("\n");
    return { envelope: envelopeText(env), changed: true };
}

// ── The dialog ───────────────────────────────────────────────────────────────

const DIALOG_ID = "vcrp_blocks_editor";
const DIALOG_STYLE = "padding:14px; border:1px solid #27272a; border-radius:14px; background:#18181b; color:#f4f4f5; width:min(94vw, 720px); max-width:94vw; max-height:90dvh; overflow-y:auto; box-sizing:border-box; font:inherit;";
const AREA_STYLE = "width:100%; box-sizing:border-box; background:rgba(0,0,0,0.25); color:inherit; border:1px solid #27272a; border-radius:8px; padding:8px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:0.74rem; line-height:1.45; resize:vertical; margin:0;";
const BTN = "background:rgba(255,255,255,0.06); color:inherit; border:1px solid #27272a; border-radius:8px; padding:6px 12px; cursor:pointer; font:inherit; font-size:0.78rem; width:auto; margin:0;";

function labelOf(part) {
    let reg = [];
    try { reg = meguminRenderRegistry(); } catch (e) { reg = []; }
    const def = reg.find(d => d && d.tag && String(d.tag).toLowerCase() === part.tag.toLowerCase());
    const name = (part.openTag.match(/\bname\s*=\s*"([^"]*)"/i) || [])[1];
    const base = def ? `${def.emoji ? `${def.emoji} ` : ""}${def.label || def.tag}` : part.tag.replace(/_/g, " ");
    return name ? `${base}: ${name}` : base;
}

/** Opens the editor on the blocks as they stand. Returns false (with a toast) when there are none. */
export function openBlocksEditor(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return false;
    const stand = blocksAsTheyStand();
    if (!stand) {
        if (typeof toastr !== "undefined") toastr.info("No reply in this chat has blocks yet, so there is nothing to edit.", "VCRP: blocks");
        return false;
    }
    const was = String((((getContext() || {}).chat) || [])[stand.index].mes);
    let envelope = stand.envelope;
    const old = doc.getElementById(DIALOG_ID);
    if (old) old.remove();
    const dlg = doc.createElement("dialog");
    dlg.id = DIALOG_ID;
    dlg.className = "vcrp-text-dialog vcrp-blocks-editor";
    dlg.style.cssText = DIALOG_STYLE;
    dlg.setAttribute("data-swipe-ignore", "true");
    const close = () => { try { dlg.close(); } catch (e) { /* not open */ } dlg.remove(); };

    // What the boxes hold now, read back into the envelope (so a tap on Remove works on the reader's own edits).
    const collect = () => {
        const env = envelopeParts(envelope);
        dlg.querySelectorAll("textarea.vcrp-be-area").forEach(ta => { const p = env.parts[Number(ta.getAttribute("data-i"))]; if (p) p.body = ta.value; });
        envelope = envelopeText(env);
    };
    const draw = () => {
        const env = envelopeParts(envelope);
        const cast = sceneCast(env);
        const hasScene = !!partOf(env, "Scene");
        const from = stand.back
            ? `Your last reply wrote no blocks, so these are the ones from ${stand.back} ${stand.back === 1 ? "reply" : "replies"} before it. Saving puts them under your last reply.`
            : stand.filled.length ? `Your last reply left out ${esc(stand.filled.join(", "))}: shown here from where ${stand.filled.length === 1 ? "it was" : "they were"} last written whole.` : "";
        dlg.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;">
                <b style="font-size:0.95rem;"><i class="fa-solid fa-pen-to-square"></i> The blocks as they stand</b>
                <button type="button" class="vcrp-be-close" style="${BTN}" title="Close without saving"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="font-size:0.74rem; line-height:1.5; color:#a1a1aa; margin-bottom:10px;">This is the story's state as the next reply is handed it. Fix what is wrong and save: it is written under your latest reply, and the story goes on from there. ${from}</div>
            ${cast.length || hasScene ? `
            <div class="vcrp-be-cast" style="border:1px solid #27272a; border-radius:10px; padding:8px; margin-bottom:10px;">
                <div style="font-size:0.78rem; font-weight:700; margin-bottom:6px;">In the scene</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${cast.map(c => `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 6px 4px 10px; border-radius:999px; border:1px solid #27272a; font-size:0.76rem;">${esc(c.name)}${c.where === "remote" ? ` <span style="color:#a1a1aa;">(remote)</span>` : ""}
                        <button type="button" class="vcrp-be-remove" data-name="${esc(c.name)}" style="${BTN} padding:2px 8px; font-size:0.7rem; color:#f87171;" title="Takes them off the scene list and out of the World State's cast, noted as off-screen. Their Bonds line stays.">Remove</button></span>`).join("") || `<span style="font-size:0.74rem; color:#a1a1aa;">Nobody is listed.</span>`}
                </div>
                ${hasScene ? `<div style="display:flex; gap:6px; margin-top:8px;">
                    <input type="text" class="vcrp-be-add-name" placeholder="Bring someone in: their name" style="flex:1; min-width:0; ${AREA_STYLE} font-family:inherit; resize:none;">
                    <button type="button" class="vcrp-be-add" style="${BTN}">Add</button>
                </div>` : ""}
            </div>` : ""}
            ${env.parts.map((p, i) => `
            <div style="margin-bottom:10px;">
                <div style="font-size:0.78rem; font-weight:700; margin-bottom:4px;">${esc(labelOf(p))}</div>
                <textarea class="vcrp-be-area" data-i="${i}" rows="${Math.max(3, Math.min(16, String(p.body).trim().split("\n").length + 1))}" style="${AREA_STYLE}" spellcheck="false"></textarea>
            </div>`).join("")}
            <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; position:sticky; bottom:-14px; background:#18181b; padding:8px 0 2px;">
                <button type="button" class="vcrp-be-save" style="${BTN} background:rgba(245,158,11,0.18); border-color:rgba(245,158,11,0.5); color:#fbbf24; font-weight:700;"><i class="fa-solid fa-check"></i> Save</button>
                <button type="button" class="vcrp-be-close" style="${BTN}">Cancel</button>
            </div>`;
        dlg.querySelectorAll("textarea.vcrp-be-area").forEach(ta => { ta.value = String(env.parts[Number(ta.getAttribute("data-i"))].body).replace(/^\s*\n|\s+$/g, ""); });
        dlg.querySelectorAll(".vcrp-be-close").forEach(b => b.addEventListener("click", close));
        dlg.querySelectorAll(".vcrp-be-remove").forEach(b => b.addEventListener("click", () => {
            collect();
            const name = String(b.getAttribute("data-name") || "");
            const r = removeFromScene(envelope, name);
            envelope = r.envelope;
            if (typeof toastr !== "undefined") toastr.info(r.changed.length ? `${name} is out of ${r.changed.join(" and ")}. Save to keep it.` : `${name} was not found in the blocks' own lists: take them out of the text by hand.`, "VCRP: blocks");
            draw();
        }));
        const addNow = () => {
            collect();
            const name = String((dlg.querySelector(".vcrp-be-add-name") || {}).value || "");
            const r = addToScene(envelope, name);
            envelope = r.envelope;
            if (!r.changed && name.trim() && typeof toastr !== "undefined") toastr.info("They are in the scene already.", "VCRP: blocks");
            draw();
        };
        const add = dlg.querySelector(".vcrp-be-add");
        if (add) add.addEventListener("click", addNow);
        const addName = dlg.querySelector(".vcrp-be-add-name");
        if (addName) addName.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addNow(); } });
        dlg.querySelector(".vcrp-be-save").addEventListener("click", async () => {
            collect();
            const ok = await saveBlocksAsTheyStand(stand.index, envelope, was);
            if (typeof toastr !== "undefined") {
                if (ok) toastr.success("Saved under your latest reply. The next reply starts from these.", "VCRP: blocks");
                else toastr.warning("That reply changed while the editor was open (a swipe, an edit), so nothing was saved. Open the editor again.", "VCRP: blocks");
            }
            close();
        });
    };
    doc.body.appendChild(dlg);
    dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
    draw();
    if (typeof dlg.showModal === "function") { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } } else dlg.setAttribute("open", "");
    return true;
}
