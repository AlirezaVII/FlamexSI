#!/usr/bin/env python3
"""Falmex BASS-II luminous-flame color baseline.

Leave-one-test-out evaluation over B1/B2/B3. All threshold selection uses
training tests only. The held-out test is never used to select parameters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from collections import defaultdict
from datetime import datetime, timezone
from itertools import product
from pathlib import Path

import cv2
import numpy as np

SCHEMA = "falmex-bass-color-baseline-v1"
COLOR_THRESHOLDS = (15.0, 30.0, 45.0, 60.0, 80.0)
BRIGHTNESS_THRESHOLDS = (20.0, 40.0, 60.0, 80.0)
MIN_COMPONENT_AREAS = (20, 50, 100)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_inputs(root: Path):
    selection = json.loads((root / "frames/selection.json").read_text())
    frames = []
    for row in selection:
        image_path = root / row["file"]
        mask_path = root / row["mask"]
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        gt = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if image is None or gt is None:
            raise FileNotFoundError(f"Unreadable input: {image_path} or {mask_path}")
        if image.shape[:2] != gt.shape:
            raise ValueError(f"Image/mask shape mismatch for {row['file']}")
        expected_positive = bool(row["flame_visible"])
        if expected_positive != bool(np.any(gt > 0)):
            raise ValueError(f"Visibility/mask mismatch for {row['file']}")
        # OpenCV is BGR. Red excess responds to red, magenta and yellow flame
        # pixels while rejecting neutral gray/white telemetry and background.
        b, g, r = [channel.astype(np.float32) for channel in cv2.split(image)]
        red_excess = r - 0.5 * (g + b)
        frames.append({
            **row,
            "name": Path(row["file"]).name,
            "image": image,
            "gt": (gt > 0).astype(np.uint8),
            "r": r,
            "red_excess": red_excess,
        })
    if sorted({f["test_id"] for f in frames}) != ["B1", "B2", "B3"]:
        raise ValueError("This proof-of-method evaluation expects exactly B1, B2 and B3")
    return selection, frames


def predict(frame, color_threshold, brightness_threshold, min_component_area):
    raw = ((frame["red_excess"] >= color_threshold) &
           (frame["r"] >= brightness_threshold)).astype(np.uint8)
    # Fixed morphology is part of the baseline, not tuned on any test labels.
    raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, connectivity=8)
    output = np.zeros_like(raw)
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= min_component_area:
            output[labels == label] = 1
    return output


def counts(pred, gt):
    pred_bool = pred.astype(bool)
    gt_bool = gt.astype(bool)
    return {
        "tp": int(np.count_nonzero(pred_bool & gt_bool)),
        "fp": int(np.count_nonzero(pred_bool & ~gt_bool)),
        "fn": int(np.count_nonzero(~pred_bool & gt_bool)),
    }


def ratio(numerator, denominator):
    return float(numerator / denominator) if denominator else None


def centroid(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return np.array([xs.mean(), ys.mean()], dtype=np.float64)


def frame_metrics(frame, pred):
    gt = frame["gt"]
    c = counts(pred, gt)
    gt_area = int(gt.sum())
    pred_area = int(pred.sum())
    union = c["tp"] + c["fp"] + c["fn"]
    dice_denominator = 2 * c["tp"] + c["fp"] + c["fn"]
    iou = ratio(c["tp"], union)
    dice = ratio(2 * c["tp"], dice_denominator)
    gt_centroid = centroid(gt)
    pred_centroid = centroid(pred)
    centroid_error = None
    if gt_centroid is not None and pred_centroid is not None:
        centroid_error = float(np.linalg.norm(gt_centroid - pred_centroid))
    area_error = None
    if gt_area:
        area_error = float(abs(pred_area - gt_area) / gt_area)
    # Used only for training parameter selection. Empty/empty scores one;
    # empty/nonempty scores zero. Reported test metrics keep positives and
    # negatives separate to avoid hiding false positives behind this convention.
    selection_dice = dice
    if dice_denominator == 0:
        selection_dice = 1.0 if gt_area == 0 and pred_area == 0 else 0.0
    return {
        "test_id": frame["test_id"],
        "frame": frame["name"],
        "frame_index": frame["frame_index"],
        "time_s": frame["time_s"],
        "flame_visible": bool(gt_area > 0),
        "gt_area_px": gt_area,
        "pred_area_px": pred_area,
        **c,
        "iou": iou,
        "dice": dice,
        "selection_dice": float(selection_dice),
        "centroid_error_px": centroid_error,
        "absolute_relative_area_error": area_error,
    }


def candidate_grid():
    return [
        {"color_threshold": c, "brightness_threshold": b, "min_component_area": a}
        for c, b, a in product(COLOR_THRESHOLDS, BRIGHTNESS_THRESHOLDS, MIN_COMPONENT_AREAS)
    ]


def summarize(rows):
    positive = [r for r in rows if r["flame_visible"]]
    negative = [r for r in rows if not r["flame_visible"]]
    total = {key: int(sum(r[key] for r in rows)) for key in ("tp", "fp", "fn")}
    tp, fp, fn = total["tp"], total["fp"], total["fn"]
    detected_positive = [r for r in positive if r["pred_area_px"] > 0]
    centroid_values = [r["centroid_error_px"] for r in positive
                       if r["centroid_error_px"] is not None]
    return {
        "frames": len(rows),
        "positive_frames": len(positive),
        "negative_frames": len(negative),
        **total,
        "micro_iou": ratio(tp, tp + fp + fn),
        "micro_dice": ratio(2 * tp, 2 * tp + fp + fn),
        "micro_precision": ratio(tp, tp + fp),
        "micro_recall": ratio(tp, tp + fn),
        "positive_macro_iou": float(np.mean([r["iou"] for r in positive])) if positive else None,
        "positive_macro_dice": float(np.mean([r["dice"] for r in positive])) if positive else None,
        "positive_detection_failures": len(positive) - len(detected_positive),
        "negative_frames_with_false_positive": sum(r["pred_area_px"] > 0 for r in negative),
        "negative_false_positive_pixels": int(sum(r["fp"] for r in negative)),
        "median_centroid_error_px_when_detected": float(np.median(centroid_values)) if centroid_values else None,
        "mean_centroid_error_px_when_detected": float(np.mean(centroid_values)) if centroid_values else None,
        "median_absolute_relative_area_error_positive": float(np.median(
            [r["absolute_relative_area_error"] for r in positive])) if positive else None,
    }


def save_error_overlay(frame, pred, destination):
    image = frame["image"]
    gt = frame["gt"].astype(bool)
    pred_bool = pred.astype(bool)
    # TP green, FP red, FN blue; untouched source pixels remain visible.
    overlay = image.copy()
    overlay[pred_bool & gt] = (0, 220, 0)
    overlay[pred_bool & ~gt] = (0, 0, 255)
    overlay[~pred_bool & gt] = (255, 0, 0)
    blended = cv2.addWeighted(image, 0.45, overlay, 0.55, 0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(destination), blended)


def save_contact_sheet(test_id, rows, frames_by_name, predictions, destination):
    tiles = []
    for row in rows:
        frame = frames_by_name[row["frame"]]
        image = frame["image"]
        pred = predictions[row["frame"]]
        gt = frame["gt"].astype(bool)
        pred_bool = pred.astype(bool)
        overlay = image.copy()
        overlay[pred_bool & gt] = (0, 220, 0)
        overlay[pred_bool & ~gt] = (0, 0, 255)
        overlay[~pred_bool & gt] = (255, 0, 0)
        blended = cv2.addWeighted(image, 0.45, overlay, 0.55, 0)
        tile = cv2.resize(blended, (360, 240), interpolation=cv2.INTER_AREA)
        canvas = np.full((278, 360, 3), 245, np.uint8)
        canvas[38:] = tile
        if row["flame_visible"]:
            caption = (f"{test_id} f{row['frame_index']} | IoU {row['iou']:.3f} "
                       f"Dice {row['dice']:.3f}")
        else:
            caption = f"{test_id} f{row['frame_index']} | negative | FP {row['fp']} px"
        cv2.putText(canvas, caption, (7, 25), cv2.FONT_HERSHEY_SIMPLEX,
                    0.47, (15, 15, 15), 1, cv2.LINE_AA)
        tiles.append(canvas)
    while len(tiles) % 2:
        tiles.append(np.full_like(tiles[0], 225))
    sheet = np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)])
    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(destination), sheet)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    output = root / "results"
    output.mkdir(parents=True, exist_ok=True)

    selection, frames = load_inputs(root)
    frames_by_name = {f["name"]: f for f in frames}
    candidates = candidate_grid()

    # Candidate predictions depend only on source pixels and the fixed grid.
    # Labels are consulted below, separately for each training fold.
    prediction_cache = {}
    for candidate_index, params in enumerate(candidates):
        prediction_cache[candidate_index] = {
            f["name"]: predict(f, **params) for f in frames
        }

    fold_records = []
    holdout_rows = []
    holdout_predictions = {}
    for holdout in ("B1", "B2", "B3"):
        train_frames = [f for f in frames if f["test_id"] != holdout]
        test_frames = [f for f in frames if f["test_id"] == holdout]
        candidate_scores = []
        for candidate_index, params in enumerate(candidates):
            train_rows = [
                frame_metrics(f, prediction_cache[candidate_index][f["name"]])
                for f in train_frames
            ]
            positive = [r for r in train_rows if r["flame_visible"]]
            negative = [r for r in train_rows if not r["flame_visible"]]
            candidate_scores.append({
                "candidate_index": candidate_index,
                "params": params,
                "train_selection_score": float(np.mean([r["selection_dice"] for r in train_rows])),
                "train_positive_macro_dice": float(np.mean([r["dice"] for r in positive])),
                "train_negative_false_positive_pixels": int(sum(r["fp"] for r in negative)),
            })
        candidate_scores.sort(key=lambda r: (
            -r["train_selection_score"],
            -r["train_positive_macro_dice"],
            r["train_negative_false_positive_pixels"],
            r["params"]["color_threshold"],
            r["params"]["brightness_threshold"],
            r["params"]["min_component_area"],
        ))
        best = candidate_scores[0]
        best_index = best["candidate_index"]
        test_rows = []
        for frame in test_frames:
            pred = prediction_cache[best_index][frame["name"]]
            row = frame_metrics(frame, pred)
            row["selected_params"] = best["params"]
            test_rows.append(row)
            holdout_rows.append(row)
            holdout_predictions[frame["name"]] = pred
            save_error_overlay(
                frame, pred,
                output / "prediction-overlays" / f"{holdout}_{frame['name']}",
            )
        test_rows.sort(key=lambda r: r["frame_index"])
        save_contact_sheet(holdout, test_rows, frames_by_name, holdout_predictions,
                           output / "prediction-overlays" / f"{holdout}-contact.png")
        fold_records.append({
            "holdout_test": holdout,
            "training_tests": [t for t in ("B1", "B2", "B3") if t != holdout],
            "train_frames": len(train_frames),
            "test_frames": len(test_frames),
            "selected_params": best["params"],
            "train_selection_score": best["train_selection_score"],
            "train_positive_macro_dice": best["train_positive_macro_dice"],
            "train_negative_false_positive_pixels": best["train_negative_false_positive_pixels"],
            "holdout_metrics": summarize(test_rows),
        })

    pooled = summarize(holdout_rows)
    per_test = {test: summarize([r for r in holdout_rows if r["test_id"] == test])
                for test in ("B1", "B2", "B3")}
    input_paths = [root / "frames/selection.json", root / "annotations/polygons.json",
                   Path(__file__).resolve()]
    input_paths += [root / row["file"] for row in selection]
    input_paths += [root / row["mask"] for row in selection]
    result = {
        "schema": SCHEMA,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "task": "visibly luminous flame-region segmentation",
        "method": {
            "features": "red_excess = R - 0.5*(G+B), plus R brightness; OpenCV BGR input converted to float32 channels",
            "decision": "red_excess >= color_threshold AND R >= brightness_threshold",
            "postprocessing": "3x3 opening, 5x5 closing, 8-connected components below min_component_area removed",
            "candidate_grid": {
                "color_threshold": COLOR_THRESHOLDS,
                "brightness_threshold": BRIGHTNESS_THRESHOLDS,
                "min_component_area": MIN_COMPONENT_AREAS,
            },
            "candidate_count": len(candidates),
            "selection": "maximum mean training selection_dice; empty/empty=1 and empty/nonempty=0; deterministic ties by positive Dice, negative FP, then thresholds",
            "split": "leave-one-test-out over B1/B2/B3; all frames from the held-out video excluded from parameter selection",
        },
        "annotation_scope": "coarse AI-assistant visual polygons, not independent-expert gold masks",
        "folds": fold_records,
        "per_test_holdout_metrics": per_test,
        "pooled_holdout_metrics": pooled,
        "limitations": [
            "Only 24 frames from three videos; frames within each video are correlated.",
            "Three holdout tests are not independent external validation of general BASS/BASS-II performance.",
            "Annotations and visual review were produced by the AI assistant, not an independent domain expert.",
            "No confidence intervals are reported because the experiment count is too small for a reliable cluster-level interval.",
            "Results concern visible luminous regions, not chemical flame boundaries, temperature, suppression effectiveness or operational safety.",
        ],
        "software": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "opencv": cv2.__version__,
        },
        "input_sha256": {str(path.relative_to(root)): sha256(path) for path in input_paths},
    }
    (output / "metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (output / "per-frame-metrics.json").write_text(json.dumps(holdout_rows, indent=2), encoding="utf-8")

    # Stable CSV for inspection and reuse without requiring a spreadsheet library.
    import csv
    csv_fields = [
        "test_id", "frame", "frame_index", "time_s", "flame_visible",
        "gt_area_px", "pred_area_px", "tp", "fp", "fn", "iou", "dice",
        "centroid_error_px", "absolute_relative_area_error",
        "color_threshold", "brightness_threshold", "min_component_area",
    ]
    with (output / "per-frame-metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields)
        writer.writeheader()
        for row in sorted(holdout_rows, key=lambda r: (r["test_id"], r["frame_index"])):
            writer.writerow({
                **{key: row.get(key) for key in csv_fields},
                **row["selected_params"],
            })
    print(json.dumps({"selected": {f["holdout_test"]: f["selected_params"] for f in fold_records},
                      "per_test": per_test, "pooled": pooled}, indent=2))


if __name__ == "__main__":
    main()
