// ─────────────────────────────────────────────────────────────────────────────
// VCRP: cache check.
//
// Claude reads from the cache only as far as the prompt is identical to one it has seen.
// One thing that changes near the top of the prompt every turn (a lorebook entry switching
// on and off, a {{time}} macro, anything rewritten per request) means the whole chat
// history after it is written to the cache again, at double price, on every request.
// The bill shows it only as "cache read: little"; nothing says what changed.
//
// So each prompt sent from the VCRP preset is compared with the one before it: how much of
// it is unchanged, and where it first differs, with the old and new text side by side.
// A healthy chat differs only near the end (the new messages and the per-turn rules).
//
// Kept in memory only, for the session: it holds two prompts' worth of text.
// ─────────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 3.5;   // the same estimate Story Memory uses
const tokens = chars => Math.ceil(chars / CHARS_PER_TOKEN);

let prev = null;   // { at, kind, texts, roles }
let last = null;   // the latest comparison (see compare)

const textOf = m => typeof (m && m.content) === "string" ? m.content
    : Array.isArray(m && m.content) ? m.content.map(p => (p && p.type === "text" ? p.text : "[image]")).join("\n") : "";
const firstLine = s => (String(s).split("\n").find(l => l.trim()) || "").trim().slice(0, 70);
const around = (s, at) => (at > 40 ? "…" : "") + s.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ") + (s.length > at + 60 ? "…" : "");

/**
 * How `texts`/`roles` compare with the previous prompt: the unchanged lead in whole
 * messages (what a cache can match), and the first difference down to the character.
 */
function compare(a, b) {
    let i = 0, stable = 0;
    while (i < a.texts.length && i < b.texts.length && a.texts[i] === b.texts[i] && a.roles[i] === b.roles[i]) {
        stable += b.texts[i].length;
        i++;
    }
    const total = b.texts.reduce((n, t) => n + t.length, 0);
    let change = null;
    if (i < b.texts.length) {
        const was = i < a.texts.length ? a.texts[i] : "";
        const now = b.texts[i];
        let j = 0;
        while (j < was.length && j < now.length && was[j] === now[j]) j++;
        change = {
            index: i, of: b.texts.length, role: b.roles[i], label: firstLine(now),
            was: i < a.texts.length ? around(was, j) : "(no message here before)", now: around(now, j),
            // Messages after the change: a change in the last few is the chat moving on.
            fromEnd: b.texts.length - i,
        };
    }
    return {
        stableTokens: tokens(stable), totalTokens: tokens(total), ratio: total ? stable / total : 1,
        minutes: (b.at - a.at) / 60000, kind: b.kind, prevKind: a.kind, change,
    };
}

/**
 * Called with every prompt that goes out from the VCRP preset (not dry runs, not a
 * standalone summary call, which carries a prompt of its own). `kind` names it for the
 * report: "reply", "continue", "impersonate", "quiet".
 */
export function vcrpCacheCheckRecord(messages, kind = "reply", now = Date.now()) {
    if (!Array.isArray(messages) || !messages.length) return;
    const cur = { at: now, kind, texts: messages.map(textOf), roles: messages.map(m => String(m && m.role)) };
    if (prev) last = compare(prev, cur);
    prev = cur;
}

/** The latest comparison, or null before there are two prompts to compare. */
export function vcrpCacheCheckReport() {
    return last;
}

/**
 * Whether the latest comparison shows a problem: the cache would still have been warm, but
 * the prompt changed long before its end. A change only in the newest few messages (the
 * reply, the new message, the per-turn rules sitting among them) is normal.
 */
export function vcrpCacheCheckTrouble(report = last, ttlMinutes = 60) {
    if (!report || !report.change || report.minutes > ttlMinutes * 0.95) return false;
    return report.change.fromEnd > 6 && report.ratio < 0.7;
}

/**
 * The report in words, for Setup Check and the Memory tab: {level: "warn"|"ok", title,
 * detail}, or null when there is nothing to say (no comparison yet, or the cache had
 * expired between the two prompts anyway).
 */
export function vcrpCacheCheckSummary(report = last, ttlMinutes = 60) {
    if (!report || report.minutes > ttlMinutes * 0.95) return null;
    const k = n => `${(n / 1000).toFixed(1)}k`;
    if (vcrpCacheCheckTrouble(report, ttlMinutes)) {
        const c = report.change;
        return {
            level: "warn",
            title: `The prompt changed early: only about ${k(report.stableTokens)} of ${k(report.totalTokens)} tokens could be read from the cache`,
            detail: `The first change is in message ${c.index + 1} of ${c.of} (${c.role}), which starts "${c.label}". Before: "${c.was}" Now: "${c.now}" `
                + "Everything after that point is written to the cache again, at double price, on every request. Usual causes: a lorebook (World Info) entry that switches on and off with keywords, or a macro such as {{time}}, {{date}} or {{random}} in the card, persona or lorebook.",
        };
    }
    return {
        level: "ok",
        title: `Cache check: the last request kept about ${k(report.stableTokens)} of ${k(report.totalTokens)} tokens of the one before`,
        detail: report.change ? "Only the newest messages changed, as they should." : "",
    };
}

/** Tests start clean. */
export function vcrpCacheCheckReset() {
    prev = null;
    last = null;
}
