// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Dialogue Colors that stay put.
//
// The Dialogue Colors add-on asks the model to give every character one color for the
// whole story, and models forget: a character is blue in one reply and pink in the next.
// So VCRP remembers instead. Each colored line names its speaker (the add-on asks for
// <font color="#HEX" title="Name">), and:
//   - the first color a character speaks in is theirs for the chat (chat_metadata);
//   - every turn, the model is told the colors already taken (with the add-on's own rule,
//     after the chat, never cached);
//   - a reply that gives a known character another color is corrected as it arrives.
// A line without a name is left as the model wrote it.
//
// Readable colors: a color the model picks can be too dark for a dark theme (navy on
// black), too pale for a light one, or all but the same as someone else's. When a
// character's color is first locked it is moved just far enough: lightened or darkened
// until it reads against the chat (a contrast of 4.5:1, the usual bar for body text), and
// turned around the color wheel when it sits too close to a color already taken. A color
// the reader sets in the list is kept exactly as set.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext, chat_metadata, saveMetadata, updateMessageBlock } from "../st.js";
import { localProfile } from "../core/state.js";

const META = "vcrp_colors";
const LIMIT = 40;   // names listed to the model at most

const colorOn = () => Boolean(localProfile && Array.isArray(localProfile.addons) && localProfile.addons.includes("color"));
const key = name => String(name || "").trim().toLowerCase();
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The chat's locked colors, as { key: { name, color } }. */
export function lockedColors() {
    const m = chat_metadata && chat_metadata[META];
    return m && typeof m === "object" && m.names && typeof m.names === "object" ? m.names : {};
}

// ── Readable colors ──────────────────────────────────────────────────────────

const MIN_CONTRAST = 4.5;
const MIN_DISTANCE = 100;   // "redmean" distance: below this two colors read as one
export const DARK_BG = "#171717";
export const LIGHT_BG = "#f5f5f5";

const hexToRgb = hex => {
    let h = String(hex).replace("#", "");
    if (h.length === 3) h = h.split("").map(x => x + x).join("");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const rgbToHex = rgb => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const lin = c => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export const contrastRatio = (a, b) => {
    const [x, y] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};
const distance = (a, b) => {
    const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};
function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * `hex` moved just far enough to read against `background` and to stand apart from the
 * colors in `taken`. Returns a lowercase #rrggbb (the input itself, lowercased, when it
 * already does both).
 */
export function readableColor(hex, { background = DARK_BG, taken = [] } = {}) {
    if (!HEX.test(String(hex || ""))) return hex;
    const bg = hexToRgb(background);
    const darkTheme = luminance(bg) < 0.5;
    const others = taken.filter(t => HEX.test(String(t || ""))).map(hexToRgb);
    const apart = rgb => others.every(o => distance(rgb, o) >= MIN_DISTANCE);
    const legible = ([h, s, l]) => {
        for (let i = 0; i < 40 && contrastRatio(rgbToHex(hslToRgb([h, s, l])), background) < MIN_CONTRAST; i++) l = darkTheme ? Math.min(1, l + 0.025) : Math.max(0, l - 0.025);
        return [h, s, l];
    };
    const original = hexToRgb(hex);
    const hsl = rgbToHsl(original);
    let best = contrastRatio(hex, background) >= MIN_CONTRAST ? null : legible(hsl);
    const now = () => (best ? hslToRgb(best) : original);
    if (!apart(now())) {
        // Around the wheel in 30° steps; a grey has no hue to turn, so it is given some.
        const sat = hsl[1] < 0.35 ? 0.6 : hsl[1];
        for (let step = 1; step < 12; step++) {
            const next = legible([(hsl[0] + step * 30) % 360, sat, hsl[2]]);
            if (apart(hslToRgb(next))) { best = next; break; }
        }
    }
    return best ? rgbToHex(hslToRgb(best)) : String(hex).toLowerCase();
}

// The chat's own text color tells a dark theme from a light one more reliably than its
// background, which can be a picture.
function parseCssColor(v) {
    const s = String(v || "").trim();
    if (HEX.test(s)) return hexToRgb(s);
    const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function themeBackground(doc = typeof document !== "undefined" ? document : null) {
    try {
        const view = doc && doc.defaultView;
        const text = view && view.getComputedStyle(doc.documentElement).getPropertyValue("--SmartThemeBodyColor");
        const rgb = parseCssColor(text);
        if (rgb) return luminance(rgb) > 0.4 ? DARK_BG : LIGHT_BG;
    } catch (e) { /* no theme to read: SillyTavern's default is dark */ }
    return DARK_BG;
}

// ── The reader's list (Global Toggles & Add-ons, under the add-on) ─────────────

const saveColors = () => { try { saveMetadata(); } catch (e) { console.warn("[VCRP] Dialogue colors: could not save", e); } };

/** This chat's locked colors, in the order they were learned: [{ key, name, color }]. */
export function lockedColorList() {
    return Object.entries(lockedColors()).map(([k, v]) => ({ key: k, name: String((v && v.name) || k), color: String((v && v.color) || "") }));
}

/** Gives a character another color (#rgb or #rrggbb). The next replies use it; earlier ones keep theirs. */
export function setLockedColor(k, color) {
    const names = lockedColors();
    if (!names[k] || !HEX.test(String(color || ""))) return false;
    names[k].color = String(color).toLowerCase();
    saveColors();
    return true;
}

/** Forgets one character's color: the model picks one again the next time they speak. */
export function forgetLockedColor(k) {
    const names = lockedColors();
    if (!names[k]) return false;
    delete names[k];
    saveColors();
    return true;
}

/** Forgets every color in this chat. */
export function forgetAllLockedColors() {
    if (chat_metadata && chat_metadata[META] && typeof chat_metadata[META] === "object") chat_metadata[META].names = {};
    saveColors();
}

// <font …> opening tags, with their color and title, wherever they sit in the text.
const FONT_OPEN = /<font\b([^>]*)>/gi;
const attr = (attrs, name) => { const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : ""; };

/**
 * One reply: learns the colors of characters seen for the first time (made readable, unless
 * `readable` is false), and puts a known character's own color back where the model gave
 * them another. Returns the corrected text and whether it changed. `names` is updated in place.
 */
export function lockReplyColors(text, names, { background = DARK_BG, readable = true } = {}) {
    let changed = false;
    // Thinking is the model's own scratch space: leave it alone. Opened and never closed (the
    // length limit cut it), the whole reply is thinking.
    if (/<think(?:ing)?\b[^>]*>/i.test(String(text)) && !/<\/think(?:ing)?\s*>/i.test(String(text))) return { text: String(text), changed: false };
    const thinkEnd = String(text).search(/<\/think(?:ing)?\s*>/i);
    const from = thinkEnd >= 0 ? thinkEnd : 0;
    const head = String(text).slice(0, from), tail = String(text).slice(from);
    const out = tail.replace(FONT_OPEN, (tag, attrs) => {
        const name = attr(attrs, "title");
        const color = attr(attrs, "color");
        if (!name || !HEX.test(color)) return tag;
        const k = key(name);
        const known = names[k];
        if (!known) {
            const fixed = readable ? readableColor(color, { background, taken: Object.values(names).map(n => n && n.color) }) : color.toLowerCase();
            names[k] = { name, color: fixed };
            if (fixed === color.toLowerCase()) return tag;
            changed = true;
            return tag.replace(/(\bcolor\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${fixed}"`);
        }
        if (known.color === color.toLowerCase()) return tag;
        changed = true;
        return tag.replace(/(\bcolor\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${known.color}"`);
    });
    return { text: head + out, changed };
}

/** What the add-on's rule gets every turn: the colors already taken. "" when none. */
export function colorLockNote() {
    if (!colorOn()) return "";
    const list = Object.values(lockedColors()).slice(-LIMIT);
    if (!list.length) return "";
    return `\n- Colors already taken in this story (use exactly these for these characters, and give anyone new a color not on this list): ${list.map(n => `${n.name} ${n.color}`).join("; ")}.`;
}

/**
 * MESSAGE_RECEIVED: learn and enforce on the reply that just arrived. Runs early, with the
 * dash cleaner, so everything after it sees the corrected text.
 */
export function vcrpDialogueColorsOnReply(messageId, type) {
    if (type === "first_message" || !colorOn() || !chat_metadata) return;
    const chat = (getContext() || {}).chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || !/<font\b/i.test(msg.mes)) return;
    if (!chat_metadata[META] || typeof chat_metadata[META] !== "object") chat_metadata[META] = { names: {} };
    if (!chat_metadata[META].names) chat_metadata[META].names = {};
    const { text, changed } = lockReplyColors(msg.mes, chat_metadata[META].names, { background: themeBackground() });
    if (!changed) return;
    msg.mes = text;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = text;
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) { console.warn("[VCRP] Dialogue colors: could not redraw message", id, e); }
}
