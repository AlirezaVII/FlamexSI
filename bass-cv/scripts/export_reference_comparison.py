"""Export frozen-mask sensitivity statistics and source-aligned images for the dashboard."""
import csv
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CONF = ROOT / "confirmation-v6"
REVIEW = ROOT / "independent-review-results-v6"
WEB = ROOT.parent / "frontend"
VERSIONS = ("v3", "v4", "v5", "v6")


def read_mask(path, shape):
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != shape or not np.isin(image, [0, 255]).all():
        raise ValueError(f"Invalid binary mask: {path}")
    return image > 0


def main():
    images = WEB / "public" / "bass-review"
    images.mkdir(exist_ok=True)
    frames = json.loads((ROOT / "independent-review-v6/manifest.json").read_text())["frames"]
    rows = []
    for frame in frames:
        anonymous = frame["anonymous_id"]
        name = anonymous.split("_", 1)[1]
        source = cv2.imread(str(CONF / "source-frames" / name))
        shape = (frame["height"], frame["width"])
        if source is None or source.shape[:2] != shape:
            raise ValueError(f"Invalid source: {name}")
        refs = {"Initial": CONF / "annotations/masks" / name,
                "A": REVIEW / "masks-A" / anonymous, "B": REVIEW / "masks-B" / anonymous}
        views = {"Source": source}
        for reference, path in refs.items():
            ref = read_mask(path, shape)
            for version in VERSIONS:
                pred = read_mask(CONF / "frozen-predictions" / version / frame["test_id"] / name, shape)
                tp = int((pred & ref).sum())
                fp = int(pred.sum()) - tp
                fn = int(ref.sum()) - tp
                rows.append(dict(frame=name, model=version, reference=reference, tp=tp, fp=fp, fn=fn))
                if version == "v6":
                    overlay = source.copy()
                    overlay[pred & ~ref] = (63, 132, 255)
                    overlay[ref & ~pred] = (255, 180, 65)
                    overlay[ref & pred] = (94, 225, 60)
                    views[reference] = cv2.addWeighted(source, .25, overlay, .75, 0)
        for label, image in views.items():
            if not cv2.imwrite(str(images / f"{Path(name).stem}-{label}.webp"), image,
                               [cv2.IMWRITE_WEBP_QUALITY, 101]):
                raise OSError(name)
    with (REVIEW / "reference-comparison.csv").open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    summary = []
    for version in VERSIONS:
        for ref in ("Initial", "A", "B"):
            selected = [row for row in rows if row["model"] == version and row["reference"] == ref]
            tp, fp, fn = (sum(row[k] for row in selected) for k in ("tp", "fp", "fn"))
            union = tp + fp + fn
            summary.append(dict(model=version, reference=ref, tp=tp, fp=fp, fn=fn,
                                iou=tp / union if union else None))
    output = WEB / "src/lib/bass-review.json"
    output.write_text(json.dumps({"frames": [r["anonymous_id"].split("_", 1)[1][:-4] for r in frames],
                                 "summary": summary}, indent=2) + "\n")


if __name__ == "__main__":
    main()
