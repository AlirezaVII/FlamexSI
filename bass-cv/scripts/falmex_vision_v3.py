#!/usr/bin/env python3
"""Falmex Vision v3: supervised segmentation with boundary hard negatives.

Commands:
  development-train: grouped development evaluation, then fit/freeze final model
  predict-video: apply a frozen model to selected video frames without retraining
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier

FEATURE_NAMES = [
    "x", "y", "R", "G", "B", "mean_rgb", "channel_range", "red_excess",
    "green_excess", "S", "V", "hue_sin", "hue_cos", "Lab_L", "Lab_a",
    "Lab_b", "chrom_R", "chrom_G", "chrom_B", "V_frame_norm",
    "R_frame_norm", "V_local", "V_minus_local", "S_blur", "red_excess_blur",
]
CONFIG = {
    "schema": "falmex-vision-v3",
    "target": "visibly luminous flame regions",
    "n_estimators": 60,
    "max_depth": 20,
    "min_samples_leaf": 8,
    "max_features": "sqrt",
    "class_weight": "balanced",
    "random_state": 42,
    "reference_frames": 30,
    "negative_random_samples_per_frame": 2000,
    "negative_hard_samples_per_frame": 4000,
    "negative_boundary_samples_per_frame": 4000,
    "boundary_dilation_kernel": 41,
    "probability_threshold": 0.5,
    "temporal_gate": 0.05,
    "probability_blur_sigma": 1.2,
    "min_component_area": 50,
}
DEVELOPMENT_TESTS = ("B1", "B2", "B3", "B4", "B5", "B7")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def video_path(root: Path, test_id: str) -> Path:
    matches = sorted((root / "raw").glob(f"*_TEST_{test_id}.mp4"))
    if len(matches) != 1:
        raise ValueError(f"Expected one raw video for {test_id}, found {len(matches)}")
    return matches[0]


def reference_frame(video: Path, count: int = 30) -> np.ndarray:
    capture = cv2.VideoCapture(str(video))
    images = []
    for _ in range(count):
        ok, image = capture.read()
        if not ok:
            break
        images.append(image)
    capture.release()
    if not images:
        raise ValueError(f"No reference frames readable from {video}")
    return np.median(np.stack(images), axis=0).astype(np.uint8)


def read_frame(video: Path, index: int) -> np.ndarray:
    capture = cv2.VideoCapture(str(video))
    capture.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, image = capture.read()
    capture.release()
    if not ok or image is None:
        raise ValueError(f"Cannot read frame {index} from {video}")
    return image


def features(image: np.ndarray) -> np.ndarray:
    """25 spatial/color/illumination features; no annotation-derived input."""
    height, width = image.shape[:2]
    blue, green, red = [x.astype(np.float32) / 255 for x in cv2.split(image)]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = [x.astype(np.float32) for x in cv2.split(hsv)]
    saturation /= 255
    value /= 255
    hue = hue / 180 * 2 * np.pi
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32) / 255
    total = red + green + blue + 1e-4
    value_255 = value * 255
    red_255 = red * 255
    value_scale = np.percentile(value_255, 99) + 1
    red_scale = np.percentile(red_255, 99) + 1
    value_local = cv2.GaussianBlur(value, (0, 0), 5)
    red_excess = red - (green + blue) / 2
    green_excess = green - (red + blue) / 2
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    layers = [
        xx / (width - 1), yy / (height - 1), red, green, blue,
        (red + green + blue) / 3,
        np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue]),
        red_excess, green_excess, saturation, value, np.sin(hue), np.cos(hue),
        lab[:, :, 0], lab[:, :, 1], lab[:, :, 2], red / total, green / total,
        blue / total, value_255 / value_scale, red_255 / red_scale, value_local,
        value - value_local, cv2.GaussianBlur(saturation, (0, 0), 3),
        cv2.GaussianBlur(red_excess, (0, 0), 3),
    ]
    return np.stack(layers, axis=-1).astype(np.float32)


def new_model() -> ExtraTreesClassifier:
    return ExtraTreesClassifier(
        n_estimators=CONFIG["n_estimators"], max_depth=CONFIG["max_depth"],
        min_samples_leaf=CONFIG["min_samples_leaf"],
        max_features=CONFIG["max_features"], n_jobs=-1,
        random_state=CONFIG["random_state"], class_weight=CONFIG["class_weight"],
    )


def training_sample(feature_map: np.ndarray, gt: np.ndarray, rng: np.random.Generator):
    positive = np.flatnonzero(gt.ravel())
    negative = np.flatnonzero((gt == 0).ravel())
    hard = np.flatnonzero(((gt == 0) & (
        (feature_map[:, :, 9] > 0.12) | (feature_map[:, :, 7] > 0.04) |
        (feature_map[:, :, 10] > 0.16))).ravel())
    random_negative = rng.choice(
        negative, min(CONFIG["negative_random_samples_per_frame"], len(negative)), replace=False)
    hard_negative = rng.choice(
        hard, min(CONFIG["negative_hard_samples_per_frame"], len(hard)), replace=False
    ) if len(hard) else np.array([], dtype=int)
    kernel_size = CONFIG["boundary_dilation_kernel"]
    boundary = (cv2.dilate(gt, np.ones((kernel_size, kernel_size), np.uint8)) > 0) & (gt == 0)
    boundary_indices = np.flatnonzero(boundary.ravel())
    boundary_negative = rng.choice(
        boundary_indices,
        min(CONFIG["negative_boundary_samples_per_frame"], len(boundary_indices)),
        replace=False,
    ) if len(boundary_indices) else np.array([], dtype=int)
    negative_selected = np.unique(np.r_[random_negative, hard_negative, boundary_negative])
    indices = np.r_[positive, negative_selected]
    X = feature_map.reshape(-1, feature_map.shape[-1])[indices]
    y = np.r_[np.ones(len(positive), np.uint8), np.zeros(len(negative_selected), np.uint8)]
    return X, y


def postprocess(probability: np.ndarray) -> np.ndarray:
    probability = cv2.GaussianBlur(probability, (0, 0), CONFIG["probability_blur_sigma"])
    mask = (probability >= CONFIG["probability_threshold"]).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    output = np.zeros_like(mask)
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= CONFIG["min_component_area"]:
            output[labels == label] = 1
    return output


def predict(model: ExtraTreesClassifier, image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    feature_map = features(image)
    height, width = image.shape[:2]
    probability = model.predict_proba(
        feature_map.reshape(-1, feature_map.shape[-1]))[:, 1].reshape(height, width)
    difference = np.max(np.abs(
        image.astype(np.float32) - reference.astype(np.float32)), axis=2) / 255
    probability *= np.clip(difference / CONFIG["temporal_gate"], 0, 1)
    return postprocess(probability)


def counts(gt: np.ndarray, prediction: np.ndarray):
    gt_bool = gt.astype(bool)
    pred_bool = prediction.astype(bool)
    return {
        "tp": int(np.count_nonzero(gt_bool & pred_bool)),
        "fp": int(np.count_nonzero(~gt_bool & pred_bool)),
        "fn": int(np.count_nonzero(gt_bool & ~pred_bool)),
    }


def centroid(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    return np.array([xs.mean(), ys.mean()]) if len(xs) else None


def frame_metrics(frame, prediction: np.ndarray):
    gt = frame["gt"]
    c = counts(gt, prediction)
    tp, fp, fn = c["tp"], c["fp"], c["fn"]
    gt_area = int(gt.sum())
    pred_area = int(prediction.sum())
    union = tp + fp + fn
    dice_denominator = 2 * tp + fp + fn
    gt_centroid, pred_centroid = centroid(gt), centroid(prediction)
    return {
        "test_id": frame["test_id"], "frame": frame["name"],
        "frame_index": int(frame["frame_index"]), "time_s": float(frame["time_s"]),
        "flame_visible": bool(gt_area), "gt_area_px": gt_area, "pred_area_px": pred_area,
        **c, "iou": float(tp / union) if union else None,
        "dice": float(2 * tp / dice_denominator) if dice_denominator else None,
        "centroid_error_px": float(np.linalg.norm(gt_centroid - pred_centroid))
            if gt_centroid is not None and pred_centroid is not None else None,
        "absolute_relative_area_error": float(abs(pred_area - gt_area) / gt_area) if gt_area else None,
    }


def ratio(a, b):
    return float(a / b) if b else None


def summarize(rows):
    positive = [r for r in rows if r["flame_visible"]]
    negative = [r for r in rows if not r["flame_visible"]]
    tp, fp, fn = [int(sum(r[k] for r in rows)) for k in ("tp", "fp", "fn")]
    centroids = [r["centroid_error_px"] for r in positive if r["centroid_error_px"] is not None]
    return {
        "frames": len(rows), "positive_frames": len(positive), "negative_frames": len(negative),
        "tp": tp, "fp": fp, "fn": fn,
        "micro_iou": ratio(tp, tp + fp + fn), "micro_dice": ratio(2 * tp, 2 * tp + fp + fn),
        "micro_precision": ratio(tp, tp + fp), "micro_recall": ratio(tp, tp + fn),
        "positive_macro_iou": float(np.mean([r["iou"] for r in positive])) if positive else None,
        "positive_macro_dice": float(np.mean([r["dice"] for r in positive])) if positive else None,
        "positive_detection_failures": sum(r["pred_area_px"] == 0 for r in positive),
        "negative_frames_with_false_positive": sum(r["pred_area_px"] > 0 for r in negative),
        "negative_false_positive_pixels": int(sum(r["fp"] for r in negative)),
        "median_centroid_error_px_when_detected": float(np.median(centroids)) if centroids else None,
        "median_absolute_relative_area_error_positive": float(np.median(
            [r["absolute_relative_area_error"] for r in positive])) if positive else None,
    }


def overlay(image, gt, prediction):
    gt_bool, pred_bool = gt.astype(bool), prediction.astype(bool)
    marked = image.copy()
    marked[gt_bool & pred_bool] = (0, 220, 0)
    marked[~gt_bool & pred_bool] = (0, 0, 255)
    marked[gt_bool & ~pred_bool] = (255, 0, 0)
    return cv2.addWeighted(image, 0.45, marked, 0.55, 0)


def load_development(root: Path):
    selection = json.loads((root / "frames/selection.json").read_text())
    selection += json.loads((root / "confirmation/selection.json").read_text())
    frames = []
    for row in selection:
        if row["test_id"] not in DEVELOPMENT_TESTS:
            continue
        image = cv2.imread(str(root / row["file"]))
        gt = (cv2.imread(str(root / row["mask"]), 0) > 0).astype(np.uint8)
        if image is None or (gt.shape != image.shape[:2]):
            raise ValueError(f"Invalid development input {row['file']}")
        frames.append({**row, "name": Path(row["file"]).name, "image": image, "gt": gt})
    references = {test: reference_frame(video_path(root, test), CONFIG["reference_frames"])
                  for test in DEVELOPMENT_TESTS}
    return selection, frames, references


def development_train(root: Path):
    selection, frames, references = load_development(root)
    output = root / "vision-v3"
    (output / "development-overlays").mkdir(parents=True, exist_ok=True)
    (output / "models").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(CONFIG["random_state"])
    samples = {f["name"]: training_sample(features(f["image"]), f["gt"], rng) for f in frames}
    rows = []
    for holdout in DEVELOPMENT_TESTS:
        X = np.concatenate([samples[f["name"]][0] for f in frames if f["test_id"] != holdout])
        y = np.concatenate([samples[f["name"]][1] for f in frames if f["test_id"] != holdout])
        model = new_model().fit(X, y)
        for frame in frames:
            if frame["test_id"] != holdout:
                continue
            prediction = predict(model, frame["image"], references[holdout])
            rows.append(frame_metrics(frame, prediction))
            cv2.imwrite(str(output / "development-overlays" / frame["name"]),
                        overlay(frame["image"], frame["gt"], prediction))
    per_test = {test: summarize([r for r in rows if r["test_id"] == test]) for test in DEVELOPMENT_TESTS}
    development = {
        "schema": "falmex-vision-v3-development-metrics-v1",
        "status": "model-selection estimate; optimistic because v3 choices used these same six development tests",
        "split": "leave-one-test-out over B1/B2/B3/B4/B5/B7",
        "config": CONFIG, "per_test": per_test, "pooled": summarize(rows),
    }
    (output / "development-metrics.json").write_text(json.dumps(development, indent=2), encoding="utf-8")
    (output / "development-per-frame.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    final_model = new_model().fit(
        np.concatenate([samples[f["name"]][0] for f in frames]),
        np.concatenate([samples[f["name"]][1] for f in frames]))
    bundle = {
        "model": final_model, "config": CONFIG, "feature_names": FEATURE_NAMES,
        "development_tests": DEVELOPMENT_TESTS,
        "training_frames": [f["name"] for f in frames],
        "annotation_scope": "coarse AI-assistant polygons, not independent-expert gold masks",
    }
    model_path = output / "models/falmex-vision-v3.joblib"
    joblib.dump(bundle, model_path)
    freeze = {
        "schema": "falmex-vision-v3-freeze-v1", "created_utc": datetime.now(timezone.utc).isoformat(),
        "model_file": str(model_path.relative_to(root)), "model_sha256": sha256(model_path),
        "config": CONFIG, "feature_names": FEATURE_NAMES,
        "development_tests": DEVELOPMENT_TESTS, "reserved_confirmation_tests": ["B6", "B8", "B12"],
        "confirmation_status": "not yet predicted or inspected at freeze time",
        "development_input_sha256": {
            "frames/selection.json": sha256(root / "frames/selection.json"),
            "annotations/polygons.json": sha256(root / "annotations/polygons.json"),
            "confirmation/selection.json": sha256(root / "confirmation/selection.json"),
            "confirmation/annotations/polygons.json": sha256(root / "confirmation/annotations/polygons.json"),
            "scripts/falmex_vision_v3.py": sha256(Path(__file__).resolve()),
        },
        "software": {"python": platform.python_version(), "numpy": np.__version__,
                     "opencv": cv2.__version__},
    }
    (output / "model-freeze.json").write_text(json.dumps(freeze, indent=2), encoding="utf-8")
    print(json.dumps({"development": development["pooled"], "per_test": per_test,
                      "model_sha256": freeze["model_sha256"]}, indent=2))


def predict_video(root: Path, args):
    freeze = json.loads((root / "vision-v3/model-freeze.json").read_text())
    model_path = root / freeze["model_file"]
    if sha256(model_path) != freeze["model_sha256"]:
        raise ValueError("Frozen model hash mismatch; refusing prediction")
    bundle = joblib.load(model_path)
    if bundle["config"] != CONFIG:
        raise ValueError("Inference code configuration differs from frozen model")
    video = Path(args.video).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    reference = reference_frame(video, CONFIG["reference_frames"])
    records = []
    for index in [int(x) for x in args.frames.split(",") if x.strip()]:
        image = read_frame(video, index)
        prediction = predict(bundle["model"], image, reference)
        name = f"{args.test_id}_{index:06d}.png"
        cv2.imwrite(str(output / name), prediction * 255)
        marked = image.copy()
        marked[prediction > 0] = (0, 0, 255)
        cv2.imwrite(str(output / f"{args.test_id}_{index:06d}_prediction.png"),
                    cv2.addWeighted(image, 0.45, marked, 0.55, 0))
        records.append({"test_id": args.test_id, "frame_index": index, "mask": name,
                        "prediction_area_px": int(prediction.sum())})
    (output / "predictions.json").write_text(json.dumps({
        "model_sha256": freeze["model_sha256"], "video": video.name,
        "video_sha256": sha256(video), "frames": records}, indent=2), encoding="utf-8")
    print(json.dumps({"test_id": args.test_id, "frames": len(records),
                      "model_sha256": freeze["model_sha256"]}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("development-train")
    predict_parser = sub.add_parser("predict-video")
    predict_parser.add_argument("--video", required=True)
    predict_parser.add_argument("--test-id", required=True)
    predict_parser.add_argument("--frames", required=True, help="comma-separated zero-based indices")
    predict_parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "development-train":
        development_train(root)
    else:
        predict_video(root, args)


if __name__ == "__main__":
    main()
