#!/usr/bin/env python3
"""Evaluate frozen Falmex Vision v4 predictions on B9/B10/B11 annotations."""
import json
from pathlib import Path

import cv2
import numpy as np

from falmex_vision_v3 import frame_metrics, overlay, sha256, summarize

ROOT = Path(__file__).resolve().parents[1]
selection = json.loads((ROOT / "confirmation-v4/selection.json").read_text())
model_freeze = json.loads((ROOT / "vision-v4/model-freeze.json").read_text())
inference_freeze = json.loads((ROOT / "confirmation-v4/inference-freeze.json").read_text())
assert model_freeze["model_sha256"] == inference_freeze["model_sha256"]
assert sha256(ROOT / inference_freeze["selection_file"]) == inference_freeze["selection_sha256"]
for record in inference_freeze["prediction_files"]:
    assert sha256(ROOT / record["file"]) == record["sha256"], record["file"]

rows = []
for item in selection:
    name = Path(item["file"]).name
    image = cv2.imread(str(ROOT / item["file"]))
    gt = (cv2.imread(str(ROOT / item["mask"]), 0) > 0).astype(np.uint8)
    prediction = (cv2.imread(
        str(ROOT / "confirmation-v4/frozen-predictions" / item["test_id"] / name), 0) > 0).astype(np.uint8)
    assert image is not None and gt.shape == prediction.shape == image.shape[:2]
    frame = {**item, "name": name, "image": image, "gt": gt}
    row = frame_metrics(frame, prediction)
    rows.append(row)
    destination = ROOT / "confirmation-v4/error-overlays" / item["test_id"] / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(destination), overlay(image, gt, prediction))

per_test = {test: summarize([r for r in rows if r["test_id"] == test])
            for test in ("B9", "B10", "B11")}
result = {
    "schema": "falmex-vision-v4-confirmation-metrics-v1",
    "status": "frozen-model confirmation on videos reserved before v4 development; AI-assistant annotations, not expert external validation",
    "model_sha256": model_freeze["model_sha256"],
    "selected_candidate": model_freeze["selected_candidate"],
    "inference_precedes_annotation": True,
    "annotation_source_review_without_prediction_overlays": True,
    "development_tests": list(model_freeze["development_tests"]),
    "confirmation_tests": ["B9", "B10", "B11"],
    "per_test": per_test,
    "pooled": summarize(rows),
    "limitations": [
        "Only 24 frames from three confirmation videos; frames within videos are correlated.",
        "Confirmation polygons were manually produced and reviewed by the AI assistant, not an independent expert.",
        "B10 and late B11 visible boundaries are dim and uncertain.",
        "No confidence intervals are reported with only three video-level clusters.",
        "Visible luminous-region segmentation does not establish chemical flame boundaries, extinction time or fire-safety effectiveness.",
    ],
}
(ROOT / "confirmation-v4/metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
(ROOT / "confirmation-v4/per-frame-metrics.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

for test in ("B9", "B10", "B11"):
    tiles = []
    for row in [r for r in rows if r["test_id"] == test]:
        name = row["frame"]
        image = cv2.imread(str(ROOT / "confirmation-v4/error-overlays" / test / name))
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
    cv2.imwrite(str(ROOT / "confirmation-v4/error-overlays" / f"{test}-contact.png"), sheet)
print(json.dumps({"model_sha256": result["model_sha256"], "per_test": per_test,
                  "pooled": result["pooled"]}, indent=2))
