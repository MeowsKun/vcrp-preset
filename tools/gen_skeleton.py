"""Regenerates data/skeleton.js from the standard preset.

Dev Mode's Document view draws data/skeleton.js top to bottom, so it must match the preset's
real slot order and content. Run from the repo root after editing the preset:

    python tools/gen_skeleton.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRESET = "VCRP V10 Universal.json"
OUT = ROOT / "data" / "skeleton.js"

HEADER = """// ─────────────────────────────────────────────────────────────────────────────
// SKELETON — the real shape of the outgoing prompt.
//
// GENERATED FILE. Do not edit by hand; run:
//
//     python tools/gen_skeleton.py
//
// Dev Mode's Document view draws this top to bottom, so the reader sees where a
// [[slot]] actually lands rather than an invented running order. That matters
// more than it sounds: [[THINK]] and [[blocks]] live in "Output RULES", which is
// sent AFTER the chat history, while the old editor drew them in a flat pile
// that implied they sat near the top.
//
// Cards with marker:true are SillyTavern's own (chat history, world info,
// character description). We neither own nor fill those, so the editor renders
// them greyed out as fixed landmarks.
//
// Source: {source}
// ─────────────────────────────────────────────────────────────────────────────

export const SKELETON_SOURCE = "{source}";

export const SKELETON = [
"""

FOOTER = """];

/** Every [[trigger]] the skeleton actually contains, in the order it hits them. */
export function skeletonTriggersInOrder() {
    const seen = new Set();
    const out = [];
    SKELETON.forEach(card => {
        const matches = card.content.match(/\\[\\[[^\\]]+\\]\\]/g) || [];
        matches.forEach(t => {
            if (seen.has(t)) return;
            seen.add(t);
            out.push(t);
        });
    });
    return out;
}
"""


def main():
    data = json.loads((ROOT / "Presets" / PRESET).read_text(encoding="utf-8"))
    prompts = {p["identifier"]: p for p in data["prompts"]}
    order = next(o for o in data["prompt_order"] if o["character_id"] == 100001)["order"]
    rows = []
    for entry in order:
        p = prompts.get(entry["identifier"])
        if not p:
            continue
        card = {
            "id": p["identifier"],
            "name": p.get("name", p["identifier"]),
            "role": p.get("role") or "system",
            "marker": bool(p.get("marker")),
            "enabled": bool(entry.get("enabled")),
            "content": p.get("content") or "",
            # In-chat slots (Output RULES) sit this many messages from the end of the chat.
            "depth": int(p.get("injection_depth") or 0) if p.get("injection_position") == 1 else None,
        }
        rows.append("    " + json.dumps(card, ensure_ascii=False) + ",")
    text = HEADER.replace("{source}", PRESET) + "\n".join(rows) + "\n" + FOOTER
    with open(OUT, "w", encoding="utf-8", newline="\r\n") as f:  # CRLF, like the rest of the repo
        f.write(text)
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(rows)} cards)")


if __name__ == "__main__":
    main()
