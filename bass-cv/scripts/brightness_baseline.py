#!/usr/bin/env python3
"""Brightness-threshold baseline on the 24 confirmation frames, scored against reviewers A and B.

The threshold is chosen leave-one-video-out (tuned on two of B14/B17/B18, applied to the third),
so no frame is scored with a threshold fitted on itself. Per-frame Otsu is reported as a
parameter-free reference. Frozen v3-v6 predictions are scored the same way for comparison.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "confirmation-v6/source-frames"
REVIEW = ROOT / "independent-review-results-v6"
PRED = ROOT / "confirmation-v6/frozen-predictions"
THRESHOLDS = list(range(40, 256, 5))
VIDEOS = ("B14", "B17", "B18")


def load():
    frames = []
    for path in sorted(FRAMES.glob("*.png")):
        name = path.name
        masked = next(p for p in (REVIEW / "masks-A").glob(f"*_{name}"))
        image = cv2.imread(str(path))
        frames.append({
            "name": name, "video": name[:3],
            "brightness": image.max(axis=2),  # brightest channel, catches blue/orange flame
            "A": cv2.imread(str(masked), 0) > 0,
            "B": cv2.imread(str(REVIEW / "masks-B" / masked.name), 0) > 0,
        })
    return frames


def counts(pred, ref):
    return (int(np.count_nonzero(pred & ref)), int(np.count_nonzero(pred & ~ref)),
            int(np.count_nonzero(~pred & ref)))


def micro_iou(items):
    tp = sum(i[0] for i in items)
    union = sum(sum(i) for i in items)
    return tp / union if union else None


def otsu(gray):
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return mask > 0


def main():
    frames = load()
    out = {"reference": {}, "notes": [
        "Leave-one-video-out threshold: tuned on two videos, scored on the third.",
        "Agreement with a reviewer is not correctness; A and B disagree substantially.",
    ]}
    for ref in ("A", "B"):
        result = {}
        # Leave-one-video-out brightness threshold
        loo, chosen = [], {}
        for held in VIDEOS:
            train = [f for f in frames if f["video"] != held]
            best = max(THRESHOLDS, key=lambda t: micro_iou(
                [counts(f["brightness"] >= t, f[ref]) for f in train]) or 0)
            chosen[held] = best
            loo += [counts(f["brightness"] >= best, f[ref]) for f in frames if f["video"] == held]
        result["brightness_LOVO"] = {"micro_iou": micro_iou(loo), "thresholds": chosen}
        result["otsu_per_frame"] = {"micro_iou": micro_iou(
            [counts(otsu(f["brightness"]), f[ref]) for f in frames])}
        # Optimistic upper bound: single threshold fitted on all 24 frames (leaks test labels)
        best_all = max(THRESHOLDS, key=lambda t: micro_iou(
            [counts(f["brightness"] >= t, f[ref]) for f in frames]) or 0)
        result["brightness_fit_on_test_UPPER_BOUND"] = {
            "micro_iou": micro_iou([counts(f["brightness"] >= best_all, f[ref]) for f in frames]),
            "threshold": best_all}
        for model in ("v3", "v4", "v5", "v6"):
            items = []
            for f in frames:
                pred = cv2.imread(str(PRED / model / f["video"] / f["name"]), 0)
                items.append(counts(pred > 0, f[ref]))
            result[f"model_{model}"] = {"micro_iou": micro_iou(items)}
        out["reference"][ref] = result
    other = [counts(f["A"], f["B"]) for f in frames]
    out["human_A_vs_B_micro_iou"] = micro_iou(other)
    print(json.dumps(out, indent=2))
    (REVIEW / "brightness-baseline.json").write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
