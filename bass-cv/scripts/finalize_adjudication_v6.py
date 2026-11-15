#!/usr/bin/env python3
"""Freeze a supplied third adjudication and rescore the unchanged v3-v6 masks.

This script does not infer adjudicator identity, expertise, or independence. It never
changes model files, frozen predictions, original annotations, or earlier metrics.
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from falmex_vision_v3 import frame_metrics, sha256, summarize
from process_independent_review_v6 import convert, validate_reviewer

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ("v3", "v4", "v5", "v6")


def optional_difference(a, b):
    return None if a is None or b is None else a - b


def format_metric(value) -> str:
    return "not defined" if value is None else f"{value:.6f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--adjudicator", type=Path, required=True,
                        help="Folder containing all 24 completed anonymous LabelMe JSON files")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory must be empty; refusing to overwrite adjudication results")
    output.mkdir(parents=True, exist_ok=True)

    review_manifest_path = root / "independent-review-v6/manifest.json"
    review_manifest = json.loads(review_manifest_path.read_text(encoding="utf-8"))
    frames = review_manifest["frames"]
    if len(frames) != 24:
        raise ValueError("Expected exactly 24 review frames")
    queue_path = root / "independent-review-results-v6/adjudication-queue.csv"
    with queue_path.open(newline="", encoding="utf-8") as handle:
        queue = list(csv.DictReader(handle))
    queued_ids = {row["anonymous_id"] for row in queue}
    expected_ids = {frame["anonymous_id"] for frame in frames}
    if queued_ids != expected_ids:
        raise ValueError("This finalizer expects the actual all-24-frame v6 adjudication queue")

    normalized = output / "normalized-adjudicator"
    normalized.mkdir()
    for frame in frames:
        anonymous = frame["anonymous_id"]
        original = anonymous.split("_", 1)[1]
        json_name = f"{Path(anonymous).stem}.json"
        shutil.copy2(args.adjudicator / json_name, normalized / json_name)
        supplied_image = args.adjudicator / f"{Path(anonymous).stem}.png"
        source_image = root / "confirmation-v6/source-frames" / original
        if sha256(source_image) != frame["source_sha256"]:
            raise ValueError(f"Frozen source hash mismatch: {source_image}")
        if supplied_image.is_file():
            if sha256(supplied_image) != frame["source_sha256"]:
                raise ValueError(f"Adjudicator PNG differs from frozen source: {supplied_image}")
            shutil.copy2(supplied_image, normalized / supplied_image.name)
        else:
            shutil.copy2(source_image, normalized / f"{Path(anonymous).stem}.png")

    records = validate_reviewer(normalized, normalized, frames, "adjudicator")
    convert(normalized, output / "masks")
    selection = json.loads((root / "confirmation-v6/selection.json").read_text(encoding="utf-8"))
    freeze_path = root / "confirmation-v6/inference-freeze.json"
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    prediction_records = {
        (row["model"], row["test_id"], row["frame_index"]): row for row in freeze["frames"]
    }
    if len(prediction_records) != 96:
        raise ValueError("Expected 96 frozen prediction records")

    for row in freeze["frames"]:
        path = root / row["mask"]
        if sha256(path) != row["mask_sha256"]:
            raise ValueError(f"Frozen prediction hash mismatch: {path}")
    model_files = {}
    for version, record in freeze["models"].items():
        path = root / record["model_file"]
        model_files[version] = {
            "path": record["model_file"], "expected_sha256": record["model_sha256"],
            "present": path.is_file(),
            "verified_sha256": sha256(path) if path.is_file() else None,
        }
        if path.is_file() and model_files[version]["verified_sha256"] != record["model_sha256"]:
            raise ValueError(f"Model hash mismatch: {path}")

    by_key = {(frame["test_id"], frame["frame_index"]): frame for frame in frames}
    all_rows = {}
    mask_hashes = {}
    for version in VERSIONS:
        rows = []
        for selected in selection:
            key = (selected["test_id"], selected["frame_index"])
            frame = by_key[key]
            original = selected["file"].split("/")[-1]
            mask_path = output / "masks" / frame["anonymous_id"]
            source_path = root / selected["file"]
            image = cv2.imread(str(source_path))
            reference_u8 = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if image is None or reference_u8 is None or reference_u8.shape != image.shape[:2]:
                raise ValueError(f"Invalid adjudicated mask: {mask_path}")
            reference = (reference_u8 > 0).astype(np.uint8)
            prediction_record = prediction_records[(version, *key)]
            prediction = (cv2.imread(str(root / prediction_record["mask"]), cv2.IMREAD_GRAYSCALE) > 0).astype(np.uint8)
            if prediction.shape != reference.shape:
                raise ValueError(f"Prediction/reference shape mismatch: {prediction_record['mask']}")
            metric = frame_metrics(
                {"name": original, "test_id": selected["test_id"], "frame_index": selected["frame_index"],
                 "time_s": selected["time_s"], "image": image, "gt": reference}, prediction
            )
            metric["adjudicator_uncertain_boundary"] = records[frame["anonymous_id"]]["uncertain_boundary"]
            rows.append(metric)
            mask_hashes[original] = sha256(mask_path)
        all_rows[version] = rows

    results = {
        "schema": "falmex-vision-v6-third-adjudicated-confirmation-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "supplied third adjudication processed; identity, expertise and independence not verified",
        "reference": "third-adjudicator visibly luminous flame masks; not a chemical or thermal boundary",
        "adjudicated_frames": len(frames),
        "positive_reference_frames": sum(row["flame_visible"] for row in all_rows["v3"]),
        "uncertain_boundary_frames": sum(record["uncertain_boundary"] for record in records.values()),
        "video_clusters": 3,
        "confidence_intervals": "not reported with only three video clusters",
        "independent_expert_annotation": False,
        "operational_readiness": False,
        "models_unchanged": True,
        "predictions_unchanged": True,
        "original_metrics_unchanged": True,
        "inference_freeze_sha256": sha256(freeze_path),
        "review_manifest_sha256": sha256(review_manifest_path),
        "adjudication_queue_sha256": sha256(queue_path),
        "model_files": model_files,
        "models": {},
    }
    for version in VERSIONS:
        rows = all_rows[version]
        results["models"][version] = {
            "pooled": summarize(rows),
            "per_test": {test: summarize([row for row in rows if row["test_id"] == test])
                         for test in ("B14", "B17", "B18")},
        }
    results["paired_differences"] = {
        f"v6_minus_{version}": {
            "pooled_macro_iou": optional_difference(results["models"]["v6"]["pooled"]["positive_macro_iou"], results["models"][version]["pooled"]["positive_macro_iou"]),
            "pooled_micro_iou": results["models"]["v6"]["pooled"]["micro_iou"] - results["models"][version]["pooled"]["micro_iou"],
            "pooled_fp_pixels": results["models"]["v6"]["pooled"]["fp"] - results["models"][version]["pooled"]["fp"],
        } for version in ("v3", "v4", "v5")
    }
    (output / "adjudicated-metrics.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    (output / "adjudicated-per-frame.json").write_text(json.dumps(all_rows, indent=2), encoding="utf-8")
    with (output / "adjudicated-per-frame.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = ["model", "test_id", "frame_index", "frame", "flame_visible", "iou", "dice", "tp", "fp", "fn",
                  "adjudicator_uncertain_boundary"]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for version in VERSIONS:
            for row in all_rows[version]:
                writer.writerow({"model": version, **row})

    provenance = {
        "schema": "falmex-third-adjudication-provenance-v1",
        "input_json_sha256": {key: value["json_sha256"] for key, value in records.items()},
        "input_source_sha256": {key: value["source_sha256"] for key, value in records.items()},
        "mask_sha256": mask_hashes,
        "labels": {key: value["labels"] for key, value in records.items()},
        "no_visible_flame": {key: value["no_visible_flame"] for key, value in records.items()},
        "uncertain_boundary": {key: value["uncertain_boundary"] for key, value in records.items()},
        "identity_expertise_independence_verified": False,
    }
    (output / "adjudication-provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")

    lines = [
        "# Third-adjudicated v6 confirmation report", "",
        "All 96 predictions were rescored unchanged. Model files were not retrained and earlier metrics were not overwritten.",
        "The supplied adjudicator's identity, expertise and independence were not verified; this is not an operational safety result.", "",
        "| Model | Positive Macro IoU | Micro IoU | TP | FP | FN | Detection failures |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for version in VERSIONS:
        metric = results["models"][version]["pooled"]
        lines.append(f"| {version} | {format_metric(metric['positive_macro_iou'])} | {format_metric(metric['micro_iou'])} | "
                     f"{metric['tp']} | {metric['fp']} | {metric['fn']} | {metric['positive_detection_failures']} |")
    (output / "adjudicated-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "models": results["models"]}, indent=2))


if __name__ == "__main__":
    main()
