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
// Two comparisons are kept. A reply's prompt against the reply before it is the one that says
// whether the chat's cache holds. A background call's prompt (a summary, the call for missing
// blocks) is compared with the reply before it too, and kept apart: it used to take the
// reply's place a few seconds later, so a change the reply showed was gone from Setup Check
// before anyone could read it.
//
// One early change is the reader's own doing and costs what it should: a line added to or
// taken off the Canon sheet (canon.js), which sits in the cached part on purpose. It is said
// as that, once, and not as a fault.
//
// Kept in memory only, for the session: it holds two prompts' worth of text.
// ─────────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 3.5;   // the same estimate Story Memory uses
const tokens = chars => Math.ceil(chars / CHARS_PER_TOKEN);

let prev = null;        // the last reply's prompt: { at, kind, texts, roles, lastReply }
let lastReply = null;   // how the last reply's prompt compared with the reply before it (see compare)
let lastQuiet = null;   // how the latest background call since then compared with that reply

// Prompts the chat itself moves on with. A background call (a summary, a check) is compared
// with the reply before it, never the other way round: its own task is not part of the chat.
const REPLY_KINDS = new Set(["reply", "continue", "impersonate"]);

// The last reply in a prompt: an assistant message that is not trailing (a trailing one is
// a prefill or a reply being continued). Everything up to and including it is chat that the
// next prompt must carry unchanged.
function lastReplyIndex(roles) {
    let end = roles.length;
    if (end && roles[end - 1] === "assistant") end--;
    for (let i = end - 1; i >= 0; i--) if (roles[i] === "assistant") return i;
    return -1;
}

const textOf = m => typeof (m && m.content) === "string" ? m.content
    : Array.isArray(m && m.content) ? m.content.map(p => (p && p.type === "text" ? p.text : "[image]")).join("\n") : "";
const firstLine = s => (String(s).split("\n").find(l => l.trim()) || "").trim().slice(0, 70);
const around = (s, at) => (at > 40 ? "…" : "") + s.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ") + (s.length > at + 60 ? "…" : "");
// Is position `at` of `s` inside the Canon sheet's block: from its opening tag to its closing
// one, which is where a line added at the end first shows? (A line cannot hold either tag:
// canon.js guards them.) Text that follows the sheet is not the sheet.
function inCanon(s, at) {
    const open = s.lastIndexOf("<canon>", at);
    if (open < 0) return false;
    const close = s.indexOf("</canon>", open);
    return close < 0 || at <= close;
}

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
            // At or before the previous prompt's last reply: chat that should not have changed.
            early: i <= a.lastReply,
            // The first difference lies in the Canon sheet: the reader changed it.
            canon: inCanon(was, j) || inCanon(now, j),
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
    const roles = messages.map(m => String(m && m.role));
    const cur = { at: now, kind, texts: messages.map(textOf), roles, lastReply: lastReplyIndex(roles) };
    const reply = REPLY_KINDS.has(kind);
    if (prev) {
        const c = compare(prev, cur);
        if (reply) { lastReply = c; lastQuiet = null; } else lastQuiet = c;
    }
    if (reply) prev = cur;
}

/**
 * The comparison to show, or null before there are two prompts to compare: the last reply's
 * with the reply before it; or the background call's since then, when that one changed
 * something early and the reply did not (or there is no reply's yet).
 */
export function vcrpCacheCheckReport(ttlMinutes = 60) {
    if (lastQuiet && (!lastReply || (vcrpCacheCheckTrouble(lastQuiet, ttlMinutes) && !vcrpCacheCheckTrouble(lastReply, ttlMinutes)))) return lastQuiet;
    return lastReply;
}

/**
 * Whether a comparison shows a problem: the cache would still have been warm, but something
 * changed at or before the previous prompt's last reply, which was already chat. Changes
 * after it (the new reply, the newest message, the per-turn rules) are normal, and so is the
 * Canon sheet the reader has just changed.
 */
export function vcrpCacheCheckTrouble(report = vcrpCacheCheckReport(), ttlMinutes = 60) {
    if (!report || !report.change || report.minutes > ttlMinutes * 0.95) return false;
    return report.change.early === true && !report.change.canon;
}

/**
 * The report in words, for Setup Check and the Memory tab: {level: "warn"|"ok", title,
 * detail}, or null when there is nothing to say (no comparison yet, or the cache had
 * expired between the two prompts anyway).
 */
export function vcrpCacheCheckSummary(report = vcrpCacheCheckReport(), ttlMinutes = 60) {
    if (!report || report.minutes > ttlMinutes * 0.95) return null;
    const k = n => `${(n / 1000).toFixed(1)}k`;
    if (report.change && report.change.early && report.change.canon) {
        return {
            level: "ok",
            title: `Cache check: the Canon sheet changed, so the last request wrote its prompt again (about ${k(report.totalTokens - report.stableTokens)} of ${k(report.totalTokens)} tokens)`,
            detail: "A change to the Canon sheet is paid for once: the sheet sits in the cached part of the prompt, so the request after a change writes everything from it on in full. The next request reads from the cache again.",
        };
    }
    if (vcrpCacheCheckTrouble(report, ttlMinutes)) {
        const c = report.change;
        return {
            level: "warn",
            title: `The prompt changed early: only about ${k(report.stableTokens)} of ${k(report.totalTokens)} tokens could be read from the cache`,
            detail: `The first change is in message ${c.index + 1} of ${c.of} (${c.role}), which starts "${c.label}". It was already in the previous prompt, so it should not have changed. Before: "${c.was}" Now: "${c.now}" `
                + "Everything after that point is written to the cache again, at double price. Usual causes: a lorebook (World Info) entry that switches on and off with keywords; a macro such as {{time}}, {{date}} or {{random}} in the card, persona or lorebook; a regex that edits older messages differently from newer ones.",
        };
    }
    return {
        level: "ok",
        title: `Cache check: the last request kept about ${k(report.stableTokens)} of ${k(report.totalTokens)} tokens of the reply before it`,
        detail: report.change ? "Nothing that was already in the chat changed; only the new messages and the per-turn rules did, as they should." : "",
    };
}

/** Tests start clean. */
export function vcrpCacheCheckReset() {
    prev = null;
    lastReply = null;
    lastQuiet = null;
}
