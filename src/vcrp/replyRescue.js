// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a reply that SillyTavern's Reasoning Auto-Parse swallowed, put back.
//
// With Auto-Parse on (Advanced Formatting → Reasoning), SillyTavern takes a streamed reply
// that opens with its template's prefix ("<think>" and a line break, in the DeepSeek template)
// and moves everything into the Thinking box until it meets the template's suffix, to the
// letter: a line break, then "</think>". A model that closes its thinking any other way
// ("...done.</think>" on the same line, "</thinking>", a space or a ^ before the tag), or
// never closes it, has its whole reply left in the Thinking box: the story too, and the
// message itself comes back empty. Nothing failed, nothing was filtered, the terminal shows a
// stream that finished; the reply is simply in the wrong box. (Without Auto-Parse the preset's
// own regex shows the thinking, and takes any of those closings.)
//
// So, as the reply arrives and before anything else reads it: an empty message whose
// reasoning SillyTavern parsed out of the reply's own text is looked at again.
//   - the thinking does close, VCRP's way of reading it: the story goes back into the
//     message, the thinking stays in the Thinking box. As Auto-Parse meant to leave it.
//   - it never closes: the text goes back into the message as it came, open <think> and all,
//     where it shows and is handled as a reply that left its thinking open (blankReply.js).
//   - it closes and nothing follows: nothing to put back; it is a reply that is all thinking.
// SillyTavern cuts its suffix away when it meets it, so what it kept reads the same for the
// last two; what the model itself sent (generationTrace.js reads it as it passes) tells them
// apart. Without that, a reply with no closing tag in sight is left as it is.
// The reasoning a provider sends beside the reply (a model's own, hidden reasoning) is never
// touched: there is no story in it.
// ─────────────────────────────────────────────────────────────────────────────

import { getContext } from "../st.js";
import { vcrpArrivedText } from "./generationTrace.js";

// Any way a model closes its thinking: </think>, </thinking>, spaces inside, a ^ before it.
const CLOSE = /\^?[ \t]*<\/\s*think(?:ing)?\s*>/i;
const PLACEHOLDER = /^(?:\s*|\s*\.\.\.\s*)$/;
const DEFAULT_PREFIX = "<think>\n";

/** True for a message SillyTavern left with nothing in it ("" or its "..." placeholder). */
export const isEmptyMessage = text => PLACEHOLDER.test(String(text ?? ""));

/**
 * Where a swallowed reply's thinking ends (pure). `reasoning` is what SillyTavern kept: the
 * reply's text after the template's prefix. Returns { closed, thinking, story }: closed false
 * when no closing tag is in it at all (story is then ""), else the two halves, trimmed.
 */
export function splitSwallowedReply(reasoning) {
    const s = String(reasoning || "");
    const m = CLOSE.exec(s);
    if (!m) return { closed: false, thinking: s.trim(), story: "" };
    return { closed: true, thinking: s.slice(0, m.index).trim(), story: s.slice(m.index + m[0].length).trim() };
}

/**
 * What to do with a message (pure): null to leave it, or { how: "closed", mes, reasoning } /
 * { how: "open", mes } to put back. `prefix` is SillyTavern's Reasoning template prefix;
 * `arrived` is the reply text as the model sent it, when its answer was read (else null).
 */
export function rescuePlan(msg, prefix = DEFAULT_PREFIX, arrived = null) {
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== "string") return null;
    if (!isEmptyMessage(msg.mes)) return null;
    const x = msg.extra || {};
    // Only reasoning SillyTavern parsed out of the reply's own text ("parsed"): a model's own
    // reasoning, sent beside the reply, holds no story.
    if (x.reasoning_type !== "parsed") return null;
    const kept = String(x.reasoning || "");
    if (!kept.trim()) return null;
    const cut = splitSwallowedReply(kept);
    if (cut.closed) return cut.story ? { how: "closed", mes: cut.story, reasoning: cut.thinking } : null;
    // No closing tag in what SillyTavern kept. Either it met its suffix, cut it away, and nothing
    // followed (a reply that is all thinking: nothing to put back), or the thinking never closed
    // and the Thinking box holds the whole reply. What the model sent says which; without it the
    // message is left as it is.
    if (typeof arrived !== "string" || !arrived.trim() || CLOSE.test(arrived)) return null;
    return { how: "open", mes: `${String(prefix || DEFAULT_PREFIX)}${kept.trim()}` };
}

let said = false;

/** For tests: the once-a-session notice is said again. */
export function resetRescueNotice() { said = false; }

/**
 * MESSAGE_RECEIVED, before every handler that reads the reply: a reply Auto-Parse swallowed
 * is put back. Returns "closed" | "open" when it was, else "".
 */
export function vcrpRescueOnReply(messageId, type) {
    const id = Number(messageId);
    const arrived = vcrpArrivedText(id);   // asked for every reply: the text is let go of here
    if (type === "first_message" || type === "continue") return "";
    const ctx = getContext() || {};
    const chat = ctx.chat || [];
    const msg = chat[id];
    const rs = (ctx.powerUserSettings && ctx.powerUserSettings.reasoning) || {};
    const plan = rescuePlan(msg, rs.prefix, arrived);
    if (!plan) return "";
    msg.mes = plan.mes;
    msg.extra = { ...(msg.extra || {}), vcrp_rescued: plan.how };
    if (plan.how === "closed") {
        if (plan.reasoning) msg.extra.reasoning = plan.reasoning;
        else { delete msg.extra.reasoning; delete msg.extra.reasoning_duration; delete msg.extra.reasoning_type; }
    } else {
        // The thinking is back in the message, open: no Thinking box beside it.
        delete msg.extra.reasoning;
        delete msg.extra.reasoning_duration;
        delete msg.extra.reasoning_type;
        delete msg.extra.reasoning_display_text;
    }
    // The swipe SillyTavern filed a moment ago holds the empty text: the same goes there.
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number" && typeof msg.swipes[msg.swipe_id] === "string") {
        msg.swipes[msg.swipe_id] = msg.mes;
        const info = Array.isArray(msg.swipe_info) ? msg.swipe_info[msg.swipe_id] : null;
        if (info && typeof info === "object") {
            try { info.extra = typeof structuredClone === "function" ? structuredClone(msg.extra) : JSON.parse(JSON.stringify(msg.extra)); } catch (e) { info.extra = { ...msg.extra }; }
        }
    }
    try { if (typeof ctx.updateMessageBlock === "function") ctx.updateMessageBlock(id, msg); } catch (e) { console.warn("[VCRP] Reply put back, but the message could not be redrawn", e); }
    console.info(`[VCRP] Reply #${id}: SillyTavern's Reasoning Auto-Parse had left the message empty (${plan.how === "closed" ? "the thinking closed another way than its template's suffix" : "the thinking never closed"}); put back.`);
    if (!said && typeof toastr !== "undefined") {
        said = true;
        toastr.info(plan.how === "closed"
            ? "SillyTavern's Reasoning Auto-Parse had moved this whole reply into the Thinking box and left the message empty: the model closed its thinking, but not to the letter of the template's suffix. VCRP put the story back. It does so quietly from here on; Setup Check counts them."
            : "SillyTavern's Reasoning Auto-Parse had moved this whole reply into the Thinking box and left the message empty: the model never closed its thinking. VCRP put the text back into the message as it came. It does so quietly from here on; Setup Check counts them.",
        "VCRP: a reply put back", { timeOut: 16000, extendedTimeOut: 8000 });
    }
    return plan.how;
}
