"""OpenCV flame segmentation for the 24 reserved BASS-II frames (no learning).

Per video, the background is the per-pixel median of its reserved frames (labels never used),
so static handrails, screens and LEDs cancel out. Bright, changed, warm (red >= blue) pixels
seed the mask; connected dimmer pixels that also changed are added (hysteresis); small
components are dropped and the rest optionally grown. Parameters are chosen
leave-one-video-out: two videos' labels pick them, the third video is scored, separately for
reviewer A, reviewer B and the initial reference. Score: pooled (micro) IoU.
Result (2026-11-13): A 0.532, B 0.379, initial 0.324; human A vs B agreement is 0.257.
Usage: python scripts/opencv_flame_v3.py <bass-cv folder>   (writes scripts/v3_out/)"""
import itertools, json, sys
from pathlib import Path
import cv2, numpy as np
ROOT = Path(sys.argv[1]); FR = ROOT / "confirmation-v6/source-frames"
names = sorted(p.stem for p in FR.glob("*.png"))
img = {n: cv2.imread(str(FR / f"{n}.png")).astype(np.int16) for n in names}
ref = {r: {p.stem.split("_", 1)[1]: cv2.imread(str(p), 0) > 0 for p in (ROOT / f"independent-review-results-v6/masks-{r}").glob("*.png")} for r in "AB"}
ref["Initial"] = {p.stem: cv2.imread(str(p), 0) > 0 for p in (ROOT / "confirmation-v6/annotations/masks").glob("*.png")}
bg = {v: np.median(np.stack([img[n] for n in names if n.startswith(v)]), axis=0) for v in ("B14", "B17", "B18")}
F = {}
for n in names:
    im = img[n]; F[n] = (im.max(axis=2), np.abs(im - bg[n[:3]]).max(axis=2), im[..., 2] - im[..., 0])
def segment(n, th, tl, d, a, r):
    v, diff, warm = F[n]
    low = ((v >= tl) & (diff >= d * 0.5) & (warm >= -10)).astype(np.uint8)
    seed = (v >= th) & ((diff >= d) | (v >= 250)) & (warm >= 0)
    k, lab, st, _ = cv2.connectedComponentsWithStats(low, 8)
    ids = np.unique(lab[seed & (low > 0)]); ids = ids[ids > 0]
    ids = [i for i in ids if st[i, cv2.CC_STAT_AREA] >= a]
    m = np.isin(lab, ids).astype(np.uint8)
    if r: m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1,) * 2))
    return m > 0
def counts(fr, R, p):
    tp = fp = fn = 0
    for n in fr:
        pr, gt = segment(n, *p), R[n]; tp += int((pr & gt).sum()); fp += int((pr & ~gt).sum()); fn += int((~pr & gt).sum())
    return tp, fp, fn
iou = lambda c: c[0] / sum(c) if sum(c) else 0.0
GRID = [p for p in itertools.product([190, 230, 245], [40, 60, 90, 120, 150, 180], [60, 90, 120, 150, 180], [25, 50, 100], [0, 3, 6]) if p[1] < p[0]]
OUT = Path(__file__).with_name("v3_out"); OUT.mkdir(exist_ok=True)
summary = []
for r in ("A", "B", "Initial"):
    tot = [0, 0, 0]; per = {}; ch = {}
    for test in ("B14", "B17", "B18"):
        tr = [n for n in names if not n.startswith(test)]
        best = max(GRID, key=lambda p: iou(counts(tr, ref[r], p)))
        c = counts([n for n in names if n.startswith(test)], ref[r], best)
        per[test] = round(iou(c), 4); ch[test] = best; tot = [x + y for x, y in zip(tot, c)]
    print(r, round(iou(tot), 4), per, ch)
    summary.append({"model": "OpenCV", "reference": r, "tp": tot[0], "fp": tot[1], "fn": tot[2],
                    "iou": iou(tot), "per_video": per, "params": {k: list(v) for k, v in ch.items()}})
    for test, p in ch.items():
        for n in (x for x in names if x.startswith(test)):
            pr, gt = segment(n, *p), ref[r][n]
            o = img[n].astype(np.float32).copy()
            for mask, col in ((pr & gt, (60, 200, 60)), (pr & ~gt, (0, 140, 255)), (~pr & gt, (255, 120, 40))):
                o[mask] = o[mask] * 0.35 + np.array(col) * 0.65
            cv2.imwrite(str(OUT / f"{n}-CV{r}.webp"), o.astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 82])
json.dump(summary, open(OUT / "summary.json", "w"), indent=1)
