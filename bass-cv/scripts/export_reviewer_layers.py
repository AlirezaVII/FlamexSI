"""Build human-only disagreement layers and pixel counts from the two original references."""
import csv
import json
from pathlib import Path

import cv2
import numpy as np

from export_reference_comparison import REVIEW, ROOT, WEB, read_mask


def main():
    manifest = json.loads((ROOT / "independent-review-v6/manifest.json").read_text())
    out = WEB / "public/bass-review"
    out.mkdir(exist_ok=True, parents=True)
    rows = []
    for frame in manifest["frames"]:
        name = frame["anonymous_id"]
        key = name.split("_", 1)[1]
        shape = (frame["height"], frame["width"])
        a = read_mask(REVIEW / "masks-A" / name, shape)
        b = read_mask(REVIEW / "masks-B" / name, shape)
        # OpenCV stores blue, green, red and alpha in that order.
        layer = np.zeros((*shape, 4), dtype=np.uint8)
        layer[a & ~b] = (255, 85, 45, 205)
        layer[b & ~a] = (45, 45, 240, 205)
        layer[a & b] = (65, 220, 75, 205)
        if not cv2.imwrite(str(out / f"{Path(key).stem}-AB.png"), layer):
            raise OSError(key)
        rows.append((key, int(a.sum()), int(b.sum()), int((a & ~b).sum()),
                     int((b & ~a).sum()), int((a & b).sum())))
    with (REVIEW / "reviewer-areas.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frame", "area_A", "area_B", "A_only", "B_only", "overlap"])
        writer.writerows(rows)


if __name__ == "__main__":
    main()
