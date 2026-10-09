// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Pura's {{random}} lists, read the way SillyTavern reads them.
//
// {{random::a::b::c}} (or {{random:a,b,c}}) is one pick from a list; an option may hold
// other macros, {{random}} ones included. Two readers:
//   expectedText  the text a request carries on average (each list as its average-length
//                 option), for the cost hints;
//   rollRandoms   an actual roll, with what was picked, so VCRP can say what each reply
//                 got (and roll the same again on a swipe).
// ─────────────────────────────────────────────────────────────────────────────

// The index just after the }} closing the macro that opens at `at`, or -1.
function macroEnd(s, at) {
    let depth = 0;
    for (let j = at; j < s.length - 1; j++) {
        if (s[j] === "{" && s[j + 1] === "{") { depth++; j++; } else if (s[j] === "}" && s[j + 1] === "}") { depth--; j++; if (depth === 0) return j + 1; }
    }
    return -1;
}

// `body` split on `sep` outside any nested {{…}}.
function splitTop(body, sep) {
    const parts = [];
    let depth = 0, cur = "";
    for (let j = 0; j < body.length; j++) {
        if (body.startsWith("{{", j)) { depth++; cur += "{{"; j++; continue; }
        if (body.startsWith("}}", j)) { depth--; cur += "}}"; j++; continue; }
        if (depth === 0 && body.startsWith(sep, j)) { parts.push(cur); cur = ""; j += sep.length - 1; continue; }
        cur += body[j];
    }
    parts.push(cur);
    return parts;
}

// Every {{random}} in `text`, outermost first, each replaced by what `choose(options)` returns.
function eachRandom(text, choose) {
    const s = String(text || "");
    let out = "", i = 0;
    for (;;) {
        const at = s.indexOf("{{random", i);
        if (at < 0) return out + s.slice(i);
        out += s.slice(i, at);
        const end = macroEnd(s, at);
        if (end < 0) return out + s.slice(at);
        const inner = s.slice(at + 2, end - 2);
        const colons = /^random\s*::/.test(inner);
        const opts = splitTop(inner.replace(/^random\s*::?/, ""), colons ? "::" : ",").map(o => (colons ? o : o.trim()));
        out += choose(opts);
        i = end;
    }
}

/** The text a request carries: each {{random}} as its average-length option, a {{roll}} as a number. */
export function expectedText(text) {
    return eachRandom(text, raw => {
        const opts = raw.map(expectedText);
        const avg = opts.reduce((n, o) => n + o.length, 0) / Math.max(1, opts.length);
        return opts.reduce((best, o) => (Math.abs(o.length - avg) < Math.abs(best.length - avg) ? o : best), opts[0] || "");
    }).replace(/\{\{roll[^}]*\}\}/g, "50");
}

/**
 * One roll of every {{random}} in `text`: { text, picks: [{ index, text }] }, the picks in
 * the order they were made (outer before inner). `reuse` gives indices to pick again, in
 * that order; one out of range for its list (the list changed) is rolled fresh.
 */
export function rollRandoms(text, { reuse = [], rng = Math.random } = {}) {
    const picks = [];
    const walk = t => eachRandom(t, opts => {
        const want = reuse[picks.length];
        const index = Number.isInteger(want) && want >= 0 && want < opts.length ? want : Math.min(opts.length - 1, Math.floor(rng() * opts.length));
        const slot = picks.push({ index, text: "" }) - 1;
        picks[slot].text = walk(opts[index]);
        return picks[slot].text;
    });
    return { text: walk(text), picks };
}

/** A pick as one short line: its first line that is not a heading, at most 160 characters. */
export function pickLabel(text) {
    const lines = String(text || "").split("\n").map(l => l.trim()).filter(l => l && !/^#/.test(l));
    const t = (lines[0] || String(text || "").trim()).replace(/\s+/g, " ");
    return t.length > 160 ? `${t.slice(0, 157).trimEnd()}…` : t;
}
