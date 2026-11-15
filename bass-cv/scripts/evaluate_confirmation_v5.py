#!/usr/bin/env python3
"""Verify and evaluate the frozen same-video v3/v4/v5 confirmation predictions."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np

from falmex_vision_v3 import frame_metrics, overlay, sha256, summarize
from falmex_vision_v5 import CONFIRMATION_TESTS, CONFIG

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "confirmation-v5"


def verify_freeze(selection, freeze):
    if sha256(OUTPUT / "selection.json") != freeze["selection_sha256"]:
        raise ValueError("Confirmation selection hash mismatch")
    for version, model in freeze["models"].items():
        if sha256(ROOT / model["model_file"]) != model["model_sha256"]:
            raise ValueError(f"Model hash mismatch for {version}")
        if sha256(ROOT / f"vision-{version}/model-freeze.json") != model["model_freeze_sha256"]:
            raise ValueError(f"Model freeze hash mismatch for {version}")
        if sha256(ROOT / f"scripts/falmex_vision_{version}.py") != model["inference_code_sha256"]:
            raise ValueError(f"Inference code hash mismatch for {version}")
    by_key = {(row["model"], row["test_id"], row["frame_index"]): row for row in freeze["frames"]}
    if len(by_key) != 72:
        raise ValueError("Expected 72 frozen predictions")
    for row in selection:
        source = ROOT / row["file"]
        for version in ("v3", "v4", "v5"):
            record = by_key[(version, row["test_id"], row["frame_index"])]
            if sha256(ROOT / record["mask"]) != record["mask_sha256"]:
                raise ValueError(f"Prediction hash mismatch: {record['mask']}")
            if record["source_sha256"] != sha256(source):
                raise ValueError(f"Source hash mismatch: {source}")
    return by_key


def subset(rows, small_or_dim=None):
    selected = rows if small_or_dim is None else [r for r in rows if r["small_or_dim"] == small_or_dim]
    return summarize(selected)


def main():
    selection = json.loads((OUTPUT / "selection.json").read_text())
    freeze = json.loads((OUTPUT / "inference-freeze.json").read_text())
    prediction_records = verify_freeze(selection, freeze)
    polygons_path = OUTPUT / "annotations/polygons.json"
    annotations = json.loads(polygons_path.read_text())
    mask_hashes = {}
    frames = []
    for row in selection:
        name = Path(row["file"]).name
        image = cv2.imread(str(ROOT / row["file"]))
        mask_path = OUTPUT / "annotations/masks" / name
        gt_u8 = cv2.imread(str(mask_path), 0)
        if image is None or gt_u8 is None or gt_u8.shape != image.shape[:2]:
            raise ValueError(f"Invalid confirmation annotation {name}")
        gt = (gt_u8 > 0).astype(np.uint8)
        area = int(gt.sum())
        value = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
        median_v = float(np.median(value[gt > 0])) if area else None
        small_or_dim = bool(area and (area < CONFIG["small_or_dim"]["area_below_px"] or
                                      median_v < CONFIG["small_or_dim"]["median_v_below"]))
        mask_hashes[name] = sha256(mask_path)
        frames.append({**row, "name": name, "image": image, "gt": gt, "small_or_dim": small_or_dim})
    results = {
        "schema": "falmex-vision-v5-same-video-confirmation-v1",
        "status": "frozen same-video comparison on B13/B15/B16; coarse AI-assistant reference masks, not independent-expert validation",
        "video_clusters": 3, "confidence_intervals": "not reported with only three video clusters",
        "operational_readiness": False,
        "independent_expert_annotation": False,
        "annotation_review_status": annotations.get("review_status"),
        "model_sha256": {version: freeze["models"][version]["model_sha256"] for version in ("v3", "v4", "v5")},
        "models": {},
    }
    all_per_frame = {}
    for version in ("v3", "v4", "v5"):
        rows = []
        for frame in frames:
            record = prediction_records[(version, frame["test_id"], frame["frame_index"])]
            prediction = (cv2.imread(str(ROOT / record["mask"]), 0) > 0).astype(np.uint8)
            rows.append({**frame_metrics(frame, prediction), "small_or_dim": frame["small_or_dim"]})
            destination = OUTPUT / "error-overlays" / version
            destination.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(destination / frame["name"]), overlay(frame["image"], frame["gt"], prediction))
        all_per_frame[version] = rows
        results["models"][version] = {
            "per_test": {test: subset([r for r in rows if r["test_id"] == test]) for test in CONFIRMATION_TESTS},
            "pooled": subset(rows), "small_or_dim_exploratory": subset(rows, True),
        }
        for test in CONFIRMATION_TESTS:
            tiles = []
            for row in [r for r in rows if r["test_id"] == test]:
                image = cv2.imread(str(destination / row["frame"]))
                image = cv2.resize(image, (360, 240))
                label = (f"{test} f{row['frame_index']} | " +
                         (f"IoU {row['iou']:.3f}" if row["flame_visible"] else f"negative FP {row['fp']} px"))
                cv2.putText(image, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.47, (0, 0, 0), 3)
                cv2.putText(image, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.47, (255, 255, 255), 1)
                tiles.append(image)
            sheet = np.concatenate([np.concatenate(tiles[i:i + 2], axis=1) for i in range(0, 8, 2)], axis=0)
            cv2.imwrite(str(destination / f"{test}-contact.png"), sheet)
    results["paired_differences"] = {}
    for version in ("v3", "v4"):
        results["paired_differences"][f"v5_minus_{version}"] = {
            "pooled_macro_iou": results["models"]["v5"]["pooled"]["positive_macro_iou"] - results["models"][version]["pooled"]["positive_macro_iou"],
            "pooled_micro_recall": results["models"]["v5"]["pooled"]["micro_recall"] - results["models"][version]["pooled"]["micro_recall"],
            "pooled_fp_pixels": results["models"]["v5"]["pooled"]["fp"] - results["models"][version]["pooled"]["fp"],
            "per_test_macro_iou": {test: results["models"]["v5"]["per_test"][test]["positive_macro_iou"] - results["models"][version]["per_test"][test]["positive_macro_iou"] for test in CONFIRMATION_TESTS},
        }
    annotation_freeze = {
        "schema": "falmex-vision-v5-annotation-freeze-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "polygons_sha256": sha256(polygons_path), "mask_sha256": mask_hashes,
        "review_status": annotations.get("review_status"),
        "independent_expert_adjudication": False,
        "inference_freeze_sha256": sha256(OUTPUT / "inference-freeze.json"),
    }
    (OUTPUT / "annotation-freeze.json").write_text(json.dumps(annotation_freeze, indent=2), encoding="utf-8")
    (OUTPUT / "metrics.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    (OUTPUT / "per-frame-metrics.json").write_text(json.dumps(all_per_frame, indent=2), encoding="utf-8")
    with (OUTPUT / "same-video-comparison.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = ["model", "test_id", "frames", "positive_frames", "negative_frames", "macro_iou", "macro_dice",
                  "micro_iou", "micro_precision", "micro_recall", "tp", "fp", "fn", "detection_failures",
                  "negative_frames_with_fp", "negative_fp_pixels"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for version in ("v3", "v4", "v5"):
            for test in (*CONFIRMATION_TESTS, "pooled"):
                metrics = results["models"][version]["pooled"] if test == "pooled" else results["models"][version]["per_test"][test]
                writer.writerow({"model": version, "test_id": test, "frames": metrics["frames"],
                                 "positive_frames": metrics["positive_frames"], "negative_frames": metrics["negative_frames"],
                                 "macro_iou": metrics["positive_macro_iou"], "macro_dice": metrics["positive_macro_dice"],
                                 "micro_iou": metrics["micro_iou"], "micro_precision": metrics["micro_precision"],
                                 "micro_recall": metrics["micro_recall"], "tp": metrics["tp"], "fp": metrics["fp"], "fn": metrics["fn"],
                                 "detection_failures": metrics["positive_detection_failures"],
                                 "negative_frames_with_fp": metrics["negative_frames_with_false_positive"],
                                 "negative_fp_pixels": metrics["negative_false_positive_pixels"]})
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    x = np.arange(4)
    width = 0.25
    for index, version in enumerate(("v3", "v4", "v5")):
        values = [results["models"][version]["per_test"][test]["positive_macro_iou"] for test in CONFIRMATION_TESTS]
        values.append(results["models"][version]["pooled"]["positive_macro_iou"])
        axes[0].bar(x + (index - 1) * width, values, width, label=version)
        axes[1].scatter(results["models"][version]["pooled"]["micro_recall"],
                        results["models"][version]["pooled"]["micro_precision"], s=80, label=version)
    axes[0].set_xticks(x, [*CONFIRMATION_TESTS, "Pooled"])
    axes[0].set_ylim(0, 1)
    axes[0].set_ylabel("Positive-frame Macro IoU")
    axes[0].set_title("Identical frozen confirmation videos")
    axes[0].legend()
    axes[0].grid(axis="y", alpha=0.25)
    axes[1].set(xlim=(0, 1.02), ylim=(0, 1.02), xlabel="Micro recall", ylabel="Micro precision",
                title="Pooled pixel trade-off")
    axes[1].legend()
    axes[1].grid(alpha=0.25)
    fig.suptitle("Falmex v3/v4/v5 — coarse AI annotations; not independent-expert validation")
    fig.tight_layout()
    fig.savefig(OUTPUT / "results-comparison.png", dpi=170)
    plt.close(fig)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
