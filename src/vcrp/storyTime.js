// ─────────────────────────────────────────────────────────────────────────────
// VCRP: when and where the story stands, and how its bonds have moved, read from the blocks.
//
// The World State block opens with the story's own clock and place ("Time: Day 3, evening |
// Loc: the Lantern | Region"), and the Bonds block carries each character's meters ("Mara:
// Mood: wary | Affection: 48/100 (+2)"). Both are already written every reply. Read back,
// they give Story Memory two things no summary call has to be asked for:
//   - each chapter's in-story date and place, so the memory text is a timeline;
//   - a fact when a meter crosses a quarter, half or three quarters of its scale, with where
//     in the story it happened.
// Pure text reading: no model call, nothing sent. A reply without those blocks says nothing.
// ─────────────────────────────────────────────────────────────────────────────

const WORLD = /<World_State\b[^>]*>([\s\S]*?)(?:<\/World_State\s*>|$)/i;
const BONDS = /<Bonds\b[^>]*>([\s\S]*?)(?:<\/Bonds\s*>|$)/i;
// A value ends at the next field ("| **🌤 Loc:**"), the line's end, or the block's.
const stripMarks = s => String(s || "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
const SKIP = /^\[.*\]$|^(?:unknown|n\/?a|none|-+|\?+)$/i;   // a template's own placeholder, or nothing said

/** The World State block's body in a message's text, or "". */
export function worldStateOf(mes) {
    const m = WORLD.exec(String(mes || ""));
    return m ? m[1] : "";
}

/** The Bonds block's body in a message's text, or "". */
export function bondsOf(mes) {
    const m = BONDS.exec(String(mes || ""));
    return m ? m[1] : "";
}

/**
 * The story's clock and place from a World State body: { time, place } ("" for one not
 * given). The place keeps its region ("the Lantern | Saltmere" becomes "the Lantern, Saltmere").
 */
export function storyWhen(body) {
    const lines = String(body || "").split(/\r?\n/).map(l => stripMarks(l.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")));
    const tidy = s => { const v = stripMarks(s).replace(/\s*\|\s*/g, ", ").replace(/[,\s]+$/, ""); return SKIP.test(v) ? "" : v.slice(0, 120); };
    const clean = lines.find(l => /\bTime\s*:/i.test(l)) || "";
    if (!clean) {
        // The compact World State writes both on one field: "Time & Loc: dusk at the glade".
        const both = (lines.map(l => l.match(/\bTime\s*(?:&|and)\s*Loc(?:ation)?\s*:\s*(.*)$/i)).find(Boolean) || [])[1] || "";
        return { time: tidy(both), place: "" };
    }
    const LOC = /\bLoc(?:ation)?\s*:\s*(.*?)\s*(?:\|\s*(?:Wx|Weather|Time)\s*:|$)/i;
    const time = (clean.match(/\bTime\s*:\s*(.*?)\s*(?:\|\s*(?:Loc(?:ation)?|Wx|Weather)\s*:|$)/i) || [])[1] || "";
    // The place is on the clock's line in the engines' template; a block written one field to a
    // line has it on a line of its own.
    const loc = (clean.match(LOC) || (lines.find(l => /^\W*Loc(?:ation)?\s*:/i.test(l)) || "").match(LOC) || [])[1] || "";
    return { time: tidy(time), place: tidy(loc) };
}

/** "Day 3, evening · the Lantern, Saltmere" from a { time, place } ("" with neither). */
export const whenText = w => [w && w.time, w && w.place].filter(Boolean).join(" · ");

/**
 * Where the story stood at message `index` of `chat`: the latest World State at or before
 * it, looking back at most `back` messages. "" when none of them carries one.
 */
export function storyWhenAt(chat, index, back = 12) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = Math.min(index, list.length - 1), n = 0; i >= 0 && n < back; i--, n++) {
        const m = list[i];
        if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
        const text = whenText(storyWhen(worldStateOf(m.mes)));
        if (text) return text;
    }
    return "";
}

// ── Bonds ────────────────────────────────────────────────────────────────────

/**
 * The meters in a Bonds body: { "Mara Voss": { Affection: { value, max }, ... }, ... }. Only
 * fields written as a number out of a number count; a mood in words is not a meter.
 */
export function parseBonds(body) {
    const out = {};
    for (const raw of String(body || "").split(/\r?\n/)) {
        const line = stripMarks(raw);
        const at = line.indexOf(":");
        if (at <= 0 || line.startsWith("[")) continue;
        const name = line.slice(0, at).replace(/^[-•\s]+/, "").trim();
        if (!name || name.length > 60 || /\|/.test(name)) continue;
        const meters = {};
        for (const part of line.slice(at + 1).split("|")) {
            const m = part.match(/^\s*([^:]{1,40}?)\s*:\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
            if (m && Number(m[3]) > 0) meters[m[1].trim()] = { value: Number(m[2]), max: Number(m[3]) };
        }
        if (Object.keys(meters).length) out[name] = meters;
    }
    return out;
}

export const BOND_MARKS = [25, 50, 75];   // percent of a meter's scale

/**
 * The marks a meter crossed between two readings (pure): [{ name, field, mark, up, from, to,
 * max }]. A character or a field that is new is not a crossing: there is no "before".
 */
export function bondCrossings(before, after, marks = BOND_MARKS) {
    const out = [];
    for (const [name, fields] of Object.entries(after || {})) {
        const prev = before && before[name];
        if (!prev) continue;
        for (const [field, now] of Object.entries(fields)) {
            const was = prev[field];
            if (!was || !(now.max > 0) || was.max !== now.max || was.value === now.value) continue;
            const a = was.value / now.max * 100, b = now.value / now.max * 100;
            for (const mark of marks) {
                if (a < mark && b >= mark) out.push({ name, field, mark, up: true, from: was.value, to: now.value, max: now.max });
                else if (a >= mark && b < mark) out.push({ name, field, mark, up: false, from: was.value, to: now.value, max: now.max });
            }
        }
    }
    return out;
}

/** A crossing in a sentence: "Mara's Affection toward Bob rose past 50% (48 to 53 of 100), Day 3, evening · the Lantern." */
export function crossingText(c, { user = "", when = "" } = {}) {
    const toward = user ? ` toward ${user}` : "";
    return `${c.name}'s ${c.field}${toward} ${c.up ? "rose past" : "fell below"} ${c.mark}% (${c.from} to ${c.to} of ${c.max})${when ? `, ${when}` : ""}.`;
}
