#!/usr/bin/env python3
"""Falmex Vision v4: grouped comparison of ExtraTrees and LightGBM.

The v4 confirmation videos B9/B10/B11 are not read by training commands.
"""
from __future__ import annotations

import argparse
import gc
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import lightgbm as lgb
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier

from falmex_vision_v3 import (
    FEATURE_NAMES as BASE_FEATURE_NAMES,
    features as base_features,
    frame_metrics,
    overlay,
    read_frame,
    reference_frame,
    sha256,
    summarize,
)

DEVELOPMENT_TESTS = ("B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B12")
CONFIRMATION_TESTS = ("B9", "B10", "B11")
CANDIDATES = ("extra_trees", "lightgbm")
FEATURE_NAMES = BASE_FEATURE_NAMES + [
    "temporal_max_abs", "temporal_mean_abs", "temporal_V_diff",
    "temporal_red_excess_diff", "V_local_2", "V_minus_local_2", "V_std_2",
    "red_excess_local_5", "red_excess_minus_local_5", "S_local_5",
    "R_local_5", "R_minus_local_5", "reference_V", "reference_red_excess",
    "gradient_V",
]
CONFIG = {
    "schema": "falmex-vision-v4",
    "target": "visibly luminous flame regions",
    "random_state": 42,
    "reference_frames": 30,
    "negative_random_samples_per_frame": 1200,
    "negative_hard_samples_per_frame": 2400,
    "negative_boundary_samples_per_frame": 2400,
    "boundary_dilation_kernel": 41,
    "probability_threshold": 0.5,
    "temporal_gate": 0.05,
    "probability_blur_sigma": 1.2,
    "min_component_area": 50,
    "selection_rule": "highest pooled positive macro IoU; macro Dice breaks ties",
    "extra_trees": {
        "n_estimators": 40, "max_depth": 18, "min_samples_leaf": 10,
        "max_features": "sqrt", "class_weight": "balanced", "n_jobs": 2,
    },
    "lightgbm": {
        "n_estimators": 160, "learning_rate": 0.05, "num_leaves": 48,
        "max_depth": 12, "min_child_samples": 35, "subsample": 0.9,
        "subsample_freq": 1, "colsample_bytree": 0.85, "reg_alpha": 0.2,
        "reg_lambda": 2.0, "class_weight": "balanced", "n_jobs": 2,
    },
}


def video_path(root: Path, test_id: str) -> Path:
    matches = sorted((root / "raw").glob(f"*_TEST_{test_id}.mp4"))
    matches += sorted((root / "raw").glob(f"*_TEST{test_id}.mp4"))
    matches = [p for p in matches if "Still_Sequence" not in p.name and "2ND_VIEW" not in p.name]
    if len(matches) != 1:
        raise ValueError(f"Expected one raw video for {test_id}, found {len(matches)}")
    return matches[0]


def load_development(root: Path):
    selection = []
    for relative in ("frames/selection.json", "confirmation/selection.json", "confirmation-v3/selection.json"):
        selection += json.loads((root / relative).read_text(encoding="utf-8"))
    frames = []
    for row in selection:
        if row["test_id"] not in DEVELOPMENT_TESTS:
            continue
        image = cv2.imread(str(root / row["file"]))
        gt = (cv2.imread(str(root / row["mask"]), 0) > 0).astype(np.uint8)
        if image is None or gt.shape != image.shape[:2]:
            raise ValueError(f"Invalid development input {row['file']}")
        frames.append({**row, "name": Path(row["file"]).name, "image": image, "gt": gt})
    if len(frames) != 72:
        raise ValueError(f"Expected 72 development frames, found {len(frames)}")
    references = {
        test: reference_frame(video_path(root, test), CONFIG["reference_frames"])
        for test in DEVELOPMENT_TESTS
    }
    return selection, frames, references


def feature_map(image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    base = base_features(image)
    current = image.astype(np.float32) / 255
    ref = reference.astype(np.float32) / 255
    b, g, r = cv2.split(current)
    rb, rg, rr = cv2.split(ref)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1].astype(np.float32) / 255
    value = hsv[:, :, 2].astype(np.float32) / 255
    ref_hsv = cv2.cvtColor(reference, cv2.COLOR_BGR2HSV)
    ref_value = ref_hsv[:, :, 2].astype(np.float32) / 255
    red_excess = r - (g + b) / 2
    ref_red_excess = rr - (rg + rb) / 2
    absolute = np.abs(current - ref)
    v_local_2 = cv2.GaussianBlur(value, (0, 0), 2)
    v_mean_square = cv2.GaussianBlur(value * value, (0, 0), 2)
    v_std_2 = np.sqrt(np.maximum(v_mean_square - v_local_2 * v_local_2, 0))
    red_local = cv2.GaussianBlur(red_excess, (0, 0), 5)
    s_local = cv2.GaussianBlur(saturation, (0, 0), 5)
    r_local = cv2.GaussianBlur(r, (0, 0), 5)
    gradient_x = cv2.Sobel(value, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(value, cv2.CV_32F, 0, 1, ksize=3)
    extra = [
        np.max(absolute, axis=2), np.mean(absolute, axis=2), value - ref_value,
        red_excess - ref_red_excess, v_local_2, value - v_local_2, v_std_2,
        red_local, red_excess - red_local, s_local, r_local, r - r_local,
        ref_value, ref_red_excess, cv2.magnitude(gradient_x, gradient_y),
    ]
    return np.concatenate([base, np.stack(extra, axis=-1)], axis=2).astype(np.float32)


def training_sample(features: np.ndarray, gt: np.ndarray, rng: np.random.Generator):
    positive = np.flatnonzero(gt.ravel())
    negative = np.flatnonzero((gt == 0).ravel())
    hard = np.flatnonzero(((gt == 0) & (
        (features[:, :, 9] > 0.12) | (features[:, :, 7] > 0.04) |
        (features[:, :, 10] > 0.16))).ravel())
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
    X = features.reshape(-1, features.shape[-1])[indices]
    y = np.r_[np.ones(len(positive), np.uint8), np.zeros(len(negative_selected), np.uint8)]
    return X, y


def new_model(candidate: str):
    if candidate == "extra_trees":
        return ExtraTreesClassifier(
            **CONFIG[candidate], random_state=CONFIG["random_state"])
    return lgb.LGBMClassifier(
        **CONFIG[candidate], random_state=CONFIG["random_state"],
        verbosity=-1, deterministic=True, force_col_wise=True,
    )


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


def predict(model, image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    features = feature_map(image, reference)
    height, width = image.shape[:2]
    probability = model.predict_proba(
        features.reshape(-1, features.shape[-1]))[:, 1].reshape(height, width)
    difference = np.max(np.abs(
        image.astype(np.float32) - reference.astype(np.float32)), axis=2) / 255
    probability *= np.clip(difference / CONFIG["temporal_gate"], 0, 1)
    return postprocess(probability)


def prepare(root: Path):
    _, frames, references = load_development(root)
    cache = root / "vision-v4/cache"
    cache.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(CONFIG["random_state"])
    samples = {}
    for number, frame in enumerate(frames, 1):
        features = feature_map(frame["image"], references[frame["test_id"]])
        X, y = training_sample(features, frame["gt"], rng)
        samples[frame["name"]] = {"test_id": frame["test_id"], "X": X, "y": y}
        print(f"prepared {number:02d}/72 {frame['name']} X={X.shape}", flush=True)
    joblib.dump({"samples": samples, "config": CONFIG, "feature_names": FEATURE_NAMES},
                cache / "samples.joblib", compress=0)
    print(json.dumps({"frames": len(samples), "rows": int(sum(len(v["y"]) for v in samples.values())),
                      "features": len(FEATURE_NAMES)}, indent=2))


def concatenate_training(samples, excluded_test: str | None):
    selected = [v for v in samples.values() if v["test_id"] != excluded_test]
    return (np.concatenate([v["X"] for v in selected]),
            np.concatenate([v["y"] for v in selected]))


def run_fold(root: Path, test_id: str):
    if test_id not in DEVELOPMENT_TESTS:
        raise ValueError(f"Unknown development test {test_id}")
    _, frames, references = load_development(root)
    heldout = [f for f in frames if f["test_id"] == test_id]
    cache = joblib.load(root / "vision-v4/cache/samples.joblib")
    if cache["config"] != CONFIG or cache["feature_names"] != FEATURE_NAMES:
        raise ValueError("Sample cache does not match current v4 configuration")
    X, y = concatenate_training(cache["samples"], test_id)
    result = {"test_id": test_id, "train_rows": len(y), "candidates": {}}
    for candidate in CANDIDATES:
        print(f"fold {test_id}: fitting {candidate} on {X.shape}", flush=True)
        model = new_model(candidate).fit(X, y)
        rows = []
        destination = root / "vision-v4/fold-predictions" / candidate / test_id
        destination.mkdir(parents=True, exist_ok=True)
        for frame in heldout:
            prediction = predict(model, frame["image"], references[test_id])
            rows.append(frame_metrics(frame, prediction))
            cv2.imwrite(str(destination / frame["name"]), prediction * 255)
        result["candidates"][candidate] = rows
        print(f"fold {test_id}: {candidate} {summarize(rows)}", flush=True)
        del model
        gc.collect()
    output = root / "vision-v4/folds"
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{test_id}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    del X, y, cache
    gc.collect()


def summarize_development(root: Path):
    comparison = {
        "schema": "falmex-vision-v4-development-comparison-v1",
        "status": "model-selection estimate on nine development tests; not confirmation",
        "split": "leave-one-test-out with identical samples and features for both candidates",
        "selection_rule": CONFIG["selection_rule"],
        "config": CONFIG,
        "candidates": {},
    }
    for candidate in CANDIDATES:
        rows = []
        for test in DEVELOPMENT_TESTS:
            fold = json.loads((root / f"vision-v4/folds/{test}.json").read_text())
            rows += fold["candidates"][candidate]
        if len(rows) != 72:
            raise ValueError(f"Incomplete folds for {candidate}: {len(rows)}")
        comparison["candidates"][candidate] = {
            "per_test": {test: summarize([r for r in rows if r["test_id"] == test])
                         for test in DEVELOPMENT_TESTS},
            "pooled": summarize(rows),
            "per_frame": rows,
        }
    ranking = sorted(
        CANDIDATES,
        key=lambda c: (comparison["candidates"][c]["pooled"]["positive_macro_iou"],
                       comparison["candidates"][c]["pooled"]["positive_macro_dice"]),
        reverse=True,
    )
    comparison["selected_candidate"] = ranking[0]
    comparison["ranking"] = ranking
    output = root / "vision-v4"
    (output / "development-comparison.json").write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    for candidate in CANDIDATES:
        data = comparison["candidates"][candidate]
        (output / f"development-metrics-{candidate}.json").write_text(json.dumps({
            "schema": "falmex-vision-v4-development-metrics-v1",
            "candidate": candidate, "status": comparison["status"],
            "config": CONFIG, "per_test": data["per_test"], "pooled": data["pooled"],
        }, indent=2), encoding="utf-8")
        (output / f"development-per-frame-{candidate}.json").write_text(
            json.dumps(data["per_frame"], indent=2), encoding="utf-8")
    print(json.dumps({"selected": ranking[0], "pooled": {
        c: comparison["candidates"][c]["pooled"] for c in CANDIDATES}}, indent=2))


def train_final(root: Path):
    comparison = json.loads((root / "vision-v4/development-comparison.json").read_text())
    selected = comparison["selected_candidate"]
    _, frames, _ = load_development(root)
    cache = joblib.load(root / "vision-v4/cache/samples.joblib")
    X, y = concatenate_training(cache["samples"], None)
    print(f"fitting final {selected} on {X.shape}", flush=True)
    model = new_model(selected).fit(X, y)
    bundle = {
        "model": model, "candidate": selected, "config": CONFIG,
        "feature_names": FEATURE_NAMES, "development_tests": DEVELOPMENT_TESTS,
        "training_frames": [f["name"] for f in frames],
        "annotation_scope": "coarse AI-assistant polygons, not independent-expert gold masks",
    }
    output = root / "vision-v4"
    (output / "models").mkdir(parents=True, exist_ok=True)
    model_path = output / "models/falmex-vision-v4.joblib"
    joblib.dump(bundle, model_path, compress=3)
    freeze = {
        "schema": "falmex-vision-v4-freeze-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "model_file": str(model_path.relative_to(root)),
        "model_sha256": sha256(model_path),
        "selected_candidate": selected,
        "selection_rule": CONFIG["selection_rule"],
        "config": CONFIG,
        "feature_names": FEATURE_NAMES,
        "development_tests": list(DEVELOPMENT_TESTS),
        "reserved_confirmation_tests": list(CONFIRMATION_TESTS),
        "confirmation_status": "not yet predicted or inspected at freeze time",
        "development_input_sha256": {
            relative: sha256(root / relative) for relative in (
                "frames/selection.json", "annotations/polygons.json",
                "confirmation/selection.json", "confirmation/annotations/polygons.json",
                "confirmation-v3/selection.json", "confirmation-v3/annotations/polygons.json",
                "metadata/vision-v4-split.json", "scripts/falmex_vision_v4.py",
            )
        },
        "software": {
            "python": platform.python_version(), "numpy": np.__version__,
            "opencv": cv2.__version__, "lightgbm": lgb.__version__,
        },
    }
    (output / "model-freeze.json").write_text(json.dumps(freeze, indent=2), encoding="utf-8")
    overlay_dir = output / "development-overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    for frame in frames:
        prediction = (cv2.imread(str(
            output / "fold-predictions" / selected / frame["test_id"] / frame["name"]), 0) > 0).astype(np.uint8)
        cv2.imwrite(str(overlay_dir / frame["name"]), overlay(frame["image"], frame["gt"], prediction))
    print(json.dumps({"selected_candidate": selected, "model_sha256": freeze["model_sha256"]}, indent=2))


def predict_video(root: Path, args):
    freeze = json.loads((root / "vision-v4/model-freeze.json").read_text())
    model_path = root / freeze["model_file"]
    if sha256(model_path) != freeze["model_sha256"]:
        raise ValueError("Frozen v4 model hash mismatch; refusing prediction")
    bundle = joblib.load(model_path)
    if bundle["config"] != CONFIG or bundle["feature_names"] != FEATURE_NAMES:
        raise ValueError("Inference code differs from frozen v4 model")
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
        "model_sha256": freeze["model_sha256"], "candidate": bundle["candidate"],
        "video": video.name, "video_sha256": sha256(video), "frames": records,
    }, indent=2), encoding="utf-8")
    print(json.dumps({"test_id": args.test_id, "frames": len(records),
                      "model_sha256": freeze["model_sha256"]}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    fold = sub.add_parser("run-fold")
    fold.add_argument("--test-id", required=True, choices=DEVELOPMENT_TESTS)
    sub.add_parser("summarize")
    sub.add_parser("train-final")
    inference = sub.add_parser("predict-video")
    inference.add_argument("--video", required=True)
    inference.add_argument("--test-id", required=True)
    inference.add_argument("--frames", required=True, help="comma-separated zero-based indices")
    inference.add_argument("--output", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "prepare":
        prepare(root)
    elif args.command == "run-fold":
        run_fold(root, args.test_id)
    elif args.command == "summarize":
        summarize_development(root)
    elif args.command == "train-final":
        train_final(root)
    else:
        predict_video(root, args)


if __name__ == "__main__":
    main()
