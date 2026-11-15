#!/usr/bin/env python3
"""Preregistered same-video v3/v4/v5 confirmation inference.

Selection uses video metadata only. Prediction requires the frozen v5 model and
writes source frames plus model masks, never model-overlay contact sheets.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import numpy as np

import falmex_vision_v3 as v3
import falmex_vision_v4 as v4
import falmex_vision_v5 as v5

FRACTIONS = (0, 0.12, 0.25, 0.38, 0.50, 0.62, 0.75, 0.88)


def load_protocol(root):
    split = json.loads((root / "metadata/vision-v5-split.json").read_text())
    manifest = json.loads((root / "metadata/v5-confirmation-manifest.json").read_text())
    return split, {row["test_id"]: row for row in manifest["files"]}


def make_selection(root):
    split, files = load_protocol(root)
    output = root / "confirmation-v5"
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for test in split["reserved_confirmation_tests"]:
        record = files[test]
        video = root / record["file"]
        if v3.sha256(video) != record["sha256"] or video.stat().st_size != record["bytes"]:
            raise ValueError(f"Video hash/size mismatch for {test}")
        capture = cv2.VideoCapture(str(video))
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        capture.release()
        if count < 2 or fps <= 0:
            raise ValueError(f"Invalid video metadata for {test}")
        indices = [int((count - 1) * fraction) for fraction in FRACTIONS]
        for index in indices:
            rows.append({
                "test_id": test, "frame_index": index, "time_s": index / fps,
                "video": record["file"], "video_sha256": record["sha256"],
                "selection_rule": "fixed temporal fractions from metadata only before frame or prediction inspection",
                "fractions": list(FRACTIONS), "source_frame_count": count, "source_fps": fps,
                "file": f"confirmation-v5/source-frames/{test}_{index:06d}.png",
            })
    (output / "selection.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps({"tests": split["reserved_confirmation_tests"], "frames": len(rows),
                      "indices": {test: [r["frame_index"] for r in rows if r["test_id"] == test]
                                  for test in split["reserved_confirmation_tests"]}}, indent=2))


def verify_frozen_models(root):
    models = {}
    freezes = {}
    for version, module in (("v3", v3), ("v4", v4), ("v5", v5)):
        freeze = json.loads((root / f"vision-{version}/model-freeze.json").read_text())
        path = root / freeze["model_file"]
        if v3.sha256(path) != freeze["model_sha256"]:
            raise ValueError(f"{version} model hash mismatch")
        bundle = joblib.load(path)
        if bundle["config"] != module.CONFIG or bundle["feature_names"] != module.FEATURE_NAMES:
            raise ValueError(f"{version} inference code/config mismatch")
        models[version], freezes[version] = bundle, freeze
    return models, freezes


def predict(root):
    selection_path = root / "confirmation-v5/selection.json"
    selection = json.loads(selection_path.read_text())
    if len(selection) != 24:
        raise ValueError("Expected 24 confirmation frames")
    output = root / "confirmation-v5"
    selection_freeze_path = output / "selection-freeze.json"
    selection_freeze = json.loads(selection_freeze_path.read_text())
    if selection_freeze["selection_sha256"] != v3.sha256(selection_path):
        raise ValueError("Confirmation selection differs from its metadata-only freeze")
    if (output / "inference-freeze.json").exists():
        raise ValueError("Confirmation inference is already frozen; refusing to overwrite it")
    models, freezes = verify_frozen_models(root)
    if freezes["v5"]["created_utc"] < selection_freeze["created_utc"]:
        raise ValueError("v5 model freeze predates the confirmation selection freeze")
    (output / "source-frames").mkdir(parents=True, exist_ok=True)
    manifest = []
    for test in v5.CONFIRMATION_TESTS:
        test_rows = [row for row in selection if row["test_id"] == test]
        video = root / test_rows[0]["video"]
        reference = v3.reference_frame(video, 30)
        for row in test_rows:
            image = v3.read_frame(video, row["frame_index"])
            name = Path(row["file"]).name
            source_path = root / row["file"]
            cv2.imwrite(str(source_path), image)
            predictions = {
                "v3": v3.predict(models["v3"]["model"], image, reference),
                "v4": v4.predict(models["v4"]["model"], image, reference),
                "v5": v5.predict_mask(models["v5"], image, reference),
            }
            for version, mask in predictions.items():
                destination = output / "frozen-predictions" / version / test
                destination.mkdir(parents=True, exist_ok=True)
                path = destination / name
                cv2.imwrite(str(path), mask.astype(np.uint8) * 255)
                manifest.append({
                    "test_id": test, "frame_index": row["frame_index"], "model": version,
                    "mask": str(path.relative_to(root)), "mask_sha256": v3.sha256(path),
                    "prediction_area_px": int(mask.sum()), "model_sha256": freezes[version]["model_sha256"],
                    "source_frame": row["file"], "source_sha256": v3.sha256(source_path),
                })
            print(f"predicted {test} frame {row['frame_index']} with frozen v3/v4/v5", flush=True)
    inference = {
        "schema": "falmex-vision-v5-confirmation-inference-freeze-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "all predictions frozen before confirmation annotation or metric computation",
        "selection_sha256": v3.sha256(selection_path),
        "selection_freeze_sha256": v3.sha256(output / "selection-freeze.json"),
        "protocol_sha256": v3.sha256(root / "metadata/vision-v5-split.json"),
        "models": {version: {"model_file": freeze["model_file"], "model_sha256": freeze["model_sha256"],
                             "model_freeze_sha256": v3.sha256(root / f"vision-{version}/model-freeze.json"),
                             "inference_code_sha256": v3.sha256(root / f"scripts/falmex_vision_{version}.py")}
                   for version, freeze in freezes.items()},
        "runner_code_sha256": v3.sha256(Path(__file__).resolve()),
        "frames": manifest,
        "annotation_rule": "Source-only annotation without viewing model prediction overlays; no subsequent model changes.",
    }
    (output / "inference-freeze.json").write_text(json.dumps(inference, indent=2), encoding="utf-8")
    # Source-only contact sheets are safe for annotation; no predictions are drawn.
    for test in v5.CONFIRMATION_TESTS:
        tiles = []
        for row in [r for r in selection if r["test_id"] == test]:
            image = cv2.imread(str(root / row["file"]))
            image = cv2.resize(image, (360, 240))
            label = f"{test} f{row['frame_index']} | source only"
            cv2.putText(image, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 0, 0), 3)
            cv2.putText(image, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1)
            tiles.append(image)
        sheet = np.concatenate([np.concatenate(tiles[i:i + 2], axis=1) for i in range(0, 8, 2)], axis=0)
        cv2.imwrite(str(output / f"{test}-source-contact.png"), sheet)
    print(json.dumps({"predictions": len(manifest), "frames": len(selection),
                      "inference_freeze": "confirmation-v5/inference-freeze.json"}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("make-selection")
    sub.add_parser("predict")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "make-selection":
        make_selection(root)
    else:
        predict(root)


if __name__ == "__main__":
    main()
