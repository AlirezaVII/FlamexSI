#!/usr/bin/env python3
"""Compare two human annotation sets without treating either as gold truth."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def boundary(mask):
    kernel = np.ones((3, 3), np.uint8)
    return ((mask > 0).astype(np.uint8) - cv2.erode((mask > 0).astype(np.uint8), kernel)) > 0


def boundary_agreement(a, b, tolerance=2.0):
    a_edge, b_edge = boundary(a), boundary(b)
    if not a_edge.any() and not b_edge.any():
        return {"boundary_precision": None, "boundary_recall": None, "boundary_f1": None}
    if not a_edge.any() or not b_edge.any():
        return {"boundary_precision": 0.0, "boundary_recall": 0.0, "boundary_f1": 0.0}
    distance_to_b = cv2.distanceTransform((~b_edge).astype(np.uint8), cv2.DIST_L2, 3)
    distance_to_a = cv2.distanceTransform((~a_edge).astype(np.uint8), cv2.DIST_L2, 3)
    precision = float(np.mean(distance_to_b[a_edge] <= tolerance))
    recall = float(np.mean(distance_to_a[b_edge] <= tolerance))
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"boundary_precision": precision, "boundary_recall": recall, "boundary_f1": float(f1)}


def centroid(mask):
    ys, xs = np.nonzero(mask)
    return np.array([xs.mean(), ys.mean()]) if len(xs) else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--selection", required=True)
    parser.add_argument("--a", type=Path, required=True, help="Reviewer A mask directory")
    parser.add_argument("--b", type=Path, required=True, help="Reviewer B mask directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=2.0)
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    selection = json.loads((root / args.selection).read_text(encoding="utf-8"))
    overlays = output / "disagreement-overlays"
    overlays.mkdir(parents=True, exist_ok=True)
    rows, input_hashes = [], {}
    for index, item in enumerate(selection):
        original_name = Path(item["file"]).name
        candidates = [original_name, f"{index + 1:03d}_{original_name}"]
        path_a = next((args.a / name for name in candidates if (args.a / name).exists()), None)
        path_b = next((args.b / name for name in candidates if (args.b / name).exists()), None)
        if path_a is None or path_b is None:
            raise FileNotFoundError(f"Missing reviewer mask for {original_name}")
        image = cv2.imread(str(root / item["file"]))
        a = (cv2.imread(str(path_a), 0) > 0)
        b = (cv2.imread(str(path_b), 0) > 0)
        if image is None or a.shape != image.shape[:2] or b.shape != image.shape[:2]:
            raise ValueError(f"Image/mask shape mismatch for {original_name}")
        tp = int(np.count_nonzero(a & b))
        fp = int(np.count_nonzero(~a & b))
        fn = int(np.count_nonzero(a & ~b))
        union = tp + fp + fn
        ca, cb = centroid(a), centroid(b)
        row = {
            "frame": original_name, "test_id": item["test_id"], "frame_index": int(item["frame_index"]),
            "area_a_px": int(a.sum()), "area_b_px": int(b.sum()),
            "visible_a": bool(a.any()), "visible_b": bool(b.any()),
            "visibility_agreement": bool(a.any() == b.any()),
            "intersection_px": tp, "a_only_px": fn, "b_only_px": fp,
            "iou": float(tp / union) if union else None,
            "dice": float(2 * tp / (2 * tp + fp + fn)) if 2 * tp + fp + fn else None,
            "centroid_distance_px": float(np.linalg.norm(ca - cb)) if ca is not None and cb is not None else None,
            **boundary_agreement(a, b, args.tolerance),
            "mask_a_sha256": sha256(path_a), "mask_b_sha256": sha256(path_b),
        }
        rows.append(row)
        input_hashes[f"A/{original_name}"] = row["mask_a_sha256"]
        input_hashes[f"B/{original_name}"] = row["mask_b_sha256"]
        marked = image.copy()
        marked[a & b] = (0, 220, 0)
        marked[a & ~b] = (255, 0, 0)
        marked[~a & b] = (0, 0, 255)
        overlay = cv2.addWeighted(image, 0.45, marked, 0.55, 0)
        cv2.imwrite(str(overlays / original_name), overlay)
    comparable = [row for row in rows if row["iou"] is not None]
    f1_values = [row["boundary_f1"] for row in comparable if row["boundary_f1"] is not None]
    tp = sum(row["intersection_px"] for row in rows)
    a_only = sum(row["a_only_px"] for row in rows)
    b_only = sum(row["b_only_px"] for row in rows)
    summary = {
        "schema": "falmex-inter-annotator-agreement-v1",
        "status": "agreement between two supplied annotation sets; neither is assumed gold truth",
        "frames": len(rows), "visibility_disagreements": sum(not row["visibility_agreement"] for row in rows),
        "both_empty_frames": sum(row["iou"] is None for row in rows),
        "positive_union_frames": len(comparable),
        "macro_iou_positive_union": float(np.mean([row["iou"] for row in comparable])) if comparable else None,
        "macro_dice_positive_union": float(np.mean([row["dice"] for row in comparable])) if comparable else None,
        "micro_iou": float(tp / (tp + a_only + b_only)) if tp + a_only + b_only else None,
        "micro_dice": float(2 * tp / (2 * tp + a_only + b_only)) if 2 * tp + a_only + b_only else None,
        "macro_boundary_f1_positive_union": float(np.mean(f1_values)) if f1_values else None,
        "boundary_tolerance_px": args.tolerance,
        "input_sha256": input_hashes,
        "interpretation_limit": "Inter-annotator agreement does not itself establish expert correctness or operational readiness.",
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "agreement-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (output / "agreement-per-frame.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
