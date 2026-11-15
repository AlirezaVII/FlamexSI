#!/usr/bin/env python3
"""Falmex Vision v5: grouped low-light segmentation development.

B13/B15/B16 are reserved confirmation and are never loaded by training commands.
B9/B10/B11 are development data in v5, not untouched confirmation.
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

from falmex_vision_v3 import frame_metrics, overlay, read_frame, reference_frame, sha256, summarize
from falmex_vision_v4 import FEATURE_NAMES as V4_FEATURE_NAMES, feature_map as v4_feature_map

DEVELOPMENT_TESTS = ("B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12")
CONFIRMATION_TESTS = ("B13", "B15", "B16")
MODEL_VARIANTS = ("unweighted", "frame_dim_balanced")
INFERENCE_VARIANTS = ("standard", "recall_single", "core_hysteresis")
BOUNDED_HYSTERESIS_RADII = (2, 4, 6, 8)
SMALL_CORE_AREA_THRESHOLD = 3000
SMALL_CORE_HYSTERESIS_RADII = (1, 2, 4, 6, 8)
REFINEMENT_DISCLOSURE = (
    "Distance-bounded hysteresis was added after inspecting initial grouped-fold "
    "development results. Prediction-area-gated small-core recovery was added after "
    "the full initial ranking showed excessive FP. These are exploratory development "
    "refinements, not preregistered candidates and not confirmation-derived tuning."
)
FEATURE_NAMES = V4_FEATURE_NAMES + [
    "clahe_V", "clahe_L", "V_tophat_9", "V_tophat_21", "V_DoG_1_4",
    "V_DoG_2_8", "red_excess_DoG_1_4", "temporal_V_abs", "temporal_V_positive",
    "temporal_max_abs_local_2", "temporal_max_abs_std_2", "temporal_max_abs_DoG_1_4",
    "temporal_max_abs_normalized", "temporal_V_diff_normalized", "V_local_8",
    "V_minus_local_8", "red_excess_local_1", "red_excess_minus_local_1",
]
CONFIG = {
    "schema": "falmex-vision-v5",
    "target": "visibly luminous flame regions",
    "random_state": 42,
    "reference_frames": 30,
    "negative_random_samples_per_frame": 1200,
    "negative_hard_samples_per_frame": 2400,
    "negative_boundary_samples_per_frame": 2400,
    "boundary_dilation_kernel": 41,
    "probability_blur_sigma": 1.2,
    "selection_rule": "highest small-or-dim positive macro IoU subject to development detection and FP constraints; overall macro IoU breaks ties",
    "small_or_dim": {"area_below_px": 3000, "median_v_below": 0.35},
    "constraints": {"max_detection_failures": 1, "max_fp_vs_frozen_v4_reference": 1.25},
    "frame_dim_balanced": {"max_positive_weight": 8.0, "min_positive_weight": 0.25, "dim_multiplier": 2.0},
    "inference": {
        "standard": {"kind": "single", "threshold": 0.50, "temporal_gate": 0.05, "min_component_area": 50},
        "recall_single": {"kind": "single", "threshold": 0.30, "temporal_gate": 0.015, "min_component_area": 25},
        "core_hysteresis": {"kind": "hysteresis", "high_threshold": 0.50, "low_threshold": 0.18, "temporal_gate": 0.015, "min_component_area": 25},
    },
    "lightgbm": {
        "n_estimators": 180, "learning_rate": 0.05, "num_leaves": 48,
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
    for relative in (
        "frames/selection.json", "confirmation/selection.json", "confirmation-v3/selection.json",
        "confirmation-v4/selection.json", "development-v5/selection.json",
    ):
        path = root / relative
        if path.exists():
            selection += json.loads(path.read_text(encoding="utf-8"))
    frames, seen = [], set()
    for row in selection:
        if row["test_id"] not in DEVELOPMENT_TESTS:
            continue
        name = Path(row["file"]).name
        if name in seen:
            raise ValueError(f"Duplicate development frame {name}")
        seen.add(name)
        image = cv2.imread(str(root / row["file"]))
        gt = (cv2.imread(str(root / row["mask"]), 0) > 0).astype(np.uint8)
        if image is None or gt.shape != image.shape[:2]:
            raise ValueError(f"Invalid development input {row['file']}")
        value = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
        area = int(gt.sum())
        median_v = float(np.median(value[gt > 0])) if area else None
        small_or_dim = bool(area and (
            area < CONFIG["small_or_dim"]["area_below_px"] or
            median_v < CONFIG["small_or_dim"]["median_v_below"]))
        frames.append({**row, "name": name, "image": image, "gt": gt,
                       "gt_median_v": median_v, "small_or_dim": small_or_dim})
    if len(frames) < 96:
        raise ValueError(f"Expected at least 96 development frames, found {len(frames)}")
    references = {test: reference_frame(video_path(root, test), CONFIG["reference_frames"])
                  for test in DEVELOPMENT_TESTS}
    return selection, frames, references


def feature_map(image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    base = v4_feature_map(image, reference)
    current = image.astype(np.float32) / 255
    ref = reference.astype(np.float32) / 255
    b, g, r = cv2.split(current)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    value_u8 = hsv[:, :, 2]
    value = value_u8.astype(np.float32) / 255
    ref_value = cv2.cvtColor(reference, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
    lab_l_u8 = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)[:, :, 0]
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    red_excess = r - (g + b) / 2
    v_diff = value - ref_value
    absolute = np.max(np.abs(current - ref), axis=2)
    absolute_local = cv2.GaussianBlur(absolute, (0, 0), 2)
    absolute_std = np.sqrt(np.maximum(
        cv2.GaussianBlur(absolute * absolute, (0, 0), 2) - absolute_local * absolute_local, 0))
    kernel9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    kernel21 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    v1, v2, v4, v8 = [cv2.GaussianBlur(value, (0, 0), s) for s in (1, 2, 4, 8)]
    red1, red4 = [cv2.GaussianBlur(red_excess, (0, 0), s) for s in (1, 4)]
    extra = [
        clahe.apply(value_u8).astype(np.float32) / 255,
        clahe.apply(lab_l_u8).astype(np.float32) / 255,
        cv2.morphologyEx(value, cv2.MORPH_TOPHAT, kernel9),
        cv2.morphologyEx(value, cv2.MORPH_TOPHAT, kernel21),
        v1 - v4, v2 - v8, red1 - red4, np.abs(v_diff), np.maximum(v_diff, 0),
        absolute_local, absolute_std,
        cv2.GaussianBlur(absolute, (0, 0), 1) - cv2.GaussianBlur(absolute, (0, 0), 4),
        absolute / (ref_value + 0.05), v_diff / (ref_value + 0.05),
        v8, value - v8, red1, red_excess - red1,
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
    size = CONFIG["boundary_dilation_kernel"]
    boundary = (cv2.dilate(gt, np.ones((size, size), np.uint8)) > 0) & (gt == 0)
    boundary_indices = np.flatnonzero(boundary.ravel())
    boundary_negative = rng.choice(
        boundary_indices, min(CONFIG["negative_boundary_samples_per_frame"], len(boundary_indices)),
        replace=False) if len(boundary_indices) else np.array([], dtype=int)
    negative_selected = np.unique(np.r_[random_negative, hard_negative, boundary_negative])
    indices = np.r_[positive, negative_selected]
    X = features.reshape(-1, features.shape[-1])[indices]
    y = np.r_[np.ones(len(positive), np.uint8), np.zeros(len(negative_selected), np.uint8)]
    return X, y


def positive_weights(frames):
    areas = np.array([int(f["gt"].sum()) for f in frames if f["gt"].any()], dtype=np.float32)
    typical = float(np.median(areas))
    weights = {}
    settings = CONFIG["frame_dim_balanced"]
    for frame in frames:
        area = int(frame["gt"].sum())
        if not area:
            weights[frame["name"]] = None
            continue
        weight = float(np.clip(typical / area, settings["min_positive_weight"], settings["max_positive_weight"]))
        if frame["gt_median_v"] < CONFIG["small_or_dim"]["median_v_below"]:
            weight *= settings["dim_multiplier"]
        weights[frame["name"]] = weight
    return weights


def prepare(root: Path):
    _, frames, references = load_development(root)
    cache = root / "vision-v5/cache"
    cache.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(CONFIG["random_state"])
    frame_weights = positive_weights(frames)
    samples = {}
    for number, frame in enumerate(frames, 1):
        features = feature_map(frame["image"], references[frame["test_id"]])
        X, y = training_sample(features, frame["gt"], rng)
        w = np.ones(len(y), dtype=np.float32)
        if frame_weights[frame["name"]] is not None:
            w[y == 1] = frame_weights[frame["name"]]
        samples[frame["name"]] = {"test_id": frame["test_id"], "X": X, "y": y, "w": w}
        print(f"prepared {number:03d}/{len(frames)} {frame['name']} X={X.shape}", flush=True)
    joblib.dump({"samples": samples, "config": CONFIG, "feature_names": FEATURE_NAMES},
                cache / "samples.joblib", compress=0)
    print(json.dumps({"frames": len(samples), "rows": int(sum(len(v["y"]) for v in samples.values())),
                      "features": len(FEATURE_NAMES)}, indent=2))


def concatenate_training(samples, excluded_test=None):
    selected = [v for v in samples.values() if v["test_id"] != excluded_test]
    return (np.concatenate([v["X"] for v in selected]), np.concatenate([v["y"] for v in selected]),
            np.concatenate([v["w"] for v in selected]))


def new_model():
    return lgb.LGBMClassifier(**CONFIG["lightgbm"], random_state=CONFIG["random_state"],
                              verbosity=-1, deterministic=True, force_col_wise=True)


def temporal_difference(image, reference):
    return np.max(np.abs(image.astype(np.float32) - reference.astype(np.float32)), axis=2) / 255


def clean_components(mask, minimum_area):
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    output = np.zeros_like(mask, dtype=np.uint8)
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= minimum_area:
            output[labels == label] = 1
    return output


def combine_bounded_hysteresis(standard, hysteresis, radius):
    """Keep the standard core and add only nearby hysteresis pixels."""
    standard = (standard > 0).astype(np.uint8)
    hysteresis = (hysteresis > 0).astype(np.uint8)
    if not standard.any():
        return hysteresis
    nearby = cv2.dilate(
        standard, np.ones((2 * radius + 1, 2 * radius + 1), np.uint8))
    return standard | (hysteresis & nearby)


def combine_small_core_recovery(standard, hysteresis, radius):
    """Permit bounded recovery only for an empty or small predicted core."""
    standard = (standard > 0).astype(np.uint8)
    if int(standard.sum()) < SMALL_CORE_AREA_THRESHOLD:
        return combine_bounded_hysteresis(standard, hysteresis, radius)
    return standard


def postprocess(probability, difference, variant):
    if variant.startswith(("bounded_core_hysteresis_r", "small_core_bounded_hysteresis_r")):
        radius = int(variant.rsplit("_r", 1)[1])
        allowed_radii = (SMALL_CORE_HYSTERESIS_RADII if variant.startswith("small_core_")
                         else BOUNDED_HYSTERESIS_RADII)
        if radius not in allowed_radii:
            raise ValueError(f"Unsupported bounded-hysteresis radius: {radius}")
        standard = postprocess(probability, difference, "standard")
        hysteresis = postprocess(probability, difference, "core_hysteresis")
        if variant.startswith("small_core_"):
            return combine_small_core_recovery(standard, hysteresis, radius)
        return combine_bounded_hysteresis(standard, hysteresis, radius)
    settings = CONFIG["inference"][variant]
    gated = probability * np.clip(difference / settings["temporal_gate"], 0, 1)
    gated = cv2.GaussianBlur(gated, (0, 0), CONFIG["probability_blur_sigma"])
    if settings["kind"] == "single":
        mask = (gated >= settings["threshold"]).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        return clean_components(mask, settings["min_component_area"])
    high = (gated >= settings["high_threshold"]).astype(np.uint8)
    high = cv2.morphologyEx(high, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    low = (gated >= settings["low_threshold"]).astype(np.uint8)
    low = cv2.morphologyEx(low, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(low, connectivity=8)
    output = np.zeros_like(low)
    for label in range(1, count):
        component = labels == label
        if int(stats[label, cv2.CC_STAT_AREA]) >= settings["min_component_area"] and np.any(high[component]):
            output[component] = 1
    return output


def run_fold(root: Path, test_id: str):
    if test_id not in DEVELOPMENT_TESTS:
        raise ValueError(f"Unknown development test {test_id}")
    _, frames, references = load_development(root)
    heldout = [f for f in frames if f["test_id"] == test_id]
    cache = joblib.load(root / "vision-v5/cache/samples.joblib")
    if cache["config"] != CONFIG or cache["feature_names"] != FEATURE_NAMES:
        raise ValueError("Sample cache does not match current v5 configuration")
    X, y, w = concatenate_training(cache["samples"], test_id)
    result = {"test_id": test_id, "train_rows": len(y), "candidates": {}}
    for model_variant in MODEL_VARIANTS:
        print(f"fold {test_id}: fitting {model_variant} on {X.shape}", flush=True)
        fit_weight = w if model_variant == "frame_dim_balanced" else None
        model = new_model().fit(X, y, sample_weight=fit_weight)
        candidate_rows = {name: [] for name in INFERENCE_VARIANTS}
        for frame in heldout:
            features = feature_map(frame["image"], references[test_id])
            height, width = frame["image"].shape[:2]
            probability = model.predict_proba(features.reshape(-1, features.shape[-1]))[:, 1].reshape(height, width)
            difference = temporal_difference(frame["image"], references[test_id])
            for inference_variant in INFERENCE_VARIANTS:
                candidate = f"{model_variant}__{inference_variant}"
                prediction = postprocess(probability, difference, inference_variant)
                row = {**frame_metrics(frame, prediction), "small_or_dim": frame["small_or_dim"]}
                candidate_rows[inference_variant].append(row)
                destination = root / "vision-v5/fold-predictions" / candidate / test_id
                destination.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(destination / frame["name"]), prediction * 255)
        for inference_variant, rows in candidate_rows.items():
            candidate = f"{model_variant}__{inference_variant}"
            result["candidates"][candidate] = rows
            print(f"fold {test_id}: {candidate} {summarize(rows)}", flush=True)
        del model
        gc.collect()
    output = root / "vision-v5/folds"
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{test_id}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    del X, y, w, cache
    gc.collect()


def frozen_v4_reference(root: Path, frames):
    rows = []
    for frame in frames:
        test, name = frame["test_id"], frame["name"]
        if test in ("B9", "B10", "B11"):
            path = root / "confirmation-v4/frozen-predictions" / test / name
        else:
            path = root / "vision-v4/fold-predictions/lightgbm" / test / name
        if not path.exists():
            path = root / "vision-v5/retrospective-v4-predictions" / test / name
        prediction = cv2.imread(str(path), 0)
        if prediction is None:
            raise ValueError(f"Missing frozen v4 reference prediction {path}")
        rows.append({**frame_metrics(frame, (prediction > 0).astype(np.uint8)),
                     "small_or_dim": frame["small_or_dim"]})
    return rows


def subset_summary(rows, small_or_dim=None):
    selected = rows if small_or_dim is None else [r for r in rows if r["small_or_dim"] == small_or_dim]
    return summarize(selected)


def summarize_development(root: Path):
    _, frames, _ = load_development(root)
    baseline_rows = frozen_v4_reference(root, frames)
    baseline = {"pooled": subset_summary(baseline_rows), "small_or_dim": subset_summary(baseline_rows, True),
                "per_test": {t: subset_summary([r for r in baseline_rows if r["test_id"] == t]) for t in DEVELOPMENT_TESTS}}
    comparison = {
        "schema": "falmex-vision-v5-development-comparison-v1",
        "status": "model-selection estimates on development only; not confirmation",
        "split": "leave-one-test-out over 12 development tests",
        "selection_rule": CONFIG["selection_rule"], "config": CONFIG,
        "frozen_v4_retrospective_reference": baseline, "candidates": {},
    }
    initial_candidates = [f"{m}__{i}" for m in MODEL_VARIANTS for i in INFERENCE_VARIANTS]
    bounded_candidates = [
        f"{m}__bounded_core_hysteresis_r{radius}"
        for m in MODEL_VARIANTS for radius in BOUNDED_HYSTERESIS_RADII
    ]
    small_core_candidates = [
        f"{m}__small_core_bounded_hysteresis_r{radius}"
        for m in MODEL_VARIANTS for radius in SMALL_CORE_HYSTERESIS_RADII
    ]
    candidate_names = initial_candidates + bounded_candidates + small_core_candidates
    comparison["refinement_disclosure"] = REFINEMENT_DISCLOSURE
    comparison["candidate_provenance"] = {
        **{name: "preregistered_initial_candidate" for name in initial_candidates},
        **{name: "post_initial_fold_development_refinement" for name in bounded_candidates},
        **{name: "post_full_initial_ranking_development_refinement" for name in small_core_candidates},
    }
    comparison["bounded_hysteresis_rule"] = {
        "radii_px": list(BOUNDED_HYSTERESIS_RADII),
        "rule": "standard OR (core_hysteresis AND square_dilation(standard, radius)); hysteresis fallback if standard is empty",
    }
    comparison["small_core_recovery_rule"] = {
        "radii_px": list(SMALL_CORE_HYSTERESIS_RADII),
        "predicted_core_area_below_px": SMALL_CORE_AREA_THRESHOLD,
        "rule": "apply bounded recovery only when predicted standard area is below 3000 px (empty included); otherwise retain standard",
        "ground_truth_used_by_inference_gate": False,
    }
    for candidate in candidate_names:
        rows = []
        if candidate in initial_candidates:
            for test in DEVELOPMENT_TESTS:
                fold = json.loads((root / f"vision-v5/folds/{test}.json").read_text())
                rows += fold["candidates"][candidate]
        else:
            model_variant = candidate.split("__", 1)[0]
            radius = int(candidate.rsplit("_r", 1)[1])
            for frame in frames:
                prediction_dir = root / "vision-v5/fold-predictions"
                standard = cv2.imread(str(
                    prediction_dir / f"{model_variant}__standard" / frame["test_id"] / frame["name"]), 0)
                hysteresis = cv2.imread(str(
                    prediction_dir / f"{model_variant}__core_hysteresis" / frame["test_id"] / frame["name"]), 0)
                if standard is None or hysteresis is None:
                    raise ValueError(f"Missing base predictions for {candidate}: {frame['name']}")
                if candidate in small_core_candidates:
                    prediction = combine_small_core_recovery(standard, hysteresis, radius)
                else:
                    prediction = combine_bounded_hysteresis(standard, hysteresis, radius)
                rows.append({**frame_metrics(frame, prediction), "small_or_dim": frame["small_or_dim"]})
        if len(rows) != len(frames):
            raise ValueError(f"Incomplete folds for {candidate}: {len(rows)} != {len(frames)}")
        comparison["candidates"][candidate] = {
            "per_test": {test: subset_summary([r for r in rows if r["test_id"] == test]) for test in DEVELOPMENT_TESTS},
            "pooled": subset_summary(rows), "small_or_dim": subset_summary(rows, True), "per_frame": rows,
        }
    max_fp = baseline["pooled"]["fp"] * CONFIG["constraints"]["max_fp_vs_frozen_v4_reference"]
    eligible = []
    for candidate, data in comparison["candidates"].items():
        pooled = data["pooled"]
        data["eligible"] = bool(pooled["positive_detection_failures"] <= CONFIG["constraints"]["max_detection_failures"] and pooled["fp"] <= max_fp)
        data["constraint_failures"] = {
            "detection_failures": pooled["positive_detection_failures"] > CONFIG["constraints"]["max_detection_failures"],
            "false_positive_pixels": pooled["fp"] > max_fp,
        }
        if data["eligible"]:
            eligible.append(candidate)
    pool = eligible or candidate_names
    ranking = sorted(pool, key=lambda c: (
        comparison["candidates"][c]["small_or_dim"]["positive_macro_iou"] if eligible else comparison["candidates"][c]["pooled"]["positive_macro_iou"],
        comparison["candidates"][c]["pooled"]["positive_macro_iou"]), reverse=True)
    comparison["eligible_candidates"] = eligible
    comparison["selected_candidate"] = ranking[0]
    comparison["ranking"] = ranking
    comparison["selection_fallback_used"] = not eligible
    output = root / "vision-v5"
    selected = comparison["selected_candidate"]
    if selected not in initial_candidates:
        model_variant = selected.split("__", 1)[0]
        radius = int(selected.rsplit("_r", 1)[1])
        prediction_dir = output / "fold-predictions"
        for frame in frames:
            standard = cv2.imread(str(
                prediction_dir / f"{model_variant}__standard" / frame["test_id"] / frame["name"]), 0)
            hysteresis = cv2.imread(str(
                prediction_dir / f"{model_variant}__core_hysteresis" / frame["test_id"] / frame["name"]), 0)
            if standard is None or hysteresis is None:
                raise ValueError(f"Missing selected base predictions: {frame['name']}")
            if selected in small_core_candidates:
                prediction = combine_small_core_recovery(standard, hysteresis, radius)
            else:
                prediction = combine_bounded_hysteresis(standard, hysteresis, radius)
            destination = prediction_dir / selected / frame["test_id"]
            destination.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(destination / frame["name"]), prediction * 255)
    (output / "development-comparison.json").write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    for candidate, data in comparison["candidates"].items():
        (output / f"development-per-frame-{candidate}.json").write_text(json.dumps(data["per_frame"], indent=2), encoding="utf-8")
    print(json.dumps({"selected": ranking[0], "eligible": eligible,
                      "baseline": {"pooled": baseline["pooled"], "small_or_dim": baseline["small_or_dim"]},
                      "candidates": {c: {"pooled": comparison["candidates"][c]["pooled"],
                                         "small_or_dim": comparison["candidates"][c]["small_or_dim"],
                                         "eligible": comparison["candidates"][c]["eligible"]} for c in candidate_names}}, indent=2))


def train_final(root: Path):
    comparison = json.loads((root / "vision-v5/development-comparison.json").read_text())
    selected = comparison["selected_candidate"]
    model_variant, inference_variant = selected.split("__")
    _, frames, _ = load_development(root)
    cache = joblib.load(root / "vision-v5/cache/samples.joblib")
    X, y, w = concatenate_training(cache["samples"])
    print(f"fitting final {selected} on {X.shape}", flush=True)
    model = new_model().fit(X, y, sample_weight=w if model_variant == "frame_dim_balanced" else None)
    bundle = {"model": model, "candidate": selected, "model_variant": model_variant,
              "inference_variant": inference_variant, "config": CONFIG, "feature_names": FEATURE_NAMES,
              "development_tests": DEVELOPMENT_TESTS, "training_frames": [f["name"] for f in frames],
              "annotation_scope": "coarse AI-assistant polygons, not independent-expert gold masks"}
    output = root / "vision-v5"
    (output / "models").mkdir(parents=True, exist_ok=True)
    model_path = output / "models/falmex-vision-v5.joblib"
    joblib.dump(bundle, model_path, compress=3)
    freeze = {
        "schema": "falmex-vision-v5-freeze-v1", "created_utc": datetime.now(timezone.utc).isoformat(),
        "model_file": str(model_path.relative_to(root)), "model_sha256": sha256(model_path),
        "selected_candidate": selected, "selection_rule": CONFIG["selection_rule"], "config": CONFIG,
        "candidate_provenance": comparison["candidate_provenance"][selected],
        "refinement_disclosure": REFINEMENT_DISCLOSURE,
        "bounded_hysteresis_radii_px": list(BOUNDED_HYSTERESIS_RADII),
        "small_core_hysteresis_radii_px": list(SMALL_CORE_HYSTERESIS_RADII),
        "small_core_area_threshold_px": SMALL_CORE_AREA_THRESHOLD,
        "feature_names": FEATURE_NAMES, "development_tests": list(DEVELOPMENT_TESTS),
        "reserved_confirmation_tests": list(CONFIRMATION_TESTS),
        "confirmation_status": "B13/B15/B16 frames and model outputs not yet read at v5 model freeze",
        "development_input_sha256": {relative: sha256(root / relative) for relative in (
            "frames/selection.json", "annotations/polygons.json", "confirmation/selection.json",
            "confirmation/annotations/polygons.json", "confirmation-v3/selection.json",
            "confirmation-v3/annotations/polygons.json", "confirmation-v4/selection.json",
            "confirmation-v4/annotations/polygons.json", "development-v5/selection.json",
            "development-v5/annotations/polygons.json", "metadata/vision-v5-split.json",
            "metadata/vision-v5-development-refinement.json", "metadata/vision-v5-small-core-refinement.json",
            "scripts/falmex_vision_v5.py") if (root / relative).exists()},
        "software": {"python": platform.python_version(), "numpy": np.__version__,
                     "opencv": cv2.__version__, "lightgbm": lgb.__version__},
    }
    (output / "model-freeze.json").write_text(json.dumps(freeze, indent=2), encoding="utf-8")
    overlay_dir = output / "development-overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    for frame in frames:
        prediction = (cv2.imread(str(output / "fold-predictions" / selected / frame["test_id"] / frame["name"]), 0) > 0).astype(np.uint8)
        cv2.imwrite(str(overlay_dir / frame["name"]), overlay(frame["image"], frame["gt"], prediction))
    print(json.dumps({"selected_candidate": selected, "model_sha256": freeze["model_sha256"]}, indent=2))


def predict_mask(bundle, image, reference):
    features = feature_map(image, reference)
    height, width = image.shape[:2]
    probability = bundle["model"].predict_proba(features.reshape(-1, features.shape[-1]))[:, 1].reshape(height, width)
    return postprocess(probability, temporal_difference(image, reference), bundle["inference_variant"])


def predict_video(root: Path, args):
    freeze = json.loads((root / "vision-v5/model-freeze.json").read_text())
    model_path = root / freeze["model_file"]
    if sha256(model_path) != freeze["model_sha256"]:
        raise ValueError("Frozen v5 model hash mismatch; refusing prediction")
    bundle = joblib.load(model_path)
    if bundle["config"] != CONFIG or bundle["feature_names"] != FEATURE_NAMES:
        raise ValueError("Inference code differs from frozen v5 model")
    video, output = Path(args.video).resolve(), Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    reference = reference_frame(video, CONFIG["reference_frames"])
    records = []
    for index in [int(x) for x in args.frames.split(",") if x.strip()]:
        image = read_frame(video, index)
        prediction = predict_mask(bundle, image, reference)
        name = f"{args.test_id}_{index:06d}.png"
        cv2.imwrite(str(output / name), prediction * 255)
        records.append({"test_id": args.test_id, "frame_index": index, "mask": name,
                        "prediction_area_px": int(prediction.sum())})
    (output / "predictions.json").write_text(json.dumps({
        "model_sha256": freeze["model_sha256"], "candidate": bundle["candidate"],
        "video": video.name, "video_sha256": sha256(video), "frames": records}, indent=2), encoding="utf-8")
    print(json.dumps({"test_id": args.test_id, "frames": len(records), "model_sha256": freeze["model_sha256"]}, indent=2))


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
    inference.add_argument("--frames", required=True)
    inference.add_argument("--output", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "prepare": prepare(root)
    elif args.command == "run-fold": run_fold(root, args.test_id)
    elif args.command == "summarize": summarize_development(root)
    elif args.command == "train-final": train_final(root)
    else: predict_video(root, args)


if __name__ == "__main__":
    main()
