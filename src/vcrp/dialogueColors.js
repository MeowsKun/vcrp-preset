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
// A line without a name is left as the model wrote it. Megumin's own wording of the add-on
// (on its Original engines) never asks for the name, so the turn's note asks for it.
//
// A name is matched loosely, as models write it: "Mara Reyes" is the Mara already known (when
// no other Mara is), quotes, emphasis and a "(softly)" aside are left out, and a named color
// ("crimson") counts like its hex.
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

// A title as the speaker's name: no "(softly)" or "[aside]", no quotes or emphasis around it.
const speakerName = raw => String(raw || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/["“”‘’*_`]|^'+|'+$/g, "").replace(/\s+/g, " ").trim();

// Words that name a role, not a person: the "Guard" is not the "Guard Captain".
const ROLE_WORDS = new Set([
    "the", "a", "an", "old", "young", "little", "big", "tall", "short", "other", "another", "first", "second", "third", "head",
    "guard", "guards", "soldier", "man", "woman", "boy", "girl", "child", "kid", "voice", "stranger", "servant", "maid",
    "villager", "crowd", "figure", "someone", "person", "officer", "knight", "priest", "merchant", "bartender", "waiter",
    "waitress", "clerk", "driver", "nurse",
]);
const holdsName = words => words.some(w => !ROLE_WORDS.has(w));

/**
 * Who a title stands for, among the known characters: { key } for the one it names (the same
 * name, or one holding the other word for word, "Mara" and "Mara Reyes", when only one known
 * character does and the shorter is a name, not a role), { several: true } for a line given
 * to more than one ("Mara and Jun"), else {}.
 */
function knownKey(names, name) {
    const k = key(name);
    if (!k) return {};
    if (names[k]) return { key: k };
    const words = k.split(" ");
    const within = [], around = [];
    for (const other of Object.keys(names)) {
        const theirs = other.split(" ");
        if (words.every(w => theirs.includes(w)) && holdsName(words)) within.push(other);
        else if (theirs.every(w => words.includes(w)) && holdsName(theirs)) around.push(other);
    }
    if (around.length > 1) return { several: true };
    const hits = [...within, ...around];
    return hits.length === 1 ? { key: hits[0] } : {};
}

// The color names models reach for, as hex. One not listed is left as the model wrote it.
const NAMED = {
    black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", red: "#ff0000",
    crimson: "#dc143c", darkred: "#8b0000", maroon: "#800000", firebrick: "#b22222", tomato: "#ff6347", coral: "#ff7f50",
    salmon: "#fa8072", orange: "#ffa500", darkorange: "#ff8c00", gold: "#ffd700", goldenrod: "#daa520", yellow: "#ffff00",
    khaki: "#f0e68c", olive: "#808000", green: "#008000", lime: "#00ff00", limegreen: "#32cd32", forestgreen: "#228b22",
    seagreen: "#2e8b57", teal: "#008080", turquoise: "#40e0d0", cyan: "#00ffff", aqua: "#00ffff", skyblue: "#87ceeb",
    lightskyblue: "#87cefa", deepskyblue: "#00bfff", dodgerblue: "#1e90ff", steelblue: "#4682b4", royalblue: "#4169e1",
    blue: "#0000ff", navy: "#000080", indigo: "#4b0082", purple: "#800080", violet: "#ee82ee", orchid: "#da70d6",
    plum: "#dda0dd", lavender: "#e6e6fa", magenta: "#ff00ff", fuchsia: "#ff00ff", pink: "#ffc0cb", hotpink: "#ff69b4",
    deeppink: "#ff1493", brown: "#a52a2a", chocolate: "#d2691e", sienna: "#a0522d", tan: "#d2b48c", beige: "#f5f5dc",
};
const asHex = color => (HEX.test(color) ? color : NAMED[String(color).toLowerCase()] || "");

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
const attr = (attrs, name) => { const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim() : ""; };
// A color set in the tag's style instead ("color: crimson", never a background's). It wins over
// the color attribute on screen, so it is the one the line shows.
const STYLE_COLOR = /(^|;)\s*color\s*:\s*([^;]*);?/i;
const styleColor = attrs => { const m = attr(attrs, "style").match(STYLE_COLOR); return m ? m[2].trim() : ""; };
// The tag with its color set to `hex`: the model's value replaced, or one added where it gave
// none, and a color in its style taken out (the rest of the style kept).
const withColor = (tag, hex) => (/\bcolor\s*=/i.test(tag)
    ? tag.replace(/(\bcolor\s*=\s*)(?:"[^"]*"|'[^']*'|“[^”]*”|[^\s>]+)/i, `$1"${hex}"`)
    : tag.replace(/^<font\b/i, `<font color="${hex}"`))
    // The style runs to its own closing quote: a font name inside it ('Courier') keeps its quotes.
    .replace(/\s*\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)/i, (all, dq, sq, cq) => {
        const css = dq ?? sq ?? cq;
        const rest = css.replace(STYLE_COLOR, "$1").replace(/^[\s;]+|[\s;]+$/g, "");
        return !rest ? "" : sq !== undefined ? ` style='${rest}'` : ` style="${rest}"`;
    });

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
        const name = speakerName(attr(attrs, "title"));
        const color = styleColor(attrs) || attr(attrs, "color");
        if (!name) return tag;
        // A line given to several characters at once is nobody's in particular.
        const who = knownKey(names, name);
        if (who.several) return tag;
        const known = who.key ? names[who.key] : null;
        if (!known) {
            // Someone new: theirs is the color they first speak in, when it is one.
            const hex = asHex(color);
            if (!hex) return tag;
            const fixed = readable ? readableColor(hex, { background, taken: Object.values(names).map(n => n && n.color) }) : hex.toLowerCase();
            names[key(name)] = { name, color: fixed };
            if (fixed === color.toLowerCase()) return tag;
            changed = true;
            return withColor(tag, fixed);
        }
        if (known.color === color.toLowerCase()) return tag;
        changed = true;
        return withColor(tag, known.color);
    });
    return { text: head + out, changed };
}

// ── Tags that stay on the dialogue ───────────────────────────────────────────
// Some models (GLM above all) leave a <font> open, close it after the narration that follows
// the line, or wrap a whole paragraph from its first quote to its last. A browser then colors
// the narration too, and carries an unclosed <font> on into the paragraphs after it. So each
// reply is mended as it arrives: every colored line ends right after its closing quote.

const OPENERS = { "\"": "\"", "“": "”", "„": "“", "«": "»", "「": "」", "『": "』" };
// A closing tag as models misspell it: "</ font>", "< /font>" and "<\/font>" close nothing.
const FONT_CLOSE_ANY = /<\s*\\?\/\s*font\s*>/gi;
const FONT_CLOSE = "</font>";

/** `x` cut into quoted lines and what lies between them: [{ quote, text }]. */
function quoteParts(x) {
    const parts = [];
    let i = 0, start = 0;
    while (i < x.length) {
        const close = OPENERS[x[i]];
        if (!close) { i++; continue; }
        const end = x.indexOf(close, i + 1);
        if (start < i) parts.push({ quote: false, text: x.slice(start, i) });
        const stop = end < 0 ? x.length : end + close.length;
        parts.push({ quote: true, text: x.slice(i, stop) });
        i = start = stop;
    }
    if (start < x.length) parts.push({ quote: false, text: x.slice(start) });
    return parts;
}

/**
 * What `tag` should have colored in `region`: each quoted line on its own, the narration
 * around them left plain. A region with no dialogue, or with nothing but dialogue, keeps the
 * one tag (closed).
 */
function wrapDialogue(tag, region) {
    const parts = quoteParts(region);
    const runsOn = parts.some(p => p.quote) && parts.some(p => !p.quote && /[\p{L}\p{N}]/u.test(p.text));
    if (runsOn) return parts.map(p => (p.quote ? `${tag}${p.text}${FONT_CLOSE}` : p.text)).join("");
    const trail = region.match(/\s*$/)[0];
    return `${tag}${region.slice(0, region.length - trail.length)}${FONT_CLOSE}${trail}`;
}

/**
 * A reply's story with every <font> ending on its dialogue: misspelt closing tags fixed, one
 * that runs on over narration (or opens before it) split so each quoted line has its own, one
 * never closed treated the same up to the end of its line of text. Thinking and blocks are
 * left alone. Returns { text, changed }.
 */
export function mendFontTags(text) {
    const s = String(text || "");
    if (!/<font\b/i.test(s)) return { text: s, changed: false };
    // Thinking is the model's own; opened and never closed, the whole reply is.
    if (/<think(?:ing)?\b[^>]*>/i.test(s) && !/<\/think(?:ing)?\s*>/i.test(s)) return { text: s, changed: false };
    let split = 0, m;
    const re = /<\/think(?:ing)?\s*>/gi;
    while ((m = re.exec(s)) !== null) split = m.index + m[0].length;
    const head = s.slice(0, split);
    // Blocks and trackers (capitalized tags) are set aside, and put back as they were. HTML
    // written in capitals (<FONT>, <B>) is not a tracker.
    const kept = [];
    const keep = x => { kept.push(x); return `\u0000${kept.length - 1}\u0000`; };
    let body = s.slice(split)
        .replace(/<Blocks\b[^>]*>[\s\S]*?(?:<\/Blocks\s*>|$)/gi, keep)
        .replace(/<(?!(?:FONT|SPAN|DIV|P|B|I|U|S|EM|STRONG|SMALL|BIG|SUB|SUP|BR|HR|DETAILS|SUMMARY|CENTER|BLOCKQUOTE)\b)([A-Z][A-Za-z_]+)\b[^>]*>[\s\S]*?<\/\1\s*>/g, keep);
    body = body.replace(FONT_CLOSE_ANY, FONT_CLOSE);
    const opens = [...body.matchAll(/<font\b[^>]*>/gi)];
    let out = "", cursor = 0;
    opens.forEach((o, n) => {
        const tag = o[0], from = o.index + tag.length;
        const next = n + 1 < opens.length ? opens[n + 1].index : body.length;
        const closeAt = body.indexOf(FONT_CLOSE, from);
        out += body.slice(cursor, o.index);
        if (closeAt >= 0 && closeAt < next) {
            // A styled passage over several lines with no dialogue in it is left as written.
            out += wrapDialogue(tag, body.slice(from, closeAt));
            cursor = closeAt + FONT_CLOSE.length;
            return;
        }
        // Never closed: what it was meant for is on its own line of text.
        const rest = body.slice(from, next);
        const lineEnd = rest.search(/\r?\n/);
        const at = lineEnd < 0 ? rest.length : lineEnd;
        out += wrapDialogue(tag, rest.slice(0, at));
        cursor = from + at;
    });
    out += body.slice(cursor);
    const mended = head + out.replace(/\u0000(\d+)\u0000/g, (all, i) => kept[Number(i)]);
    return { text: mended, changed: mended !== s };
}

/**
 * What the add-on's rule gets every turn: the speaker's name in each tag when the add-on's own
 * wording (`addonText`) does not ask for it, how to close the tags (every model is reminded;
 * some forget), and the colors already taken. "" with the add-on off.
 */
export function colorLockNote(addonText = "") {
    if (!colorOn()) return "";
    const named = /\btitle\s*=/i.test(String(addonText)) ? "" : "\n- Every colored line names its speaker in title, the same name every time: <font color=\"#HEX\" title=\"Name\">.";
    const tags = "\n- Color only the spoken words: put <font …> right before each line's opening quote and </font> right after its closing quote, every line on its own. Narration and dialogue tags (she said, actions) always stay outside the tags, and every <font> you open is closed.";
    const list = Object.values(lockedColors()).slice(-LIMIT);
    if (!list.length) return named + tags;
    return `${named}${tags}\n- Colors already taken in this story (use exactly these for these characters, and give anyone new a color not on this list): ${list.map(n => `${n.name} ${n.color}`).join("; ")}.`;
}

/**
 * MESSAGE_RECEIVED: mend the reply's tags, then learn and enforce its colors. Runs early, with
 * the dash cleaner, so everything after it sees the corrected text.
 */
export function vcrpDialogueColorsOnReply(messageId, type) {
    if (type === "first_message" || !colorOn() || !chat_metadata) return;
    const chat = (getContext() || {}).chat;
    const id = Number(messageId);
    const msg = Array.isArray(chat) ? chat[id] : null;
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string" || !/<font\b/i.test(msg.mes)) return;
    if (!chat_metadata[META] || typeof chat_metadata[META] !== "object") chat_metadata[META] = { names: {} };
    if (!chat_metadata[META].names) chat_metadata[META].names = {};
    const mended = mendFontTags(msg.mes);
    const { text, changed } = lockReplyColors(mended.text, chat_metadata[META].names, { background: themeBackground() });
    if (!changed && !mended.changed) return;
    msg.mes = text;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") msg.swipes[msg.swipe_id] = text;
    try {
        if (typeof document !== "undefined" && document.querySelector(`#chat .mes[mesid="${id}"]`)) updateMessageBlock(id, msg);
    } catch (e) { console.warn("[VCRP] Dialogue colors: could not redraw message", id, e); }
}
