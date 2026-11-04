// ─────────────────────────────────────────────────────────────────────────────
// VCRP: which blocks the helper model writes this turn. One answer for everyone who asks:
// the story prompt (buildBaseDict leaves them out), the second call for missing blocks
// (blockRepair does not ask for them), the helper's own prompt (blocks.js) and the tab.
// ─────────────────────────────────────────────────────────────────────────────

import { meguminActiveBlocks } from "../../features/blocks/registry.js";
import { sceneWanted, SCENE_NEEDS } from "../scene.js";
import { customBlockDueNow } from "../customDue.js";
import { helperRoutesBlocks, helperBlockRouted, routableBlock } from "./settings.js";

/** The blocks the helper writes this turn, in stack order (empty while it writes none). */
export function helperRoutedBlocks() {
    if (!helperRoutesBlocks()) return [];
    let active = [];
    try { active = meguminActiveBlocks(); } catch (e) { return []; }
    return active.filter(b => routableBlock(b) && helperBlockRouted(b.id) && (b.builtin || customBlockDueNow(b)));
}

/**
 * Their ids: what the story model is not asked for. The scene list goes with them when the
 * blocks that follow it (World State, Bonds, NPC Inner Chatter) all do; while the story model
 * keeps one of those, it keeps the scene list that opens them.
 */
export function helperRoutedIdSet() {
    const routed = new Set(helperRoutedBlocks().map(b => b.id));
    if (!routed.size || !sceneWanted()) return routed;
    let active = [];
    try { active = meguminActiveBlocks(); } catch (e) { active = []; }
    const storyKeepsOne = active.some(b => b && SCENE_NEEDS.includes(b.id) && !routed.has(b.id));
    if (!storyKeepsOne) routed.add("scene");
    return routed;
}
