// ────────────────────────────────────────────────────────────────────────────
// The Blocks tab — stack, per-block settings, stat fields, and the live preview.
//
// Separate from blocks/chat.js because the preview renders through the dict
// builder: it draws from the same code the chat uses, so a preview can never
// disagree with the real thing. That pulls in the top of the graph, which the
// chat-side renderer has no need of.
// ────────────────────────────────────────────────────────────────────────────

import { getContext, Popup, POPUP_TYPE } from "../../st.js";
import { localProfile } from "../../core/state.js";
import { saveProfileToMemory, saveProfileDebounced, deleteCustomBlockEverywhere } from "../../core/profile.js";
import { escapeHtmlAttr } from "../../utils/html.js";
import { buildBlocksCard, extractBlocks } from "../../blocks/render.js";
import { buildBaseDict } from "../../engine/buildBaseDict.js";
import {
    MEGUMIN_BLOCK_REGISTRY, BLOCK_VISIBILITY_CHOICES, STAT_FIELD_PACKS, STAT_FIELD_TYPES,
    meguminRenderRegistry, meguminActiveBlocks, meguminBlockById, meguminStatFields, meguminStatFieldMap,
    normalizeBlockBody, blockTagFromName, validateCustomBlock, meguminSyncLegacyBlockIds, meguminBuildCustomTemplate,
} from "./registry.js";
import { normalizeCustomBlock } from "../../vcrp/customBlocks.js";
import { sceneListOn, sceneWanted, sceneBlockRequest } from "../../vcrp/scene.js";
import { meguminScheduleBlocksRefresh } from "./chat.js";
import { blockTwinsInStack } from "./puraBlocks.js";
import { trackerCostLabel, trackersCost, usd, puraPrice } from "../../vcrp/pura/costs.js";
import { meguminSlotByTrigger } from "../../../data/slots.js";
import { hasSharedFragment } from "../../core/sharedFragments.js";
import { castMemoryOn } from "../../vcrp/castMemory.js";
import { blockRepairOn, setBlockRepairOn } from "../../vcrp/blockRepair.js";
import { openBlocksEditor } from "../../vcrp/blocksEditor.js";
import { notebookOn } from "../../vcrp/notebook/index.js";

// Mirrors customBadge() in ui/tabs/globalAndBlocks.js: a block whose text was
// rewritten in Dev Mode says so here, where it is switched on and ordered.
// The link is b.source -- the trigger the block already declares to read its
// body out of the dictionary -- so no lookup table can rot.
function editedFlag(b) {
    const slot = b && b.source ? meguminSlotByTrigger(b.source) : null;
    if (!slot || !slot.key || !hasSharedFragment(slot.key)) return "";
    return ` <span class="blk-edited-flag" title="You edited this in Dev Mode. It no longer uses the built-in text.">edited</span>`;
}

// VCRP: "Remember every character" (vcrp/castMemory.js), under World State, or under Bonds
// when World State is not in the stack.
function castMemoryRow() {
    const on = castMemoryOn();
    return `
                    <div class="blk-sub-row">
                        <div>
                            <div class="blk-sub-label">Remember every character</div>
                            <div class="blk-sub-desc">Someone named again who is no longer in the last blocks comes back as last recorded: their World State entry and Bonds line from earlier in the chat, sent only on those turns, after the chat.</div>
                        </div>
                        <div class="ps-toggle-card ${on ? 'active' : ''}" id="blk_cast_memory_toggle" style="padding:2px; min-width:40px; background:transparent; border-color:${on ? '#10b981' : 'var(--border-color)'}; cursor:pointer; border-radius:8px;">
                            <div class="ps-switch" style="transform: scale(0.7); ${on ? 'background:#10b981;' : ''}"></div>
                        </div>
                    </div>`;
}
function wireCastMemoryRow(sub, c) {
    sub.find("#blk_cast_memory_toggle").on("click", () => {
        localProfile.castMemory = { enabled: !castMemoryOn() };
        saveProfileToMemory(); renderBlocksTab(c);
    });
}

export function renderBlocksTab(c) {
    c.empty();
    const stack = localProfile.blockStack;
    const all = [...MEGUMIN_BLOCK_REGISTRY, ...(stack.custom || [])].filter(b => !b.system);
    const inStack = stack.order.map(id => meguminBlockById(id)).filter(b => b && !b.system);
    const available = all.filter(b => !stack.order.includes(b.id));

    const visOf = b => (stack.overrides[b.id] && stack.overrides[b.id].visibility) || b.visibility || "open";

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #b45309);"><i class="fa-solid fa-cubes"></i></div>
                <div>
                    <h2>Blocks</h2>
                    <p>Everything in this list is sent as one master block at the end of the reply, and drawn in the chat as one collapsible card.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.25);">
                <i class="fa-solid fa-layer-group" style="font-size:0.6rem;"></i> ${inStack.length} in block
            </div>
        </div>
    `);

    const layout = $(`<div class="blk-layout"></div>`);
    const left = $(`<div class="blk-col"></div>`);
    const right = $(`<div class="blk-col"></div>`);

    // ── IN THE BLOCK ──
    left.append(`<div class="wstyle-section-head gold"><i class="fa-solid fa-list-ol"></i> Inside the master block</div>`);
    // VCRP: the blocks a reply leaves out, asked for in a second call (vcrp/blockRepair.js).
    const repairOn = blockRepairOn();
    const repair = $(`
        <div class="blk-sub" style="margin-bottom:10px;">
            <div class="blk-sub-row">
                <div>
                    <div class="blk-sub-label">Ask again for missing blocks</div>
                    <div class="blk-sub-desc">When a reply arrives without its blocks, or with one cut off, VCRP asks the model for just the blocks in a small second call (it reads the cache) and adds them to the reply. Gemini and DeepSeek skip them now and then.</div>
                </div>
                <div class="ps-toggle-card ${repairOn ? 'active' : ''}" id="blk_repair_toggle" style="padding:2px; min-width:40px; background:transparent; border-color:${repairOn ? '#10b981' : 'var(--border-color)'}; cursor:pointer;">
                    <div class="ps-switch" style="transform: scale(0.7); ${repairOn ? 'background:#10b981;' : ''}"></div>
                </div>
            </div>
        </div>`);
    repair.find("#blk_repair_toggle").on("click", () => { setBlockRepairOn(!blockRepairOn()); saveProfileToMemory(); renderBlocksTab(c); });
    left.append(repair);
    // VCRP: the story's state by hand (vcrp/blocksEditor.js): the same editor the pencil on a
    // reply's blocks card opens.
    const editor = $(`
        <div class="blk-sub" style="margin-bottom:10px;">
            <div class="blk-sub-row">
                <div>
                    <div class="blk-sub-label">Edit the blocks as they stand</div>
                    <div class="blk-sub-desc">The blocks under your latest reply are the state the next reply is handed, so a mistake in them is copied forward. Fix it here: each block in a box of its own, and one tap to take a character out of the scene. Saved under your latest reply. The pencil on a reply's blocks card opens the same editor.</div>
                </div>
                <button type="button" class="ps-modern-btn secondary" id="blk_edit_state" style="font-size:0.72rem; flex-shrink:0;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            </div>
        </div>`);
    editor.find("#blk_edit_state").on("click", () => { openBlocksEditor(); });
    left.append(editor);
    // VCRP: the scene list (Megumin Suite V11's 04/11 update, vcrp/scene.js).
    const sceneOn = sceneListOn();
    const scene = $(`
        <div class="blk-sub" style="margin-bottom:10px;">
            <div class="blk-sub-row">
                <div>
                    <div class="blk-sub-label">Who is in the scene</div>
                    <div class="blk-sub-desc">The story lists who is there at the end of every reply (Here, and Remote for a call or a text), first in the blocks, and is handed one name per character to write in every block. Sent while World State, Bonds or NPC Inner Chatter is in the block. The NPC Bank sends the dossiers of everyone listed first, Remember every character brings back someone listed, and Existing cast only counts them.${sceneOn && !sceneWanted() ? " Nothing is sent now: none of those three blocks is in." : ""}</div>
                </div>
                <div class="ps-toggle-card ${sceneOn ? 'active' : ''}" id="blk_scene_toggle" style="padding:2px; min-width:40px; background:transparent; border-color:${sceneOn ? '#10b981' : 'var(--border-color)'}; cursor:pointer;">
                    <div class="ps-switch" style="transform: scale(0.7); ${sceneOn ? 'background:#10b981;' : ''}"></div>
                </div>
            </div>
        </div>`);
    scene.find("#blk_scene_toggle").on("click", () => { localProfile.sceneList = { enabled: !sceneListOn() }; saveProfileToMemory(); renderBlocksTab(c); });
    left.append(scene);
    const list = $(`<div class="blk-stack"></div>`);

    if (!inStack.length) {
        list.append(`<div class="blk-empty">Nothing here yet. Add a block from the right.</div>`);
    }

    inStack.forEach((b, i) => {
        const off = typeof b.requires === "function" && !b.requires(localProfile);
        // VCRP: one of VCRP's blocks and its Pura twin in together: both get written every reply.
        const twins = blockTwinsInStack(b.id, stack.order).map(id => meguminBlockById(id)).filter(Boolean);
        const row = $(`
            <div class="blk-row ${off ? 'blk-row-off' : ''}"${b.desc ? ` title="${escapeHtmlAttr(b.desc)}"` : ""}>
                <div class="blk-row-main">
                    <span class="blk-emoji">${b.emoji || "📦"}</span>
                    <div>
                        <div class="blk-name">${b.label}${b.builtin ? "" : ` <span class="blk-custom-flag">custom</span>`}${editedFlag(b)}</div>
                        <div class="blk-tag">&lt;${b.tag}&gt;${off ? " — its feature is switched off, so it is not sent" : ""}</div>
                        ${twins.length ? `<div class="blk-overlap" style="font-size:0.68rem; color:#f59e0b; margin-top:2px;"><i class="fa-solid fa-clone"></i> Does the same job as ${twins.map(t => escapeHtmlAttr(t.label)).join(" and ")}, also in the block: the AI writes both every reply. Keep one.</div>` : ""}
                        ${b.group === "pura" && b.puraRules && !off ? `<div class="blk-cost" style="font-size:0.66rem; opacity:0.8; margin-top:2px;"><i class="fa-solid fa-coins"></i> ${escapeHtmlAttr(trackerCostLabel(b))}</div>` : ""}
                    </div>
                </div>
                <div class="blk-row-actions">
                    <button class="ws-btn-small blk-up" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="ws-btn-small blk-down" ${i === inStack.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
                    <select class="ps-modern-input blk-vis">
                        ${BLOCK_VISIBILITY_CHOICES.map(o => `<option value="${o.v}" ${(visOf(b) === "hidden" ? "hidden" : "open") === o.v ? "selected" : ""} title="${o.hint}">${o.label}</option>`).join("")}
                    </select>
                    ${b.builtin ? "" : `<button class="ws-btn-small blk-edit" style="color:var(--gold);"><i class="fa-solid fa-pen"></i></button>`}
                    <button class="ws-btn-small blk-remove" style="color:#ef4444;" title="${b.builtin ? "Take this block out" : "Take this block out for this character. It stays under Add a block for every character."}"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `);

        const move = delta => {
            const j = i + delta;
            if (j < 0 || j >= stack.order.length) return;
            const [id] = stack.order.splice(i, 1);
            stack.order.splice(j, 0, id);
            meguminSyncLegacyBlockIds();
            saveProfileToMemory(); renderBlocksTab(c);
        };
        row.find(".blk-up").on("click", () => move(-1));
        row.find(".blk-down").on("click", () => move(1));
        row.find(".blk-vis").on("change", function () {
            stack.overrides[b.id] = { ...(stack.overrides[b.id] || {}), visibility: $(this).val() };
            saveProfileToMemory(); renderBlocksTab(c);
        });
        row.find(".blk-remove").on("click", () => {
            stack.order = stack.order.filter(x => x !== b.id);
            meguminSyncLegacyBlockIds();
            saveProfileToMemory(); renderBlocksTab(c);
        });
        row.find(".blk-edit").on("click", () => renderCustomBlockEditor(c, b.id));
        list.append(row);

        // World State is the one block with a setting of its own: on most turns
        // it can send a shortened template and spend the full one only every few
        // replies. It rides under its own row rather than in a settings tab
        // somewhere else, because it is meaningless apart from this block.
        if (b.id === "world") {
            if (!localProfile.worldState) localProfile.worldState = { compactEnabled: false, fullFreq: 5 };
            const ws = localProfile.worldState;
            const sub = $(`
                <div class="blk-sub">
                    <div class="blk-sub-row">
                        <div>
                            <div class="blk-sub-label">Compact mode</div>
                            <div class="blk-sub-desc">Sends a shorter World State on most turns to save tokens.</div>
                        </div>
                        <div class="ps-toggle-card ${ws.compactEnabled ? 'active' : ''}" id="blk_compact_toggle" style="padding:2px; min-width:40px; background:transparent; border-color:${ws.compactEnabled ? '#10b981' : 'var(--border-color)'}; cursor:pointer; border-radius:8px;">
                            <div class="ps-switch" style="transform: scale(0.7); ${ws.compactEnabled ? 'background:#10b981;' : ''}"></div>
                        </div>
                    </div>
                    ${castMemoryRow()}
                    <div class="blk-sub-row" id="blk_freq_row" style="display:${ws.compactEnabled ? 'flex' : 'none'};">
                        <div>
                            <div class="blk-sub-label">Full state every</div>
                            <div class="blk-sub-desc">How often the complete template comes back.</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" id="blk_full_freq" class="ps-modern-input" min="1" value="${ws.fullFreq || 5}" style="width:60px; padding:4px; text-align:center; font-size:0.72rem;" />
                            <span style="font-size:0.68rem; color:var(--text-muted);">replies</span>
                        </div>
                    </div>
                </div>
            `);
            sub.find("#blk_compact_toggle").on("click", () => {
                ws.compactEnabled = !ws.compactEnabled;
                saveProfileToMemory(); renderBlocksTab(c);
            });
            wireCastMemoryRow(sub, c);
            sub.find("#blk_full_freq").on("input", function () {
                let v = parseInt($(this).val(), 10);
                if (isNaN(v) || v < 1) v = 5;
                ws.fullFreq = v; saveProfileDebounced();
            });
            list.append(sub);
        }
        // Bonds without World State: "Remember every character" works from Bonds alone, so its
        // switch sits under Bonds then.
        if (b.id === "bonds" && !stack.order.includes("world")) {
            const sub = $(`<div class="blk-sub">${castMemoryRow()}</div>`);
            wireCastMemoryRow(sub, c);
            list.append(sub);
        }

        // Stat blocks are generated from a field list, so they get an editor for it.
        if (b.id === "bonds" || b.id === "sheet") {
            list.append(renderStatFieldEditor(c, b));
        }
    });
    left.append(list);

    // VCRP: what Pura's trackers in the block come to, together (vcrp/pura/costs.js).
    const puraTotal = trackersCost(inStack.filter(b => !(typeof b.requires === "function" && !b.requires(localProfile))));
    if (puraTotal != null) {
        left.append(`<div class="blk-sub-desc" id="blk_pura_cost" style="margin:6px 0 0;"><i class="fa-solid fa-coins"></i> Pura's trackers here: ≈ ${escapeHtmlAttr(usd(puraTotal))} a reply together, on ${escapeHtmlAttr(puraPrice().label)}. What a tracker writes is measured from this chat's last 20 replies once it has appeared; rules are cached, formats and carried state are sent fresh.</div>`);
    }

    // ── AVAILABLE ──
    left.append(`<div class="wstyle-section-head green" style="margin-top:18px;"><i class="fa-solid fa-plus"></i> Add a block</div>`);
    const pool = $(`<div class="blk-pool"></div>`);
    if (!available.length) pool.append(`<div class="blk-empty">Every block is already in.</div>`);
    // VCRP: Pura's trackers in a group of their own, after VCRP's blocks.
    const addChip = (b, host) => {
        const chip = $(`<button class="blk-add"${b.desc ? ` title="${escapeHtmlAttr(b.desc)}"` : ""}><span>${b.emoji || "📦"}</span> ${b.label}${editedFlag(b)}</button>`);
        chip.on("click", () => {
            if (b.preferFirst) stack.order.unshift(b.id); else stack.order.push(b.id);
            meguminSyncLegacyBlockIds();
            saveProfileToMemory(); renderBlocksTab(c);
        });
        host.append(chip);
    };
    available.filter(b => b.group !== "pura").forEach(b => addChip(b, pool));
    const newBtn = $(`<button class="blk-add blk-add-new"><i class="fa-solid fa-wand-magic-sparkles"></i> Create custom block</button>`);
    newBtn.on("click", () => renderCustomBlockEditor(c, null));
    pool.append(newBtn);
    left.append(pool);
    const puraAvailable = available.filter(b => b.group === "pura");
    if (puraAvailable.length) {
        left.append(`<div class="wstyle-section-head" style="margin-top:14px; color:#ec4899;"><i class="fa-solid fa-clapperboard"></i> Pura's trackers</div>
            <div class="blk-sub-desc" style="margin-bottom:6px;">From Pura's Director Preset, drawn with Pura's own cards, for any engine. Most write only when something changes; VCRP hands the latest of each back every turn. Their full rules ride once in the cached part of the prompt.</div>`);
        const puraPool = $(`<div class="blk-pool"></div>`);
        puraAvailable.forEach(b => addChip(b, puraPool));
        left.append(puraPool);
    }

    // ── PREVIEW ──
    right.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-eye"></i> Preview</div>`);
    right.append(`<div class="blk-preview-note">This is the card the chat draws. Click a header to fold it.</div>`);
    const previewHost = $(`<div class="blk-preview"></div>`);
    right.append(previewHost);

    layout.append(left).append(right);
    c.append(layout);

    renderBlocksPreview(previewHost[0]);
}

export function renderStatFieldEditor(c, def) {
    const cfg = localProfile.statBlocks[def.id];
    const wrap = $(`<div class="blk-sub blk-sub-fields"></div>`);

    wrap.append(`<div class="blk-sub-label" style="margin-bottom:2px;">Fields</div>
        <div class="blk-sub-desc" style="margin-bottom:8px;">What the AI is asked to track${def.id === "bonds" ? " for each NPC" : ""}. Every field costs tokens on every reply.</div>`);

    const rows = $(`<div class="stat-field-list"></div>`);
    (cfg.fields || []).forEach((f, i) => {
        const row = $(`
            <div class="stat-field">
                <input type="text" class="ps-modern-input sf-label" value="${escapeHtmlAttr(f.label)}" placeholder="Name" />
                <select class="ps-modern-input sf-type">
                    ${STAT_FIELD_TYPES.map(t => `<option value="${t.v}" ${f.type === t.v ? "selected" : ""} title="${t.hint}">${t.label}</option>`).join("")}
                </select>
                <input type="number" class="ps-modern-input sf-max" value="${f.max || 100}" title="Maximum" style="display:${f.type === "meter" ? "" : "none"};" />
                <input type="number" class="ps-modern-input sf-start" value="${f.start !== undefined ? f.start : 0}" title="Starting value" style="display:${f.type === "meter" || f.type === "number" ? "" : "none"};" />
                <button class="ws-btn-small sf-up" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
                <button class="ws-btn-small sf-del" style="color:#ef4444;"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `);
        row.find(".sf-label").on("input", function () { f.label = $(this).val(); saveProfileDebounced(); });
        row.find(".sf-type").on("change", function () {
            f.type = $(this).val();
            saveProfileToMemory(); renderBlocksTab(c);
        });
        row.find(".sf-max").on("input", function () { f.max = parseInt($(this).val(), 10) || 100; saveProfileDebounced(); });
        row.find(".sf-start").on("input", function () { f.start = parseInt($(this).val(), 10) || 0; saveProfileDebounced(); });
        row.find(".sf-up").on("click", () => {
            cfg.fields.splice(i - 1, 0, cfg.fields.splice(i, 1)[0]);
            saveProfileToMemory(); renderBlocksTab(c);
        });
        row.find(".sf-del").on("click", () => {
            cfg.fields.splice(i, 1);
            saveProfileToMemory(); renderBlocksTab(c);
        });
        rows.append(row);
    });
    wrap.append(rows);

    const tools = $(`<div class="blk-pool" style="margin-top:8px;"></div>`);
    const addBtn = $(`<button class="blk-add"><i class="fa-solid fa-plus"></i> Add field</button>`);
    addBtn.on("click", () => {
        cfg.fields.push({ id: "f_" + Date.now(), label: "New field", type: "meter", max: 100, start: 0 });
        saveProfileToMemory(); renderBlocksTab(c);
    });
    tools.append(addBtn);

    (STAT_FIELD_PACKS[def.id] || []).forEach(pack => {
        const btn = $(`<button class="blk-add"><i class="fa-solid fa-box-open"></i> ${pack.label}</button>`);
        btn.on("click", () => {
            // Merge, never replace: a field already there keeps its settings.
            pack.fields.forEach(pf => {
                if (!cfg.fields.some(f => String(f.label).toLowerCase() === pf.label.toLowerCase())) {
                    cfg.fields.push({ ...pf });
                }
            });
            saveProfileToMemory(); renderBlocksTab(c);
            toastr.success(`${pack.label} fields added.`);
        });
        tools.append(btn);
    });
    wrap.append(tools);

    return wrap;
}

export function renderBlocksPreview(host) {
    if (!host) return;
    host.innerHTML = "";

    const registry = meguminRenderRegistry();
    const active = meguminActiveBlocks();
    // VCRP: a tab that only holds a reply's own note (Pura's Notes) is no block to preview alone.
    if (!active.some(b => !b.transient)) {
        host.innerHTML = notebookOn()
            ? `<div class="blk-empty">No blocks in the master block. The Author's Notebook is on (Focus tab), so its own block is still asked for, and drawn as a spoiler tab.</div>`
            : `<div class="blk-empty">No blocks in the master block, so nothing is sent and nothing is drawn.</div>`;
        return;
    }

    // Always the templates, never a reply from the open chat. This is where the
    // templates are being edited, so it has to show what is being sent — real
    // content from a past reply would hide the very thing that just changed.
    //
    // buildBaseDict is what the real envelope is assembled from, so the preview
    // inherits engine overrides, custom prompts and compact World State for free.
    let dict = {};
    try { dict = buildBaseDict(true) || {}; } catch (e) { dict = {}; }

    // VCRP: the scene list first, as the envelope has it.
    const ordered = [...active.filter(b => b.scene), ...active.filter(b => !b.scene)];
    const sample = "<Blocks>\n" + ordered.map(b => {
        // Same three sources the envelope uses, so the preview cannot drift.
        let raw;
        if (b.slot) raw = b.previewNote || "[Only appears when the story introduces a new NPC.]";
        else if (b.scene) raw = (sceneBlockRequest() || {}).template || "";
        else if (!b.builtin) raw = meguminBuildCustomTemplate(b);   // VCRP: a custom block's template (fields or text)
        else if (typeof b.build === "function") raw = b.build();
        else if (b.source) raw = dict[b.source] || "";
        else raw = b.content || "";
        const body = b.slot ? raw : normalizeBlockBody(
            String(raw).replace(/^#{1,3}\s*At the end of your response[^\n]*\n?/i, ""), b.tag);
        return body ? `<${b.tag}>\n${body}\n</${b.tag}>` : "";
    }).filter(Boolean).join("\n") + "\n</Blocks>";

    const blocks = extractBlocks(sample, registry);
    if (!blocks.length) {
        host.innerHTML = `<div class="blk-empty">Nothing to preview yet.</div>`;
        return;
    }

    // Open on arrival: the chat card rests shut, but a shut preview shows nothing.
    host.appendChild(buildBlocksCard(blocks, { preview: true, expanded: true, statFields: meguminStatFieldMap() }));
    const note = document.createElement("div");
    note.className = "blk-preview-source";
    note.textContent = "Showing the templates the AI is asked to fill in.";
    host.appendChild(note);
}

// VCRP: a custom block as Megumin Suite V11 has it (04/11): a name and a look, what it holds
// (fields or free text), what the story remembers of it, and when it is written. Custom blocks
// are one list for every character (core/profile.js), so a change here applies to all of them.
const CUSTOM_KIND_CHOICES = [
    { v: "fields", label: "Fields", hint: "Named values like Trust or Gold. Meters are drawn as bars, lists as chips." },
    { v: "text", label: "Free text", hint: "Your own template, sent as you wrote it." }
];
const CUSTOM_MEMORY_CHOICES = [
    { v: "info", label: "Carried forward", hint: "Its last copy travels with the block instructions after the chat, as every block's does, so the story writes on from it." },
    { v: "fresh", label: "Starts fresh", hint: "The story doesn't see the last one, so it writes this block new each time." },
    { v: "chat", label: "Stays in the chat", hint: "Its old copies stay in the earlier replies the story reads, while the other blocks come out of them. Costs tokens on every old reply." }
];
const CUSTOM_WHEN_CHOICES = [
    { v: "every", label: "Every reply", hint: "Written at the end of each reply." },
    { v: "changes", label: "Only when it changes", hint: "The story leaves it out when nothing in it changed. Needs a block the story can see: Carried forward or Stays in the chat." },
    { v: "everyN", label: "Every few replies", hint: "Written once every few replies; set how many below." }
];
const FIELD_DESC_EXAMPLE = {
    meter: "What it means and how it moves, e.g. How much she trusts {{user}}. Goes up when he keeps his word, down when he lies or hides things.",
    number: "What it counts and when it changes, e.g. Coins in {{user}}'s purse. Changes only when money changes hands.",
    text: "What to write here, e.g. Her mood in a few words, as the scene leaves her.",
    list: "What goes in the list, e.g. What {{user}} carries. Add or remove only when the story does."
};
const sectionHead = (label, desc) => `<div style="padding: 14px 0 6px;"><div class="set-label" style="margin-bottom:4px;">${label}</div>${desc ? `<div class="set-desc">${desc}</div>` : ""}</div>`;

// One choice of a few, as a select with the picked one's hint under it.
function choiceSelect(choices, current, onPick) {
    const wrap = $(`<div></div>`);
    const $s = $(`<select class="ps-modern-input" style="width:100%; max-width:320px;">${choices.map(o => `<option value="${o.v}" ${o.v === current ? "selected" : ""}>${o.label}</option>`).join("")}</select>`);
    const $hint = $(`<div class="set-desc" style="margin-top:4px;"></div>`);
    const hint = v => $hint.text((choices.find(o => o.v === v) || {}).hint || "");
    hint(current);
    $s.on("change", function () { hint($(this).val()); onPick($(this).val()); });
    return wrap.append($s).append($hint);
}

export function renderCustomBlockEditor(c, editId) {
    const stack = localProfile.blockStack;
    const existing = editId ? (stack.custom || []).find(b => b.id === editId) : null;
    const draft = normalizeCustomBlock(existing
        ? JSON.parse(JSON.stringify(existing))
        : { id: "blk_" + Date.now(), label: "", tag: "", emoji: "📦", visibility: "open", builtin: false, content: "" });
    if (draft.visibility !== "hidden") draft.visibility = "open";

    c.empty();
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #10b981, #047857);"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                <div>
                    <h2>${existing ? "Edit" : "New"} block</h2>
                    <p>Give it a name, choose what it holds, and how the story keeps it. Custom blocks are shared: every character can add them from Add a block, and a change here applies to all of them.</p>
                </div>
            </div>
        </div>
    `);

    const form = $(`
        <div class="mtab-panel">
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Name</div><div class="set-desc">Shown as the header in chat</div></div>
                <input type="text" id="blk_name" class="ps-modern-input" style="width:220px;" placeholder="e.g. Relationship Meter" value="${escapeHtmlAttr(draft.label || "")}" />
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Emoji</div><div class="set-desc">Sits before the header</div></div>
                <input type="text" id="blk_emoji" class="ps-modern-input" style="width:70px; text-align:center;" value="${escapeHtmlAttr(draft.emoji || "📦")}" />
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Shown as</div><div class="set-desc">Hidden blocks are still written and still kept</div></div>
                <select id="blk_vis" class="ps-modern-input" style="width:150px;">
                    ${BLOCK_VISIBILITY_CHOICES.map(o => `<option value="${o.v}" ${draft.visibility === o.v ? "selected" : ""}>${o.label}</option>`).join("")}
                </select>
            </div>
            <div style="font-size:0.68rem; color:var(--text-muted);">Tag: <code id="blk_tag_preview">&lt;${escapeHtmlAttr(draft.tag || "…")}&gt;</code></div>
            <div class="blk-ed-holds"></div>
            <div class="blk-ed-body"></div>
            <div class="blk-ed-memory"></div>
            <div class="blk-ed-when"></div>
            <div class="blk-ed-preview"></div>
        </div>
    `);
    c.append(form);

    // What the story is told for this block, as it stands in the form.
    const drawPreview = () => {
        const host = form.find(".blk-ed-preview").empty();
        const label = String($("#blk_name").val() || "").trim() || "Block";
        const tag = blockTagFromName(label) || "Block";
        let body = "";
        try { body = meguminBuildCustomTemplate({ ...draft, label, tag }); } catch (e) { body = ""; }
        host.append(sectionHead("What the story is told", "The template sent for this block, updated as you type. Square brackets are filled in by the story."));
        const $pre = $(`<pre class="ps-modern-input" style="white-space:pre-wrap; font-size:0.72rem; line-height:1.45; max-height:260px; overflow:auto; margin:0;"></pre>`);
        $pre.text(body ? `<${tag}>\n${body}\n</${tag}>` : "Add a field or write a template to see it here.");
        host.append($pre);
    };
    // Every box updates the draft in its own handler first, then this runs.
    form.on("input change", () => drawPreview());
    form.find("#blk_name").on("input", function () {
        $("#blk_tag_preview").text(`<${blockTagFromName($(this).val()) || "…"}>`);
    });

    // What it holds.
    const drawHolds = () => {
        const host = form.find(".blk-ed-holds").empty();
        host.append(sectionHead("What it holds"));
        host.append(choiceSelect(CUSTOM_KIND_CHOICES, draft.kind, v => { draft.kind = v; drawBody(); }));
    };

    // The fields, or the template.
    const drawBody = () => {
        const host = form.find(".blk-ed-body").empty();
        if (draft.kind === "text") {
            host.append(sectionHead("Template", "What the story is told to write. Square brackets read as fill-me-in."));
            const $ta = $(`<textarea class="ps-modern-input" rows="8" style="width:100%; resize:vertical;" placeholder="e.g.&#10;Goal: [what the party wants now]&#10;Next step: [what they do about it]"></textarea>`);
            $ta.val(draft.content || "");
            $ta.on("input", function () { draft.content = $(this).val(); });
            host.append($ta);
            drawPreview();
            return;
        }
        // Rules for the whole block, in the user's words (sent before the fields' own notes).
        host.append(sectionHead("Rules for this block", "How the story should write this block as a whole. Each line is sent as you wrote it. Meters are not held to 10 points a reply here: write your own limit if you want one."));
        const $rules = $(`<textarea class="ps-modern-input blk-rules" rows="3" style="width:100%; resize:vertical; font-size:0.75rem;" placeholder="e.g.&#10;Track only the party, never strangers.&#10;Numbers change slowly: a single scene rarely moves one by more than 5."></textarea>`);
        $rules.val(draft.rules || "");
        $rules.on("input", function () { draft.rules = $(this).val(); });
        host.append($rules);
        host.append(sectionHead("Fields", "What the story keeps in this block. Say what each field means and how it changes: the story reads it. Every field costs tokens on every reply."));
        const rows = $(`<div class="stat-field-list"></div>`);
        draft.fields.forEach((f, i) => {
            const item = $(`<div class="blk-field-item" style="margin-bottom:10px;"></div>`);
            const row = $(`
                <div class="stat-field">
                    <input type="text" class="ps-modern-input sf-label" value="${escapeHtmlAttr(f.label || "")}" placeholder="Name" />
                    <select class="ps-modern-input sf-type">
                        ${STAT_FIELD_TYPES.map(t => `<option value="${t.v}" ${f.type === t.v ? "selected" : ""} title="${t.hint}">${t.label}</option>`).join("")}
                    </select>
                    <input type="number" class="ps-modern-input sf-max" value="${f.max || 100}" title="Maximum" style="display:${f.type === "meter" ? "" : "none"};" />
                    <input type="number" class="ps-modern-input sf-start" value="${f.start !== undefined ? f.start : 0}" title="Starting value" style="display:${f.type === "meter" || f.type === "number" ? "" : "none"};" />
                    <button class="ws-btn-small sf-up" title="Move up" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="ws-btn-small sf-del" title="Remove this field" style="color:#ef4444;"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `);
            row.find(".sf-label").on("input", function () { f.label = $(this).val(); });
            row.find(".sf-type").on("change", function () { f.type = $(this).val(); f.ownLine = f.type === "list"; drawBody(); });
            row.find(".sf-max").on("input", function () { f.max = parseInt($(this).val(), 10) || 100; });
            row.find(".sf-start").on("input", function () { f.start = parseInt($(this).val(), 10) || 0; });
            row.find(".sf-up").on("click", () => { draft.fields.splice(i - 1, 0, draft.fields.splice(i, 1)[0]); drawBody(); });
            row.find(".sf-del").on("click", () => { draft.fields.splice(i, 1); drawBody(); });
            // What the field means and how it changes, in the user's words.
            const $desc = $(`<textarea class="ps-modern-input sf-desc" rows="2" style="width:100%; resize:vertical; margin-top:4px; font-size:0.75rem;" placeholder="${escapeHtmlAttr(FIELD_DESC_EXAMPLE[f.type] || FIELD_DESC_EXAMPLE.text)}"></textarea>`);
            $desc.val(f.desc || "");
            $desc.on("input", function () { f.desc = $(this).val(); });
            item.append(row).append($desc);
            rows.append(item);
        });
        if (!draft.fields.length) rows.append(`<div class="blk-empty">No fields yet.</div>`);
        host.append(rows);
        const add = $(`<button class="blk-add" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> Add field</button>`);
        add.on("click", () => {
            draft.fields.push({ id: "f_" + Date.now(), label: "New field", type: "meter", max: 100, start: 0, desc: "" });
            drawBody();
        });
        host.append(add);
        drawPreview();
    };

    // What the story remembers of it.
    const drawMemory = () => {
        const host = form.find(".blk-ed-memory").empty();
        host.append(sectionHead("What the story remembers of it"));
        host.append(choiceSelect(CUSTOM_MEMORY_CHOICES, draft.memory, v => {
            draft.memory = v;
            if (v === "fresh" && draft.when === "changes") draft.when = "every";
            drawWhen();
        }));
        drawPreview();
    };

    // When it is written.
    const drawWhen = () => {
        const host = form.find(".blk-ed-when").empty();
        host.append(sectionHead("When the story writes it"));
        // "Only when it changes" needs a block the story can see.
        const choices = CUSTOM_WHEN_CHOICES.filter(o => o.v !== "changes" || draft.memory !== "fresh");
        host.append(choiceSelect(choices, draft.when, v => { draft.when = v; drawWhen(); }));
        if (draft.when === "everyN") {
            const $n = $(`<div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">How many replies</div><div class="set-desc">From 2 to 20</div></div>
                <input type="number" min="2" max="20" class="ps-modern-input" style="width:80px;" value="${draft.everyN}" />
            </div>`);
            $n.find("input").on("input", function () { draft.everyN = normalizeCustomBlock({ when: "everyN", everyN: $(this).val() }).everyN; });
            host.append($n);
        }
        drawPreview();
    };

    drawHolds(); drawBody(); drawMemory(); drawWhen();

    const actions = $(`
        <div style="display:flex; gap:10px; margin-top:16px;">
            <button class="ws-btn-small" id="blk_save" style="color:#10b981; border-color:rgba(16,185,129,0.4);"><i class="fa-solid fa-check"></i> Save</button>
            <button class="ws-btn-small" id="blk_cancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
            ${existing ? `<button class="ws-btn-small" id="blk_delete" style="margin-left:auto; color:#ef4444; border-color:rgba(239,68,68,0.35);" title="Delete this block for every character"><i class="fa-solid fa-trash"></i> Delete block</button>` : ""}
        </div>
    `);
    actions.find("#blk_cancel").on("click", () => renderBlocksTab(c));
    // Custom blocks are shared by every character, so this is for all of them.
    actions.find("#blk_delete").on("click", async () => {
        const name = escapeHtmlAttr(existing.label || existing.tag);
        const $msg = $(`<div><p>Delete "<b>${name}</b>" for every character?</p><p class="set-desc">It is taken out of every character's blocks. What your chats already kept of it stays in them, but nothing shows or sends it any more.</p></div>`);
        const ok = await new Popup($msg, POPUP_TYPE.CONFIRM, "Delete block", { okButton: "Delete", cancelButton: "Keep" }).show();
        if (!ok) return;
        deleteCustomBlockEverywhere(existing.id);
        meguminScheduleBlocksRefresh();
        toastr.success(`"${existing.label || existing.tag}" deleted.`);
        renderBlocksTab(c);
    });
    actions.find("#blk_save").on("click", () => {
        const label = String($("#blk_name").val() || "").trim();
        const tag = blockTagFromName(label);
        const problem = validateCustomBlock(label, tag, draft.id);
        if (problem) { toastr.warning(problem); return; }
        if (draft.kind === "fields" && !draft.fields.some(f => String(f.label || "").trim())) {
            toastr.warning("Add at least one field, or pick Free text.");
            return;
        }

        // A renamed block keeps reading its old copies under the old tag.
        const tags = [...(draft.tags || [])];
        if (existing && existing.tag && existing.tag !== tag && !tags.includes(existing.tag)) tags.push(existing.tag);

        const entry = normalizeCustomBlock({
            ...draft,
            label, tag,
            tags: tags.filter(t => t !== tag),
            emoji: String($("#blk_emoji").val() || "📦").trim() || "📦",
            icon: "fa-cube", color: "#38bdf8",
            visibility: $("#blk_vis").val(),
            builtin: false,
            content: String(draft.content || "").trim(),
            rules: String(draft.rules || "").trim(),
            fields: draft.fields.filter(f => String(f.label || "").trim()).map(f => ({ ...f, label: String(f.label).trim() })),
            // Custom blocks carry their own body rather than reading a dict tag.
            source: null
        });

        if (!stack.custom) stack.custom = [];
        const at = stack.custom.findIndex(b => b.id === entry.id);
        if (at > -1) stack.custom[at] = entry; else stack.custom.push(entry);
        if (!stack.order.includes(entry.id)) stack.order.push(entry.id);

        meguminSyncLegacyBlockIds();
        saveProfileToMemory();
        toastr.success(`"${label}" saved.`);
        renderBlocksTab(c);
    });
    c.append(actions);
}
