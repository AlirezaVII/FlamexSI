#!/usr/bin/env python3
"""Convert a completed LabelMe reviewer folder to validated binary PNG masks."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reviewer", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for path in sorted(args.reviewer.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        width, height = int(data["imageWidth"]), int(data["imageHeight"])
        shapes = data.get("shapes", [])
        flags = data.get("flags", {})
        if not shapes and not flags.get("no_visible_flame", False):
            raise ValueError(f"{path.name}: empty shapes require no_visible_flame=true or indicate incomplete review")
        mask = np.zeros((height, width), np.uint8)
        for shape in shapes:
            if shape.get("shape_type", "polygon") != "polygon":
                raise ValueError(f"{path.name}: only polygon shapes are supported")
            points = np.rint(np.array(shape["points"], dtype=np.float32)).astype(np.int32)
            if len(points) < 3:
                raise ValueError(f"{path.name}: polygon has fewer than three points")
            cv2.fillPoly(mask, [points], 255)
        destination = args.output / f"{path.stem}.png"
        cv2.imwrite(str(destination), mask)
        records.append({
            "json": path.name, "mask": destination.name, "polygons": len(shapes),
            "foreground_area_px": int((mask > 0).sum()),
            "no_visible_flame": bool(flags.get("no_visible_flame", False)),
            "uncertain_boundary": bool(flags.get("uncertain_boundary", False)),
            "mask_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        })
    if not records:
        raise ValueError("No LabelMe JSON files found")
    (args.output / "conversion-manifest.json").write_text(json.dumps({
        "schema": "falmex-labelme-mask-conversion-v1", "frames": len(records),
        "reviewer_identity_not_inferred": True, "frames_detail": records,
    }, indent=2), encoding="utf-8")
    print(json.dumps({"frames": len(records), "positive": sum(r["foreground_area_px"] > 0 for r in records),
                      "uncertain": sum(r["uncertain_boundary"] for r in records)}, indent=2))


if __name__ == "__main__":
    main()
