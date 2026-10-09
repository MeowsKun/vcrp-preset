// ─────────────────────────────────────────────────────────────────────────────
// VCRP: a sideways scroll is not a swipe.
//
// SillyTavern reads a sideways drag anywhere in the chat as a swipe, and a swipe on the
// last reply regenerates it. The blocks card keeps its own touches (blocks/render.js), but
// the story can hold things wider than a phone screen too: an HTML object (Pura's, or the
// Immersive HTML add-on's terminals, menus and signs), a table, a code block. A touch that
// starts inside something in a message that really scrolls sideways stays there: it
// scrolls, and never reaches the swipe gesture. Anywhere else, swiping works as before.
// ─────────────────────────────────────────────────────────────────────────────

const SCROLLS = /^(auto|scroll|overlay)$/i;
const TOUCHES = ["touchstart", "touchmove", "touchend"];

/** The element a touch started on is inside a message's text, in something that scrolls sideways. */
export function scrollsSideways(target, win) {
    const start = target && (target.nodeType === 1 ? target : target.parentElement);
    const text = start && typeof start.closest === "function" ? start.closest(".mes_text") : null;
    if (!text) return false;
    const view = win || (start.ownerDocument && start.ownerDocument.defaultView) || null;
    for (let el = start; el; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 2) {
            const style = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle(el) : el.style;
            if (SCROLLS.test(String((style && style.overflowX) || ""))) return true;
        }
        if (el === text) break;
    }
    return false;
}

/** Listens on the chat once. Returns false while the chat is not on the page yet. */
export function vcrpInstallSwipeGuard(doc = typeof document !== "undefined" ? document : null) {
    const chat = doc && doc.getElementById("chat");
    if (!chat) return false;
    if (chat.getAttribute("data-vcrp-swipe-guard") === "1") return true;
    chat.setAttribute("data-vcrp-swipe-guard", "1");
    const keep = e => { if (scrollsSideways(e.target)) e.stopPropagation(); };
    for (const type of TOUCHES) chat.addEventListener(type, keep, { passive: true });
    return true;
}
