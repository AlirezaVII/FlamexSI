#!/usr/bin/env python3
"""Validate two completed reviewer folders and create an adjudication bundle.

This script measures agreement between supplied annotation sets. It cannot verify
reviewer identity, expertise, independence, or operational readiness.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import math
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_reviewer(directory: Path, fallback_directory: Path, frames: list[dict], reviewer: str) -> dict:
    expected = {row["anonymous_id"] for row in frames}
    json_names = {f"{name[:-4]}.json" for name in expected}
    actual = {path.name for path in directory.glob("*.json")}
    missing = sorted(json_names - actual)
    unexpected = sorted(actual - json_names)
    if missing or unexpected:
        raise ValueError(f"{reviewer}: missing={missing}; unexpected={unexpected}")

    records = {}
    for frame in frames:
        image_name = frame["anonymous_id"]
        json_name = f"{image_name[:-4]}.json"
        image_path = directory / image_name
        json_path = directory / json_name
        if not image_path.is_file():
            # Reviewers may return only completed JSON files; use the frozen source copy.
            image_path = fallback_directory / image_name
        if not image_path.is_file():
            raise FileNotFoundError(f"{reviewer}: missing frozen source image {image_name}")
        if sha256(image_path) != frame["source_sha256"]:
            raise ValueError(f"{reviewer}: source hash mismatch for {image_name}")
        source = cv2.imread(str(image_path))
        if source is None or source.shape[:2] != (frame["height"], frame["width"]):
            raise ValueError(f"{reviewer}: unreadable source or dimension mismatch for {image_name}")

        data = json.loads(json_path.read_text(encoding="utf-8"))
        if Path(data.get("imagePath", "")).name != image_name:
            raise ValueError(f"{reviewer}/{json_name}: imagePath does not match template")
        if (int(data["imageWidth"]), int(data["imageHeight"])) != (frame["width"], frame["height"]):
            raise ValueError(f"{reviewer}/{json_name}: image dimensions differ from manifest")
        if data.get("imageData"):
            try:
                embedded = cv2.imdecode(
                    np.frombuffer(base64.b64decode(data["imageData"], validate=True), np.uint8),
                    cv2.IMREAD_COLOR,
                )
            except Exception as error:
                raise ValueError(f"{reviewer}/{json_name}: invalid embedded imageData") from error
            if embedded is None or not np.array_equal(embedded, source):
                raise ValueError(f"{reviewer}/{json_name}: embedded image differs from frozen source")

        flags = data.get("flags", {})
        for key in ("no_visible_flame", "uncertain_boundary"):
            if not isinstance(flags.get(key, False), bool):
                raise ValueError(f"{reviewer}/{json_name}: {key} must be boolean")
        shapes = data.get("shapes", [])
        if not isinstance(shapes, list):
            raise ValueError(f"{reviewer}/{json_name}: shapes must be a list")
        if not shapes and not flags.get("no_visible_flame", False):
            raise ValueError(f"{reviewer}/{json_name}: incomplete blank template")
        if shapes and flags.get("no_visible_flame", False):
            raise ValueError(f"{reviewer}/{json_name}: polygons conflict with no_visible_flame")
        for shape in shapes:
            if shape.get("shape_type", "polygon") != "polygon":
                raise ValueError(f"{reviewer}/{json_name}: only polygons are supported")
            # The originally distributed protocol defined every polygon as the flame target
            # but did not mandate a spelling; preserve compatible nonempty reviewer labels.
            if not str(shape.get("label", "")).strip():
                raise ValueError(f"{reviewer}/{json_name}: polygon label must be nonempty")
            points = np.asarray(shape.get("points", []), dtype=np.float64)
            if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] != 2:
                raise ValueError(f"{reviewer}/{json_name}: polygon needs at least three 2D points")
            if not np.isfinite(points).all():
                raise ValueError(f"{reviewer}/{json_name}: non-finite polygon coordinate")
            if (
                (points[:, 0] < 0).any() or (points[:, 0] > frame["width"]).any()
                or (points[:, 1] < 0).any() or (points[:, 1] > frame["height"]).any()
            ):
                raise ValueError(f"{reviewer}/{json_name}: polygon coordinate outside image")
            if len(np.unique(points, axis=0)) < 3 or cv2.contourArea(points.astype(np.float32)) <= 0:
                raise ValueError(f"{reviewer}/{json_name}: degenerate zero-area polygon")
        records[image_name] = {
            "json_sha256": sha256(json_path),
            "source_sha256": sha256(image_path),
            "polygons": len(shapes),
            "labels": sorted({str(shape.get("label", "")).strip() for shape in shapes}),
            "no_visible_flame": flags.get("no_visible_flame", False),
            "uncertain_boundary": flags.get("uncertain_boundary", False),
        }
    return records


def convert(directory: Path, output: Path):
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/labelme_to_masks.py"), "--reviewer", str(directory), "--output", str(output)],
        cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def write_adjudicator_readme(output: Path, queued: int):
    text = f"""# Third-adjudicator bundle — v6

Status: **{queued} frames require adjudication**. No model predictions, model names,
scores, or rankings are included here.

1. Review every JSON/PNG pair in `adjudication-templates/`.
2. Target only visibly luminous flame regions; do not infer chemical or thermal boundaries.
3. Use one or more polygons labelled `flame` for visible flame.
4. For a negative frame, leave `shapes` empty and set `flags.no_visible_flame` to `true`.
5. Set `flags.uncertain_boundary` when the visible boundary remains ambiguous.
6. The disagreement overlays compare reviewer A (blue) and reviewer B (red); green is
   their overlap. They contain no model output. The source image remains authoritative.
7. Do not change any original reviewer submission or the frozen v6 predictions.

The completed adjudicator folder should be returned unchanged in structure. Consensus
frames outside this queue must not be edited. Human review does not by itself establish
expert correctness or operational readiness.
"""
    (output / "adjudication-README.md").write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--reviewer-a", type=Path, required=True)
    parser.add_argument("--reviewer-b", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=2.0)
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory must be empty; refusing to overwrite review results")
    output.mkdir(parents=True, exist_ok=True)

    manifest_path = root / "independent-review-v6/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    frames = manifest["frames"]
    if len(frames) != 24:
        raise ValueError("Expected exactly 24 frozen review frames")
    records_a = validate_reviewer(
        args.reviewer_a, root / "independent-review-v6/reviewer-A", frames, "reviewer-A"
    )
    records_b = validate_reviewer(
        args.reviewer_b, root / "independent-review-v6/reviewer-B", frames, "reviewer-B"
    )
    convert(args.reviewer_a, output / "masks-A")
    convert(args.reviewer_b, output / "masks-B")

    subprocess.run(
        [
            sys.executable, str(root / "scripts/compare_annotations.py"),
            "--root", str(root), "--selection", "confirmation-v6/selection.json",
            "--a", str(output / "masks-A"), "--b", str(output / "masks-B"),
            "--output", str(output / "agreement"), "--tolerance", str(args.tolerance),
        ],
        cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    agreement = json.loads((output / "agreement/agreement-per-frame.json").read_text(encoding="utf-8"))
    by_original = {row["anonymous_id"]: row for row in frames}
    queue = []
    templates = output / "adjudication-templates"
    templates.mkdir()
    for index, row in enumerate(agreement, 1):
        anonymous = f"{index:03d}_{row['frame']}"
        source = by_original[anonymous]
        flags_a, flags_b = records_a[anonymous], records_b[anonymous]
        masks_differ = row["area_a_px"] != row["area_b_px"] or (
            row["iou"] is not None and row["iou"] < 1.0
        )
        uncertain = flags_a["uncertain_boundary"] or flags_b["uncertain_boundary"]
        needs = not row["visibility_agreement"] or masks_differ or uncertain
        if not needs:
            continue
        reasons = []
        if not row["visibility_agreement"]:
            reasons.append("visibility_disagreement")
        if masks_differ:
            reasons.append("mask_difference")
        if uncertain:
            reasons.append("uncertain_boundary")
        queue.append({
            "anonymous_id": anonymous, "test_id": row["test_id"], "frame_index": row["frame_index"],
            "area_A_px": row["area_a_px"], "area_B_px": row["area_b_px"],
            "iou": row["iou"], "dice": row["dice"], "boundary_f1": row["boundary_f1"],
            "uncertain_A": flags_a["uncertain_boundary"], "uncertain_B": flags_b["uncertain_boundary"],
            "reason": ";".join(reasons), "disagreement_overlay": f"agreement/disagreement-overlays/{row['frame']}",
            "adjudicator_complete": "", "notes": "",
        })
        shutil.copy2(root / "independent-review-v6/reviewer-A" / anonymous, templates / anonymous)
        template = {
            "version": "5.3.1",
            "flags": {"uncertain_boundary": False, "no_visible_flame": False},
            "shapes": [], "imagePath": anonymous, "imageData": None,
            "imageHeight": source["height"], "imageWidth": source["width"],
        }
        (templates / f"{anonymous[:-4]}.json").write_text(json.dumps(template, indent=2), encoding="utf-8")

    fields = list(queue[0]) if queue else [
        "anonymous_id", "test_id", "frame_index", "area_A_px", "area_B_px", "iou", "dice",
        "boundary_f1", "uncertain_A", "uncertain_B", "reason", "disagreement_overlay",
        "adjudicator_complete", "notes",
    ]
    with (output / "adjudication-queue.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(queue)
    write_adjudicator_readme(output, len(queue))

    processing = {
        "schema": "falmex-independent-review-processing-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "awaiting_third_adjudication" if queue else "awaiting_consensus_freeze",
        "frames": len(frames), "adjudication_frames": len(queue),
        "reviewer_identity_expertise_and_independence_not_technically_verified": True,
        "agreement_is_not_correctness": True,
        "operational_readiness": False,
        "manifest_sha256": sha256(manifest_path),
        "processing_script_sha256": sha256(Path(__file__).resolve()),
        "reviewer_A_inputs": records_a, "reviewer_B_inputs": records_b,
        "original_frozen_predictions_unchanged": True,
    }
    (output / "review-processing.json").write_text(json.dumps(processing, indent=2), encoding="utf-8")
    print(json.dumps({key: processing[key] for key in ("status", "frames", "adjudication_frames")}, indent=2))


if __name__ == "__main__":
    main()
