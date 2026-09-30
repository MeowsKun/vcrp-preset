// ─────────────────────────────────────────────────────────────────────────────
// VCRP: token breakdown for the Prompt Payload Preview.
//
// Shows what each part of the outgoing prompt costs. Preset sections (system
// messages, the instruction blocks after the history) get a row each; a run of
// chat messages is folded into one "Chat history" row so a long chat does not
// produce hundreds of rows.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { escapeHtmlAttr } from "../utils/html.js";

function textOf(m) {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.filter(c => c && c.type === "text").map(c => c.text).join("\n");
    return "";
}

function imagesOf(m) {
    return Array.isArray(m.content) ? m.content.filter(c => c && c.type !== "text").length : 0;
}

/** Groups messages into rows: each system message alone, consecutive user/assistant messages together. */
export function groupPromptRows(messages) {
    const rows = [];
    for (const m of messages) {
        const role = String(m.role || "system");
        const isChat = role === "user" || role === "assistant";
        const last = rows[rows.length - 1];
        if (isChat && last && last.chat) {
            last.parts.push(m);
            continue;
        }
        rows.push({ chat: isChat, role, parts: [m] });
    }
    // A chat run of one message right at the end is usually an instruction block (e.g. the prefill
    // or the Output RULES sent as "user"), so it is labelled by its own text, not as history.
    return rows.map((r, i) => {
        const text = r.parts.map(textOf).join("\n");
        const firstLine = (text.split("\n").find(l => l.trim()) || "").trim();
        const label = r.chat && r.parts.length > 1
            ? `Chat history (${r.parts.length} messages)`
            : `${r.role.toUpperCase()}: ${firstLine.slice(0, 70)}${firstLine.length > 70 ? "…" : ""}`;
        return { label, text, images: r.parts.reduce((n, m) => n + imagesOf(m), 0), index: i };
    });
}

async function countTokens(text) {
    try {
        const ctx = getContext();
        if (typeof ctx.getTokenCountAsync === "function") return await ctx.getTokenCountAsync(text);
    } catch (e) { /* fall back to an estimate */ }
    return Math.ceil(text.length / 3.8);
}

/** HTML table of tokens per prompt section, largest first, with the total. Empty string on failure. */
export async function buildTokenBreakdown(messages) {
    try {
        const rows = groupPromptRows(messages);
        const counts = await Promise.all(rows.map(r => countTokens(r.text)));
        const total = counts.reduce((a, b) => a + b, 0);
        if (!total) return "";
        const ordered = rows.map((r, i) => ({ ...r, tokens: counts[i] })).sort((a, b) => b.tokens - a.tokens);
        const bar = n => `<div style="height:4px; border-radius:2px; background:#a855f7; width:${Math.max(2, Math.round((n / total) * 100))}%;"></div>`;
        const body = ordered.map(r => `
            <tr>
                <td style="padding:3px 8px 3px 0; color:var(--text-main); max-width:420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtmlAttr(r.label)}">${escapeHtmlAttr(r.label)}${r.images ? ` <span style="color:#f59e0b;">(+${r.images} image${r.images > 1 ? "s" : ""})</span>` : ""}</td>
                <td style="padding:3px 8px; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;">${r.tokens.toLocaleString()}</td>
                <td style="padding:3px 0; width:120px;">${bar(r.tokens)}</td>
            </tr>`).join("");
        return `
            <details open style="font-size:0.75rem; background:rgba(0,0,0,0.25); border:1px solid var(--border-color); border-radius:8px; padding:8px 10px;">
                <summary style="cursor:pointer; font-weight:700; color:#a855f7;">Token breakdown · ~${total.toLocaleString()} tokens total</summary>
                <table style="width:100%; border-collapse:collapse; margin-top:6px;">${body}</table>
            </details>`;
    } catch (e) {
        console.warn("[VCRP] Token breakdown failed:", e);
        return "";
    }
}
