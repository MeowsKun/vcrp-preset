// ─────────────────────────────────────────────────────────────────────────────
// Which generation an engine belongs to, and what that means.
//
// One spelling for each test, and behaviour asked for by name rather than by generation:
// that is how V10 once came to announce itself as V9 in two places. A screen that wants to
// know what to CALL the engine reads `engine.label`; it never reconstructs the name from a
// flag. VCRP ships Megumin Suite's V10 and V11 generations and Pura's engines; the older
// generations (V7 to V9) and their tests are gone.
// ─────────────────────────────────────────────────────────────────────────────

// Pure predicates over an engine object. No imports on purpose — every caller
// already has the engine in hand, and keeping this dependency-free means any
// layer can use it.
export const isV10Engine = m => !!m && (String(m.id || "").startsWith("v10") || m.isV10 === true);
export const isV11Engine = m => !!m && (String(m.id || "").startsWith("v11") || m.isV11 === true);

/** Keeps an Author's Notebook by itself (V11): its own text speaks of it, so it is always on. */
export const engineKeepsNotebook = m => !!m && m.notebook === true;

// The Co-writer variants, which author {{user}} as well as the world. Flag first
// so a clone of one keeps answering true, id suffix second so an engine built
// before the flag existed still reads correctly. VCRP ships none; an imported one counts.
export const isCoWriterEngine = m => !!m && (m.isCoWriter === true || String(m.id || "").endsWith("-cw"));

// The Megumin Original engines: Megumin Suite's own text, which also takes the
// original wording of every shared text (styles, add-ons, Story Config). Flag only,
// so a Dev Mode clone of one stays original.
export const isMeguminEngine = m => !!m && m.megumin === true;

// The Pura Director pair (VCRP): Pura's Director Preset as an engine, word for word
// ("original") or reworded where it clashes with VCRP's modules ("adapted"). Its text is
// assembled from the reader's Pura settings rather than stored on the engine.
export const isPuraEngine = m => !!m && (m.pura === "original" || m.pura === "adapted");
export const puraVariant = m => (isPuraEngine(m) ? m.pura : null);

// ── Behaviour, named for what it does ────────────────────────────────────────

/** Carries its own persona and narrative toggles, and places the writing style in its own
 *  text: V10 and V11, the generations VCRP ships. */
export const isModernEngine = m => isV10Engine(m) || isV11Engine(m);

/** Requires a narrative style directive, so "No Style (Off)" is refused. */
export const engineLocksStyle = m => isModernEngine(m);

// The built-in styles a generation offers (Megumin Suite V11: V11 Default and V11 Inside).
// Switching between the engines of one generation keeps whichever of them is in use.
const STYLE_FAMILY = { dir_v11: ["dir_v11", "dir_v11_inside"] };
export const styleFamily = id => STYLE_FAMILY[id] || (id ? [id] : []);

/** The built-in style an engine drops you on when you switch to it. */
export function lockedStyleIdFor(m) {
    if (!m) return null;
    if (isV11Engine(m)) return "dir_v11";
    // Shura before the general V10 test: "v10-shura-megumin" is both, and the more
    // specific answer is the right one.
    if (String(m.id || "").startsWith("v10-shura")) return "dir_v10_shura";
    if (isV10Engine(m)) return "dir_v10_ukiyo";
    return null;
}
