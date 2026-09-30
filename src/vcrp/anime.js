// ─────────────────────────────────────────────────────────────────────────────
// VCRP: Anime mode.
//
// Rewrites dialogue, reactions, framing and pacing as anime/manga, injected as
// [[ANIMEMODE]]. Carried over from VCRP V8; stored on the profile as `animeMode`,
// the same key V8 used. The switch sits in the Writing Style sidebar under DN Ratio.
// ─────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../core/state.js";
import { saveProfileToMemory } from "../core/profile.js";

export const DEFAULT_ANIME_PROMPT = `Write the roleplay as a scene from an anime or manga. This is not light flavor: it must visibly reshape dialogue, narration, and plot movement wherever the scene allows. While active, this heightened framing overrides the grounded, low-melodrama narration defaults. Play it straight, never as winking parody.

DIALOGUE:
- Anime speech rhythm: characters blurt feelings when flustered, drop into quiet vulnerability when exposed, and snap into sharp outbursts when caught off guard ("I- you- what?!").
- In-character affectations where they fit: honorifics (-chan, -kun, -senpai, -sama), interjections ("eh?!", "mou~", "uso!", "haaah?", "d-dummy!"), a signature catchphrase or verbal tic per character.
- Tsundere deflection, dramatic declarations, comedic over-explanation, dense obliviousness to obvious feelings. Embody the tropes; never announce them.

REACTIONS:
- Exaggerate cues the way anime frames them, as described action: furious blushing, comedic tears, jaw-drops, sweat-drops, going board-stiff, sparkling eyes, the dramatic stumble, steam from the ears.
- Scale emotion to anime size: small embarrassment becomes a full-body meltdown; a confession freezes the world for a beat.

NARRATION:
- Frame scenes like manga panels: hard cuts to a telling detail, a held beat before a big line, close-ups on a hand, an eye, a trembling lip.
- Slow-motion on emotional or action peaks. Internal monologue can cut in as sharp present-tense intrusion.
- Translate anime visual beats into prose: wind catching hair, petals or light flaring, the static hush before impact.

PLOT & PACING:
- Episodic momentum, rising rivalries, slow-burn romance with charged near-moments, dramatic reveals, cliffhanger beats, and comedic timing that punctures tension.

DEPICTION (SFW and NSFW):
- Outfits and transformations: loving detail on how fabric sits, clings, and moves; uniforms, frills, ribbons; transformation flair when fitting.
- Hypnosis and trance: spiral or heart-shaped pupils, a glazed, pliant expression, a sing-song or echoing trigger, the slow droop into blank obedience.
- Sex scenes: ecchi/hentai style. Heightened expressive reactions, flushed and dramatized framing, exaggerated sensation and sound, the genre's vocabulary and visual emphasis. Vivid and fully in-genre.`;

// Appended to whichever anime text is in use, so the precedence always holds.
const ANIME_PRECEDENCE = "While Anime mode is on, its dialogue and reaction style overrides the engine's dialogue restrictions on catchphrases, declarations, punchlines, and polish. The ban list still applies.";

export function ensureAnimeMode(profile) {
    if (!profile.animeMode) profile.animeMode = { enabled: false, prompt: "" };
    return profile.animeMode;
}

/** Text for [[ANIMEMODE]] and the one-sentence reminder appended to the CoT. */
export function buildAnimeMode(profile = localProfile) {
    const am = profile && profile.animeMode;
    if (!am || !am.enabled) return { block: "", cotNote: "" };
    const text = (am.prompt && am.prompt.trim()) ? am.prompt.trim() : DEFAULT_ANIME_PROMPT;
    return {
        block: `<anime_mode>\n${text}\n\n${ANIME_PRECEDENCE}\n</anime_mode>`,
        cotNote: "Also: this reply should read distinctly anime (see <anime_mode>), not just flavored.",
    };
}

/**
 * The Anime Mode switch for the Writing Style sidebar, drawn like the DN Ratio switch above it.
 * @param {() => void} rerender redraws the tab after the switch flips
 */
export function buildAnimeSidebarPanel(rerender) {
    const am = ensureAnimeMode(localProfile);
    const on = am.enabled;
    const panel = $(`
        <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-main);" title="Shift the writing toward anime/manga: speech patterns, exaggerated reactions, panel-style framing, dramatic beats."><i class="fa-solid fa-torii-gate" style="color: #f43f5e; margin-right: 5px;"></i> Anime Mode</span>
                <div class="ps-toggle-card ${on ? "active" : ""}" id="anime_toggle_sb" style="padding: 2px; min-width: 36px; background: transparent; border-color: ${on ? "#10b981" : "var(--border-color)"}; cursor: pointer; border-radius: 8px;">
                    <div class="ps-switch" style="transform: scale(0.65); ${on ? "background: #10b981;" : ""}"></div>
                </div>
            </div>
            <div style="display: ${on ? "block" : "none"};">
                <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color);">
                    <div style="font-size: 0.6rem; color: var(--text-muted); margin-bottom: 6px;">Edit to taste. Leave blank for the default.</div>
                    <textarea id="anime_prompt_input_sb" class="ps-modern-input" style="width: 100%; height: 120px; resize: vertical; font-size: 0.68rem; line-height: 1.45; font-family: monospace;" placeholder="Leave blank to use the built-in default prompt..."></textarea>
                    <button id="anime_reset_btn_sb" class="ps-modern-btn secondary" style="margin-top: 6px; padding: 3px 10px; font-size: 0.65rem; color: #f43f5e; border-color: rgba(244,63,94,0.3);"><i class="fa-solid fa-rotate-left"></i> Reset to Default</button>
                </div>
            </div>
        </div>
    `);
    panel.find("#anime_prompt_input_sb").val(am.prompt || "");
    panel.find("#anime_toggle_sb").on("click", function (e) {
        e.stopPropagation();
        am.enabled = !am.enabled;
        saveProfileToMemory();
        rerender();
    });
    panel.find("#anime_prompt_input_sb").on("change", function () {
        am.prompt = $(this).val();
        saveProfileToMemory();
    });
    panel.find("#anime_reset_btn_sb").on("click", function () {
        am.prompt = "";
        saveProfileToMemory();
        panel.find("#anime_prompt_input_sb").val("");
        toastr.success("Anime Mode prompt reset to default.");
    });
    return panel;
}
