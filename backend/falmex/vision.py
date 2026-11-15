"""Flame footage -> quantitative flame metrics (morphology + colour), frame by frame.

What is measured, and what it means:

- **Circularity Ψ = 4πA / P²** of the projected flame outline (1.0 = a perfect circle).
  Footage is 2-D, so this is the circularity of the projection, a proxy for sphericity:
  a spherical flame always projects as a circle, but a circle does not prove a sphere.
- **Equivalent radius R = sqrt(A / π)** and its growth rate **dR/dt** (least-squares slope
  over the frames where a flame is present). If the flame disappears before the recording
  ends, the radius at the last flame frame is reported as the **extinction radius**.
- **Blue fraction / soot-to-blue ratio**: share of saturated flame pixels whose hue is blue
  (typical of CH*/C2* chemiluminescence) versus yellow-orange-red (typical of glowing soot).
  This is a *chromatic proxy from an uncalibrated camera*, not radiometry: white balance,
  exposure and sensor saturation change it. Saturated white pixels are counted separately.

Lengths are in pixels unless a calibration (mm per pixel) is given. Time comes from the
video's frame rate unless overridden (high-speed footage is often stored at a playback rate).
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MAX_ANALYZED = 600  # frames; longer videos are sampled evenly
MAX_OVERLAY = 90  # frames saved as JPEG for the overlay player
OVERLAY_WIDTH = 720
HEAT_COLS = 24
MIN_AREA_SHARE = 0.0002  # contours smaller than this share of the frame are noise
MAX_AREA_SHARE = 0.5  # a "flame" filling half the frame is a bright background, not a flame
BACKGROUND_SHARE = 0.75  # background median must stay below this share of the threshold
SAT_MIN = 60  # below this saturation a pixel has no reliable hue
BLUE_HUE = (90, 135)  # OpenCV hue scale 0-180
SOOT_HUES = ((0, 35), (165, 180))  # red, orange, yellow
VIDEO_EXT = {".mp4", ".avi", ".mov"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


@dataclass
class Calibration:
    fps: float | None = None  # overrides the frame rate stored in the file
    mm_per_px: float | None = None


def _frames(path: Path):
    """Yield (index, BGR frame) for every analyzed frame, plus the frame rate."""
    ext = path.suffix.lower()
    if ext in IMAGE_EXT:
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not read the image")
        return [(0, img)], None, 1
    if ext not in VIDEO_EXT:
        raise ValueError(f"Not an image or video file: {path.name}")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Could not open the video")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps = cap.get(cv2.CAP_PROP_FPS) or None
    stride = max(1, int(np.ceil(total / MAX_ANALYZED))) if total else 1
    out, i = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % stride == 0:
            out.append((i, frame))
        i += 1
    cap.release()
    if not out:
        raise ValueError("The video has no readable frames")
    return out, fps, i


def _threshold(frames: list[np.ndarray]) -> float:
    """One brightness threshold for the whole clip: Otsu on the brightest frame, so dark
    frames (before ignition, after extinction) are not forced to contain a 'flame'."""
    brightest = max(frames, key=lambda f: float(np.percentile(f.max(axis=2), 99.5)))
    v = brightest.max(axis=2)
    t, _ = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return max(float(t), 40.0)


def _not_a_flame(v: np.ndarray, mask: np.ndarray, c, area: float, thresh: float) -> str | None:
    """Flames are imaged as a luminous region on a darker scene. Screenshots, slides and
    daylight photos are bright almost everywhere, and thresholding them outlines the page."""
    h, w = v.shape
    if area > MAX_AREA_SHARE * h * w:
        return "the bright region fills most of the frame (a page or lit scene, not a flame)"
    x, y, bw, bh = cv2.boundingRect(c)
    edges = (x <= 1) + (y <= 1) + (x + bw >= w - 1) + (y + bh >= h - 1)
    if edges >= 3:
        return "the bright region touches the frame edges on three or more sides"
    outside = v[mask == 0]
    if outside.size and float(np.median(outside)) > BACKGROUND_SHARE * thresh:
        return "the background is nearly as bright as the brightest region"
    return None


def _measure(frame: np.ndarray, thresh: float) -> dict:
    h, w = frame.shape[:2]
    v = frame.max(axis=2)
    mask = (v > thresh).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = [c for c in contours if cv2.contourArea(c) >= MIN_AREA_SHARE * h * w]
    if not contours:
        return {"present": False}
    c = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(c))
    reason = _not_a_flame(v, mask, c, area, thresh)
    if reason:
        return {"present": False, "rejected": reason}
    # a slightly simplified outline: the raw pixel staircase overstates the perimeter
    smooth = cv2.approxPolyDP(c, 1.0, True)
    perimeter = float(cv2.arcLength(smooth, True))
    circularity = min(1.0, 4 * np.pi * area / perimeter**2) if perimeter > 0 else None
    m = cv2.moments(c)
    cx, cy = (m["m10"] / m["m00"], m["m01"] / m["m00"]) if m["m00"] else (None, None)
    x, y, bw, bh = cv2.boundingRect(c)
    aspect = None
    if len(c) >= 5:
        (_, _), (a1, a2), _ = cv2.fitEllipse(c)
        aspect = round(min(a1, a2) / max(a1, a2), 4) if max(a1, a2) > 0 else None

    # colour classes inside the flame region
    flame = np.zeros((h, w), np.uint8)
    cv2.drawContours(flame, [c], -1, 1, thickness=-1)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hue, sat = hsv[..., 0], hsv[..., 1]
    inside = flame.astype(bool)
    coloured = inside & (sat >= SAT_MIN)
    blue = coloured & (hue >= BLUE_HUE[0]) & (hue <= BLUE_HUE[1])
    soot = coloured & np.logical_or.reduce([(hue >= a) & (hue <= b) for a, b in SOOT_HUES])
    n_in = int(inside.sum())
    n_blue, n_soot = int(blue.sum()), int(soot.sum())
    saturated = inside & (sat < SAT_MIN) & (v >= 250)

    # coarse heat maps (share of each cell's flame pixels that are blue / sooty)
    rows = max(1, round(HEAT_COLS * h / w))
    heat_blue, heat_soot = [], []
    for r in range(rows):
        y0, y1 = r * h // rows, (r + 1) * h // rows
        rb, rs = [], []
        for col in range(HEAT_COLS):
            x0, x1 = col * w // HEAT_COLS, (col + 1) * w // HEAT_COLS
            cell = inside[y0:y1, x0:x1].sum()
            rb.append(round(float(blue[y0:y1, x0:x1].sum() / cell), 2) if cell else 0)
            rs.append(round(float(soot[y0:y1, x0:x1].sum() / cell), 2) if cell else 0)
        heat_blue.append(rb)
        heat_soot.append(rs)

    step = max(1, len(smooth) // 80)
    return {
        "present": True,
        "area_px": area,
        "perimeter_px": round(perimeter, 2),
        "radius_px": round(float(np.sqrt(area / np.pi)), 3),
        "circularity": round(circularity, 4) if circularity is not None else None,
        "aspect_ratio": aspect,
        "centroid": [round(cx, 2), round(cy, 2)] if cx is not None else None,
        "bbox": [int(x), int(y), int(bw), int(bh)],
        "contour": smooth[::step, 0, :].tolist(),
        "blue_fraction": round(n_blue / n_in, 4) if n_in else None,
        "soot_fraction": round(n_soot / n_in, 4) if n_in else None,
        "saturated_fraction": round(int(saturated.sum()) / n_in, 4) if n_in else None,
        "soot_to_blue": round(n_soot / n_blue, 4) if n_blue else None,
        "heat_blue": heat_blue,
        "heat_soot": heat_soot,
    }


def analyze(path: Path, out_dir: Path, calibration: Calibration | None = None) -> dict:
    """Measure every analyzed frame, save overlay frames as JPEG, return the analysis."""
    cal = calibration or Calibration()
    sampled, file_fps, n_total = _frames(path)
    fps = cal.fps or file_fps
    thresh = _threshold([f for _, f in sampled])
    h, w = sampled[0][1].shape[:2]

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("frame_*.jpg"):
        old.unlink()
    keep = set(np.linspace(0, len(sampled) - 1, min(MAX_OVERLAY, len(sampled))).astype(int))
    scale = min(1.0, OVERLAY_WIDTH / w)

    frames, saved = [], 0
    for k, (idx, img) in enumerate(sampled):
        m = _measure(img, thresh)
        m.update(index=idx, time_s=round(idx / fps, 6) if fps else None)
        if k in keep:
            name = f"frame_{saved:04d}.jpg"
            saved += 1
            small = cv2.resize(img, (round(w * scale), round(h * scale))) if scale < 1 else img
            cv2.imwrite(str(out_dir / name), small, [cv2.IMWRITE_JPEG_QUALITY, 85])
            m["image"] = name
        frames.append(m)
    return {
        "frame_size": [w, h],
        "overlay_scale": scale,
        "frames_total": n_total,
        "frames_analyzed": len(frames),
        "fps": fps,
        "fps_source": "override" if cal.fps else ("file" if file_fps else None),
        "mm_per_px": cal.mm_per_px,
        "threshold": thresh,
        "summary": summarize(frames, fps, cal.mm_per_px),
        "frames": frames,
        "method": __doc__.strip(),
    }


def summarize(frames: list[dict], fps: float | None, mm_per_px: float | None) -> dict:
    lit = [f for f in frames if f.get("present")]
    unit = "mm" if mm_per_px else "px"
    k = mm_per_px or 1.0
    out: dict = {"length_unit": unit, "flame_frames": len(lit), "frames": len(frames)}
    if not lit:
        reasons = sorted({f["rejected"] for f in frames if f.get("rejected")})
        out["note"] = ("This does not look like flame footage: " + "; ".join(reasons) + "."
                       if reasons else "No flame was found in any analyzed frame.")
        return out

    def med(key):
        vals = [f[key] for f in lit if f.get(key) is not None]
        return round(float(np.median(vals)), 4) if vals else None

    out.update(
        circularity_median=med("circularity"),
        aspect_ratio_median=med("aspect_ratio"),
        blue_fraction_median=med("blue_fraction"),
        soot_fraction_median=med("soot_fraction"),
        saturated_fraction_median=med("saturated_fraction"),
        max_radius=round(max(f["radius_px"] for f in lit) * k, 4),
    )
    blue, soot = out["blue_fraction_median"], out["soot_fraction_median"]
    out["soot_to_blue_ratio"] = round(soot / blue, 4) if blue else None

    last = max(range(len(frames)), key=lambda i: i if frames[i].get("present") else -1)
    extinguished = last < len(frames) - 1
    out["extinguished_in_clip"] = extinguished
    if extinguished:
        out["extinction_radius"] = round(frames[last]["radius_px"] * k, 4)
        out["extinction_time_s"] = frames[last]["time_s"]

    if fps and len(lit) >= 3:
        # growth up to the largest flame: after that the flame shrinks towards extinction
        peak = max(range(len(lit)), key=lambda i: lit[i]["radius_px"])
        grow = lit[: peak + 1]
        if len(grow) >= 3:
            t = np.array([f["time_s"] for f in grow])
            r = np.array([f["radius_px"] for f in grow]) * k
            slope, intercept = np.polyfit(t, r, 1)
            pred = slope * t + intercept
            ss = float(((r - r.mean()) ** 2).sum())
            out["growth_rate"] = round(float(slope), 5)
            out["growth_rate_unit"] = f"{unit}/s"
            out["growth_fit_r2"] = round(1 - float(((r - pred) ** 2).sum()) / ss, 4) if ss else None
            out["growth_frames"] = len(grow)
    elif not fps:
        out["note"] = "No frame rate: growth rate needs one (set fps)."
    return out


def synthetic_clip(path: Path, frames: int = 72, size: int = 360, fps: float = 24.0) -> None:
    """SYNTHETIC test footage (not NASA): a flame that grows at a known rate, is a blue shell
    around a sooty yellow core, stretches slightly, then shrinks and goes out. Known ground
    truth for testing the pipeline."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (size, size))
    rng = np.random.default_rng(3)
    for i in range(frames):
        img = np.zeros((size, size, 3), np.uint8)
        t = i / fps
        if i < 54:  # growth: R = 20 + 40 px/s · t
            r = 20 + 40 * t
        else:  # shrinks, then extinction after frame 62
            r = 20 + 40 * (53 / fps) - 12 * (i - 53)
        if i <= 62 and r > 3:
            center = (size // 2, size // 2 + 10)
            axes = (int(r), int(r * (1.0 + 0.004 * i)))  # slowly elongates
            cv2.ellipse(img, center, axes, 0, 0, 360, (255, 140, 40), -1)  # blue (BGR)
            cv2.ellipse(img, center, (int(r * 0.55), int(r * 0.55 * (1.0 + 0.004 * i))),
                        0, 0, 360, (40, 190, 255), -1)  # yellow-orange core
        noise = rng.normal(0, 4, img.shape)
        writer.write(np.clip(img + noise, 0, 255).astype(np.uint8))
    writer.release()
