#!/usr/bin/env python3
"""Evaluate frozen Falmex Vision v2 predictions on B4/B5/B7 annotations."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from falmex_vision_v2 import frame_metrics, overlay, sha256, summarize

ROOT = Path(__file__).resolve().parents[1]
selection = json.loads((ROOT / "confirmation/selection.json").read_text())
model_freeze = json.loads((ROOT / "vision-v2/model-freeze.json").read_text())
inference_freeze = json.loads((ROOT / "confirmation/inference-freeze.json").read_text())
assert model_freeze["model_sha256"] == inference_freeze["model_sha256"]
for record in inference_freeze["prediction_files"]:
    assert sha256(ROOT / record["file"]) == record["sha256"], record["file"]

rows = []
for item in selection:
    name = Path(item["file"]).name
    image = cv2.imread(str(ROOT / item["file"]))
    gt = (cv2.imread(str(ROOT / item["mask"]), 0) > 0).astype(np.uint8)
    prediction = (cv2.imread(
        str(ROOT / "confirmation/frozen-predictions" / item["test_id"] / name), 0) > 0).astype(np.uint8)
    assert image is not None and gt.shape == prediction.shape == image.shape[:2]
    frame = {**item, "name": name, "image": image, "gt": gt}
    row = frame_metrics(frame, prediction)
    rows.append(row)
    destination = ROOT / "confirmation/error-overlays" / item["test_id"] / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(destination), overlay(image, gt, prediction))

per_test = {test: summarize([r for r in rows if r["test_id"] == test])
            for test in ("B4", "B5", "B7")}
result = {
    "schema": "falmex-vision-v2-confirmation-metrics-v1",
    "status": "frozen-model confirmation on videos reserved before v2 development; AI-assistant annotations, not expert external validation",
    "model_sha256": model_freeze["model_sha256"],
    "inference_precedes_annotation": True,
    "annotation_source_review_without_prediction_overlays": True,
    "development_tests": ["B1", "B2", "B3"],
    "confirmation_tests": ["B4", "B5", "B7"],
    "per_test": per_test,
    "pooled": summarize(rows),
    "limitations": [
        "Only 24 frames from three confirmation videos; frames within videos are correlated.",
        "Confirmation polygons were manually produced and reviewed by the AI assistant, not an independent expert.",
        "No confidence intervals are reported with only three video-level clusters.",
        "Visible luminous-region segmentation does not establish chemical flame boundaries, extinction time or fire-safety effectiveness.",
    ],
}
(ROOT / "confirmation/metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
(ROOT / "confirmation/per-frame-metrics.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

for test in ("B4", "B5", "B7"):
    tiles = []
    for row in [r for r in rows if r["test_id"] == test]:
        name = row["frame"]
        image = cv2.imread(str(ROOT / "confirmation/error-overlays" / test / name))
        tile = cv2.resize(image, (360, 240))
        canvas = np.full((278, 360, 3), 245, np.uint8)
        canvas[38:] = tile
        if row["flame_visible"]:
            caption = f"{test} f{row['frame_index']} | IoU {row['iou']:.3f} Dice {row['dice']:.3f}"
        else:
            caption = f"{test} f{row['frame_index']} | negative | FP {row['fp']} px"
        cv2.putText(canvas, caption, (7, 25), cv2.FONT_HERSHEY_SIMPLEX,
                    0.47, (15, 15, 15), 1, cv2.LINE_AA)
        tiles.append(canvas)
    sheet = np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)])
    cv2.imwrite(str(ROOT / "confirmation/error-overlays" / f"{test}-contact.png"), sheet)
print(json.dumps({"model_sha256": result["model_sha256"], "per_test": per_test,
                  "pooled": result["pooled"]}, indent=2))
