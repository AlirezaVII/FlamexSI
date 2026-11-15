#!/usr/bin/env python3
"""Rasterize source-only v6 confirmation polygons without reading predictions."""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from falmex_vision_v3 import sha256

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "confirmation-v6"


def main():
    selection = json.loads((OUTPUT / "selection.json").read_text(encoding="utf-8"))
    polygons_path = OUTPUT / "annotations/polygons.json"
    data = json.loads(polygons_path.read_text(encoding="utf-8"))
    expected = [Path(row["file"]).name for row in selection]
    annotations = data["annotations"]
    if set(annotations) != set(expected) or len(annotations) != 24:
        raise ValueError("Annotation keys must exactly match the 24 frozen confirmation frames")
    if (data.get("image_width"), data.get("image_height")) != (720, 480):
        raise ValueError("Unexpected annotation image dimensions")
    if data.get("review_status") != "visually_reviewed_by_ai_assistant_not_independent_expert":
        raise ValueError("Unexpected or unsupported annotation review status")
    mask_dir = OUTPUT / "annotations/masks"
    mask_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for name in expected:
        mask = np.zeros((480, 720), dtype=np.uint8)
        polygons = annotations[name]
        for polygon in polygons:
            points = np.rint(np.asarray(polygon, dtype=np.float32)).astype(np.int32)
            if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] != 2:
                raise ValueError(f"Invalid polygon in {name}")
            if points[:, 0].min() < 0 or points[:, 0].max() >= 720 or points[:, 1].min() < 0 or points[:, 1].max() >= 480:
                raise ValueError(f"Out-of-bounds polygon in {name}")
            cv2.fillPoly(mask, [points], 255)
        destination = mask_dir / name
        cv2.imwrite(str(destination), mask)
        records.append({
            "frame": name, "polygons": len(polygons), "area_px": int((mask > 0).sum()),
            "mask_sha256": sha256(destination),
        })
    (OUTPUT / "annotations/rasterization-manifest.json").write_text(json.dumps({
        "schema": "falmex-confirmation-v6-rasterization-v1",
        "polygons_sha256": sha256(polygons_path),
        "source_only_annotation": True,
        "prediction_files_read": False,
        "independent_expert_annotation": False,
        "frames": records,
    }, indent=2), encoding="utf-8")
    print(json.dumps({
        "frames": len(records), "positive": sum(row["area_px"] > 0 for row in records),
        "negative": sum(row["area_px"] == 0 for row in records),
        "total_area_px": sum(row["area_px"] for row in records),
    }, indent=2))


if __name__ == "__main__":
    main()
