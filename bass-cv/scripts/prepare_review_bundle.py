#!/usr/bin/env python3
"""Create a source-only, two-reviewer independent annotation bundle."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--selection", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--purpose", default="blinded independent human annotation")
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    selection = json.loads((root / args.selection).read_text(encoding="utf-8"))
    source_dir = output / "source-frames"
    source_dir.mkdir(parents=True, exist_ok=True)
    manifest, reviewer_rows = [], []
    for index, row in enumerate(selection):
        source = root / row["file"]
        name = f"{index + 1:03d}_{Path(row['file']).name}"
        destination = source_dir / name
        shutil.copy2(source, destination)
        image = cv2.imread(str(destination))
        if image is None:
            raise ValueError(f"Unreadable image {source}")
        height, width = image.shape[:2]
        record = {
            "anonymous_id": name, "test_id": row["test_id"],
            "frame_index": int(row["frame_index"]), "time_s": float(row["time_s"]),
            "source_sha256": sha256(destination), "width": width, "height": height,
        }
        manifest.append(record)
        reviewer_rows.append(f"{name},{row['test_id']},{row['frame_index']},,,,,")
        for reviewer in ("reviewer-A", "reviewer-B"):
            reviewer_dir = output / reviewer
            reviewer_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, reviewer_dir / name)
            labelme = {
                "version": "5.3.1", "flags": {"uncertain_boundary": False, "no_visible_flame": False},
                "shapes": [], "imagePath": name, "imageData": None,
                "imageHeight": height, "imageWidth": width,
            }
            (reviewer_dir / f"{Path(name).stem}.json").write_text(
                json.dumps(labelme, indent=2), encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({
        "schema": "falmex-independent-review-bundle-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(), "purpose": args.purpose,
        "status": "awaiting_independent_human_annotations",
        "source_frames": len(manifest), "frames": manifest,
        "blinding": "Contains no model predictions, AI masks, performance metrics, or model rankings.",
        "target": "visibly luminous flame regions only",
        "not_target": "chemical flame boundary, temperature, reaction zone, extinction time, or operational safety label",
    }, indent=2), encoding="utf-8")
    (output / "adjudication.csv").write_text(
        "anonymous_id,test_id,frame_index,reviewer_A_complete,reviewer_B_complete,disagreement,adjudicator_decision,notes\n" +
        "\n".join(reviewer_rows) + "\n", encoding="utf-8")
    (output / "README.md").write_text("""# Independent human annotation — source-only bundle

## Status

This bundle is **awaiting actual independent human reviewers**. AI-generated masks and model outputs are deliberately absent. Completion of this package by the AI assistant must never be recorded as independent-expert validation.

## Reviewer protocol

1. Assign reviewer A and reviewer B independently. Neither reviewer should see the other person's masks, the AI masks, model predictions, model names, or scores.
2. Annotate every image in your assigned `reviewer-A/` or `reviewer-B/` folder with LabelMe or compatible polygon software.
3. Target: **visibly luminous flame regions** in the supplied image. Use one or more polygons per image.
4. Exclude telemetry, ignition hardware, isolated sparks, dark gaps, and background reflections where distinguishable.
5. If there is no visible luminous flame, leave `shapes` empty and set `flags.no_visible_flame` to `true`.
6. If the visible boundary is uncertain, annotate your best visible estimate and set `flags.uncertain_boundary` to `true`. Do not infer a chemical or thermal boundary.
7. Do not adjust display enhancement identically for every decision; inspect the original and, if needed, brightness-enhanced views. Record any frame that remains ambiguous.
8. Convert the completed LabelMe JSON files to binary masks with `python scripts/labelme_to_masks.py --reviewer <completed-reviewer-folder> --output <mask-directory>`. The converter requires an explicit `no_visible_flame` flag for empty frames and records uncertainty flags.
9. A third qualified adjudicator should resolve disagreements while remaining blinded to model identity and scores.

## Agreement analysis

From the project root:

```bash
python scripts/compare_annotations.py \
  --selection <selection.json> \
  --a <reviewer-A-mask-directory> \
  --b <reviewer-B-mask-directory> \
  --output <agreement-output-directory>
```

The comparison reports IoU, Dice, two-pixel boundary F1, visibility disagreements, and disagreement overlays. These measure agreement, not correctness or operational readiness.
""", encoding="utf-8")
    # Source-only contact sheets with anonymous identifiers.
    tiles = []
    for record in manifest:
        image = cv2.imread(str(source_dir / record["anonymous_id"]))
        image = cv2.resize(image, (360, 240))
        cv2.putText(image, record["anonymous_id"], (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (0, 0, 0), 3)
        cv2.putText(image, record["anonymous_id"], (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (255, 255, 255), 1)
        tiles.append(image)
    rows = []
    for start in range(0, len(tiles), 4):
        row = tiles[start:start + 4]
        while len(row) < 4:
            row.append(np.zeros_like(tiles[0]))
        rows.append(np.concatenate(row, axis=1))
    if rows:
        cv2.imwrite(str(output / "source-contact.png"), np.concatenate(rows, axis=0))
    print(json.dumps({"output": str(output), "frames": len(manifest),
                      "status": "awaiting_independent_human_annotations"}, indent=2))


if __name__ == "__main__":
    main()
