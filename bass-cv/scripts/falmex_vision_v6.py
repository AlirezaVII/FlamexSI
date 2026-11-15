#!/usr/bin/env python3
"""Falmex Vision v6: preregistered low-light/domain-guard development.

B13/B15/B16 are development. B14/B17/B18 are reserved confirmation and are
never loaded by prepare, fold, summary, or final-training commands.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import lightgbm as lgb
import numpy as np

import falmex_vision_v5 as v5
from falmex_vision_v3 import frame_metrics, overlay, read_frame, reference_frame, sha256, summarize

DEVELOPMENT_TESTS = ("B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B15", "B16")
CONFIRMATION_TESTS = ("B14", "B17", "B18")
MODEL_VARIANTS = ("unweighted", "frame_dim_balanced")
INFERENCE_VARIANTS = ("standard", "small_core_bounded_hysteresis_r4", "lowlight_small_core_r4", "ungated_small_core_r4")
DOMAIN_GUARDS = ("no_guard", "camera_information_guard", "camera_information_guard_v2")
SMALL_CORE_AREA_THRESHOLD = 3000
FEATURE_NAMES = v5.FEATURE_NAMES + [
    "gamma_V_0_5", "gamma_L_0_5", "clahe_V_DoG_1_4", "V_tophat_41",
    "V_over_local_8", "V_contrast_over_local_4", "red_excess_over_local_8",
    "temporal_abs_over_reference_8", "temporal_positive_over_reference_8",
    "temporal_abs_max_3", "temporal_abs_max_7", "temporal_abs_DoG_normalized",
    "temporal_support_3_threshold_0_01", "temporal_support_5_threshold_0_03",
    "temporal_signed_max", "reference_V_highpass_4",
]
CONFIG = {
    "schema": "falmex-vision-v6",
    "target": "visibly luminous flame regions",
    "random_state": 42,
    "reference_frames": 30,
    "negative_random_samples_per_frame": 1200,
    "negative_hard_samples_per_frame": 2400,
    "negative_boundary_samples_per_frame": 2400,
    "boundary_dilation_kernel": 41,
    "probability_blur_sigma": 1.2,
    "selection_rule": "highest small-or-dim positive macro IoU, overall positive macro IoU then lower FP, subject to development detection/FP constraints",
    "small_or_dim": {"area_below_px": 3000, "median_v_below": 0.35},
    "constraints": {"max_detection_failures": 2, "max_fp_vs_frozen_v5_reference": 1.25, "max_negative_fp_vs_frozen_v5_reference": 1.25},
    "frame_dim_balanced": {"max_positive_weight": 8.0, "min_positive_weight": 0.25, "dim_multiplier": 2.0},
    "inference": {
        "standard": {"kind": "single", "threshold": 0.50, "temporal_gate": 0.05, "min_component_area": 50},
        "core_hysteresis": {"kind": "hysteresis", "high_threshold": 0.50, "low_threshold": 0.18, "temporal_gate": 0.015, "min_component_area": 25},
        "lowlight_standard": {"kind": "single", "threshold": 0.35, "temporal_gate": 0.005, "min_component_area": 15},
        "lowlight_hysteresis": {"kind": "hysteresis", "high_threshold": 0.45, "low_threshold": 0.08, "temporal_gate": 0.005, "min_component_area": 15},
        "ungated_standard": {"kind": "single", "threshold": 0.50, "temporal_gate": None, "min_component_area": 25},
        "ungated_hysteresis": {"kind": "hysteresis", "high_threshold": 0.50, "low_threshold": 0.18, "temporal_gate": None, "min_component_area": 25},
    },
    "camera_information_guard": {"roi_x": 0.40, "roi_y": 0.55, "bright_min_u8": 100, "bright_quantile": 0.75, "min_bright_fraction": 0.08, "canny_low": 50, "canny_high": 150, "line_kernel_px": 25, "min_line_fraction": 0.01},
    "camera_information_guard_v2": {"roi_x": 0.40, "roi_y": 0.55, "bright_min_u8": 100, "bright_quantile": 0.75, "min_bright_fraction": 0.08, "canny_low": 50, "canny_high": 150, "line_kernel_px": 15, "min_line_fraction": 0.01},
    "lightgbm": dict(v5.CONFIG["lightgbm"]),
}


def sample_cache_path(root: Path) -> Path:
    return Path(os.environ.get("FALMEX_V6_CACHE", str(root / "vision-v6/cache/samples.joblib")))


def load_development(root: Path):
    protocol = json.loads((root / "metadata/vision-v6-split.json").read_text())
    if list(DEVELOPMENT_TESTS) != protocol["development_tests"] or list(CONFIRMATION_TESTS) != protocol["reserved_confirmation_tests"]:
        raise ValueError("Code and preregistered v6 split disagree")
    selection = json.loads((root / "development-v6/selection.json").read_text())
    frames, seen = [], set()
    for row in selection:
        if row["test_id"] not in DEVELOPMENT_TESTS:
            raise ValueError(f"Confirmation leakage in development index: {row['test_id']}")
        name = Path(row["file"]).name
        if name in seen:
            raise ValueError(f"Duplicate development frame {name}")
        seen.add(name)
        image = cv2.imread(str(root / row["file"]))
        gt_raw = cv2.imread(str(root / row["mask"]), 0)
        if image is None or gt_raw is None or gt_raw.shape != image.shape[:2]:
            raise ValueError(f"Invalid development input {row['file']}")
        if not set(np.unique(gt_raw)).issubset({0, 255}):
            raise ValueError(f"Non-binary development mask {row['mask']}")
        gt = (gt_raw > 0).astype(np.uint8)
        value = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
        area = int(gt.sum())
        median_v = float(np.median(value[gt > 0])) if area else None
        small_or_dim = bool(area and (area < CONFIG["small_or_dim"]["area_below_px"] or median_v < CONFIG["small_or_dim"]["median_v_below"]))
        frames.append({**row, "name": name, "image": image, "gt": gt, "gt_median_v": median_v, "small_or_dim": small_or_dim})
    if len(frames) != 132:
        raise ValueError(f"Expected 132 development frames, found {len(frames)}")
    videos = {row["test_id"]: root / row["video"] for row in selection}
    references = {test: reference_frame(videos[test], CONFIG["reference_frames"]) for test in DEVELOPMENT_TESTS}
    return selection, frames, references


def feature_map(image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    base = v5.feature_map(image, reference)
    current = image.astype(np.float32) / 255
    ref = reference.astype(np.float32) / 255
    b, g, r = cv2.split(current)
    value = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
    lab_l = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32) / 255
    ref_value = cv2.cvtColor(reference, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32) / 255
    clahe_v = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply((value * 255).astype(np.uint8)).astype(np.float32) / 255
    red_excess = r - (g + b) / 2
    signed = current - ref
    absolute = np.max(np.abs(signed), axis=2)
    v_diff = value - ref_value
    v1, v4, v8 = [cv2.GaussianBlur(value, (0, 0), s) for s in (1, 4, 8)]
    ref4, ref8 = [cv2.GaussianBlur(ref_value, (0, 0), s) for s in (4, 8)]
    abs1, abs4 = [cv2.GaussianBlur(absolute, (0, 0), s) for s in (1, 4)]
    kernel41 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
    extra = [
        np.sqrt(value), np.sqrt(lab_l),
        cv2.GaussianBlur(clahe_v, (0, 0), 1) - cv2.GaussianBlur(clahe_v, (0, 0), 4),
        cv2.morphologyEx(value, cv2.MORPH_TOPHAT, kernel41),
        value / (v8 + 0.02), (v1 - v4) / (v4 + 0.02), red_excess / (v8 + 0.02),
        absolute / (ref8 + 0.02), np.maximum(v_diff, 0) / (ref8 + 0.02),
        cv2.dilate(absolute, np.ones((3, 3), np.uint8)), cv2.dilate(absolute, np.ones((7, 7), np.uint8)),
        (abs1 - abs4) / (ref8 + 0.02),
        cv2.GaussianBlur((absolute > 0.01).astype(np.float32), (0, 0), 3),
        cv2.GaussianBlur((absolute > 0.03).astype(np.float32), (0, 0), 5),
        np.max(signed, axis=2), ref_value - ref4,
    ]
    result = np.concatenate([base, np.stack(extra, axis=-1)], axis=2).astype(np.float32)
    if result.shape[-1] != len(FEATURE_NAMES):
        raise AssertionError("Feature-name/map mismatch")
    return result


def positive_weights(frames):
    areas = np.array([int(f["gt"].sum()) for f in frames if f["gt"].any()], dtype=np.float32)
    typical = float(np.median(areas))
    weights, settings = {}, CONFIG["frame_dim_balanced"]
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
    cache = root / "vision-v6/cache"
    cache.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(CONFIG["random_state"])
    frame_weights, samples = positive_weights(frames), {}
    for number, frame in enumerate(frames, 1):
        features = feature_map(frame["image"], references[frame["test_id"]])
        X, y = v5.training_sample(features, frame["gt"], rng)
        w = np.ones(len(y), dtype=np.float32)
        if frame_weights[frame["name"]] is not None:
            w[y == 1] = frame_weights[frame["name"]]
        samples[frame["name"]] = {"test_id": frame["test_id"], "X": X, "y": y, "w": w}
        print(f"prepared {number:03d}/{len(frames)} {frame['name']} X={X.shape}", flush=True)
    joblib.dump({"samples": samples, "config": CONFIG, "feature_names": FEATURE_NAMES}, cache / "samples.joblib", compress=0)
    print(json.dumps({"frames": len(samples), "rows": int(sum(len(v["y"]) for v in samples.values())), "features": len(FEATURE_NAMES)}, indent=2))


def concatenate_training(samples, excluded_test=None):
    selected = [v for v in samples.values() if v["test_id"] != excluded_test]
    return np.concatenate([v["X"] for v in selected]), np.concatenate([v["y"] for v in selected]), np.concatenate([v["w"] for v in selected])


def new_model():
    return lgb.LGBMClassifier(**CONFIG["lightgbm"], random_state=CONFIG["random_state"], verbosity=-1, deterministic=True, force_col_wise=True)


def temporal_difference(image, reference):
    return np.max(np.abs(image.astype(np.float32) - reference.astype(np.float32)), axis=2) / 255


def base_postprocess(probability, difference, settings):
    gate = settings["temporal_gate"]
    gated = probability if gate is None else probability * np.clip(difference / gate, 0, 1)
    gated = cv2.GaussianBlur(gated, (0, 0), CONFIG["probability_blur_sigma"])
    if settings["kind"] == "single":
        mask = (gated >= settings["threshold"]).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        return v5.clean_components(mask, settings["min_component_area"])
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


def postprocess(probability, difference, variant):
    if variant == "standard":
        return base_postprocess(probability, difference, CONFIG["inference"]["standard"])
    if variant == "small_core_bounded_hysteresis_r4":
        standard = base_postprocess(probability, difference, CONFIG["inference"]["standard"])
        hysteresis = base_postprocess(probability, difference, CONFIG["inference"]["core_hysteresis"])
        return v5.combine_small_core_recovery(standard, hysteresis, 4)
    if variant == "lowlight_small_core_r4":
        standard = base_postprocess(probability, difference, CONFIG["inference"]["lowlight_standard"])
        hysteresis = base_postprocess(probability, difference, CONFIG["inference"]["lowlight_hysteresis"])
        return v5.combine_small_core_recovery(standard, hysteresis, 4)
    if variant == "ungated_small_core_r4":
        standard = base_postprocess(probability, difference, CONFIG["inference"]["ungated_standard"])
        hysteresis = base_postprocess(probability, difference, CONFIG["inference"]["ungated_hysteresis"])
        return v5.combine_small_core_recovery(standard, hysteresis, 4)
    raise ValueError(f"Unknown inference variant {variant}")


def camera_information_guard(image: np.ndarray, variant: str = "camera_information_guard") -> bool:
    """Deterministic source-only guard; no GT or prediction is read."""
    settings = CONFIG[variant]
    height, width = image.shape[:2]
    x0, y0 = int(width * settings["roi_x"]), int(height * settings["roi_y"])
    roi = image[y0:, x0:]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    bright_threshold = max(settings["bright_min_u8"], float(np.quantile(gray, settings["bright_quantile"])))
    bright_fraction = float(np.mean(gray >= bright_threshold))
    edges = cv2.Canny(gray, settings["canny_low"], settings["canny_high"])
    size = settings["line_kernel_px"]
    horizontal = cv2.morphologyEx(edges, cv2.MORPH_OPEN, np.ones((1, size), np.uint8))
    vertical = cv2.morphologyEx(edges, cv2.MORPH_OPEN, np.ones((size, 1), np.uint8))
    line_fraction = float(np.count_nonzero(horizontal | vertical) / edges.size)
    return bool(bright_fraction >= settings["min_bright_fraction"] and line_fraction >= settings["min_line_fraction"])


def candidate_names():
    return [f"{model}__{inference}__{guard}" for model in MODEL_VARIANTS for inference in INFERENCE_VARIANTS for guard in DOMAIN_GUARDS]


def run_fold(root: Path, test_id: str, preloaded=None):
    if test_id not in DEVELOPMENT_TESTS:
        raise ValueError(f"Unknown development test {test_id}")
    if preloaded is None:
        _, frames, references = load_development(root)
        cache = joblib.load(sample_cache_path(root))
    else:
        frames, references, cache = preloaded
    heldout = [f for f in frames if f["test_id"] == test_id]
    if cache["config"] != CONFIG or cache["feature_names"] != FEATURE_NAMES:
        raise ValueError("Sample cache does not match current v6 configuration")
    X, y, w = concatenate_training(cache["samples"], test_id)
    result = {"test_id": test_id, "train_rows": len(y), "candidates": {}}
    for model_variant in MODEL_VARIANTS:
        print(f"fold {test_id}: fitting {model_variant} on {X.shape}", flush=True)
        fit_weight = w if model_variant == "frame_dim_balanced" else None
        model = new_model().fit(X, y, sample_weight=fit_weight)
        candidate_rows = {name: [] for name in candidate_names() if name.startswith(model_variant + "__")}
        for frame in heldout:
            features = feature_map(frame["image"], references[test_id])
            height, width = frame["image"].shape[:2]
            probability = model.predict_proba(features.reshape(-1, features.shape[-1]))[:, 1].reshape(height, width)
            difference = temporal_difference(frame["image"], references[test_id])
            guarded = {guard: camera_information_guard(frame["image"], guard) for guard in DOMAIN_GUARDS if guard != "no_guard"}
            for inference_variant in INFERENCE_VARIANTS:
                raw_prediction = postprocess(probability, difference, inference_variant)
                for guard in DOMAIN_GUARDS:
                    candidate = f"{model_variant}__{inference_variant}__{guard}"
                    guard_active = guarded.get(guard, False)
                    prediction = np.zeros_like(raw_prediction) if guard_active else raw_prediction
                    row = {**frame_metrics(frame, prediction), "small_or_dim": frame["small_or_dim"], "camera_guard_active": guard_active}
                    candidate_rows[candidate].append(row)
                    destination = root / "vision-v6/fold-predictions" / candidate / test_id
                    destination.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(destination / frame["name"]), prediction * 255)
        for candidate, rows in candidate_rows.items():
            result["candidates"][candidate] = rows
            print(f"fold {test_id}: {candidate} {summarize(rows)}", flush=True)
        del model
        gc.collect()
    output = root / "vision-v6/folds"
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{test_id}.json").write_text(json.dumps(result, indent=2))
    del X, y, w
    if preloaded is None:
        del cache
    gc.collect()


def run_all_folds(root: Path):
    """Reuse immutable inputs across folds; no model or sampling setting changes."""
    _, frames, references = load_development(root)
    cache = joblib.load(sample_cache_path(root))
    preloaded = (frames, references, cache)
    for test_id in DEVELOPMENT_TESTS:
        path = root / f"vision-v6/folds/{test_id}.json"
        if path.exists():
            print(f"fold {test_id}: existing complete result retained", flush=True)
            continue
        print(f"=== START {test_id} {datetime.now(timezone.utc).isoformat()} ===", flush=True)
        run_fold(root, test_id, preloaded=preloaded)
        print(f"=== DONE {test_id} {datetime.now(timezone.utc).isoformat()} ===", flush=True)


def frozen_v5_reference(root: Path, frames):
    rows = []
    for frame in frames:
        test, name = frame["test_id"], frame["name"]
        if test in ("B13", "B15", "B16"):
            path = root / "confirmation-v5/frozen-predictions/v5" / test / name
        else:
            path = root / "vision-v5/fold-predictions/unweighted__small_core_bounded_hysteresis_r4" / test / name
        prediction = cv2.imread(str(path), 0)
        if prediction is None:
            raise ValueError(f"Missing frozen v5 reference prediction {path}")
        rows.append({**frame_metrics(frame, (prediction > 0).astype(np.uint8)), "small_or_dim": frame["small_or_dim"]})
    return rows


def subset_summary(rows, small_or_dim=None):
    selected = rows if small_or_dim is None else [r for r in rows if r["small_or_dim"] == small_or_dim]
    return summarize(selected)


def summarize_development(root: Path):
    _, frames, _ = load_development(root)
    baseline_rows = frozen_v5_reference(root, frames)
    baseline = {"pooled": subset_summary(baseline_rows), "small_or_dim": subset_summary(baseline_rows, True), "per_test": {t: subset_summary([r for r in baseline_rows if r["test_id"] == t]) for t in DEVELOPMENT_TESTS}}
    comparison = {
        "schema": "falmex-vision-v6-development-comparison-v1",
        "status": "model-selection estimates on development only; not confirmation",
        "split": "leave-one-test-out over 15 development tests",
        "selection_rule": CONFIG["selection_rule"], "config": CONFIG,
        "frozen_v5_retrospective_reference": baseline, "candidates": {},
        "candidate_provenance": {name: ("pre_fold_development_refinement" if name.endswith("__camera_information_guard_v2") else "preregistered_initial_candidate") for name in candidate_names()},
    }
    for candidate in candidate_names():
        rows = []
        for test in DEVELOPMENT_TESTS:
            fold = json.loads((root / f"vision-v6/folds/{test}.json").read_text())
            rows += fold["candidates"][candidate]
        if len(rows) != len(frames):
            raise ValueError(f"Incomplete folds for {candidate}")
        comparison["candidates"][candidate] = {
            "per_test": {test: subset_summary([r for r in rows if r["test_id"] == test]) for test in DEVELOPMENT_TESTS},
            "pooled": subset_summary(rows), "small_or_dim": subset_summary(rows, True), "per_frame": rows,
            "camera_guard_activations": [r["frame"] for r in rows if r["camera_guard_active"]],
        }
    max_fp = baseline["pooled"]["fp"] * CONFIG["constraints"]["max_fp_vs_frozen_v5_reference"]
    max_negative_fp = baseline["pooled"]["negative_false_positive_pixels"] * CONFIG["constraints"]["max_negative_fp_vs_frozen_v5_reference"]
    eligible = []
    for candidate, data in comparison["candidates"].items():
        pooled = data["pooled"]
        failures = {
            "detection_failures": pooled["positive_detection_failures"] > CONFIG["constraints"]["max_detection_failures"],
            "false_positive_pixels": pooled["fp"] > max_fp,
            "negative_false_positive_pixels": pooled["negative_false_positive_pixels"] > max_negative_fp,
        }
        data["eligible"] = not any(failures.values())
        data["constraint_failures"] = failures
        if data["eligible"]:
            eligible.append(candidate)
    pool = eligible or candidate_names()
    ranking = sorted(pool, key=lambda c: (comparison["candidates"][c]["small_or_dim"]["positive_macro_iou"], comparison["candidates"][c]["pooled"]["positive_macro_iou"], -comparison["candidates"][c]["pooled"]["fp"]), reverse=True)
    comparison["eligible_candidates"] = eligible
    comparison["selected_candidate"] = ranking[0]
    comparison["ranking"] = ranking
    comparison["selection_fallback_used"] = not eligible
    comparison["fp_ceiling"] = max_fp
    comparison["negative_fp_ceiling"] = max_negative_fp
    output = root / "vision-v6"
    (output / "development-comparison.json").write_text(json.dumps(comparison, indent=2))
    for candidate, data in comparison["candidates"].items():
        (output / f"development-per-frame-{candidate}.json").write_text(json.dumps(data["per_frame"], indent=2))
    print(json.dumps({"selected": ranking[0], "eligible": eligible, "baseline": baseline, "candidates": {c: {"pooled": comparison["candidates"][c]["pooled"], "small_or_dim": comparison["candidates"][c]["small_or_dim"], "eligible": comparison["candidates"][c]["eligible"]} for c in candidate_names()}}, indent=2))


def train_final(root: Path):
    if not (root / "confirmation-v6/selection-freeze.json").exists():
        raise ValueError("Metadata-only confirmation selection must be frozen before final model training")
    comparison = json.loads((root / "vision-v6/development-comparison.json").read_text())
    selected = comparison["selected_candidate"]
    model_variant, inference_variant, domain_guard = selected.split("__")
    _, frames, _ = load_development(root)
    cache = joblib.load(sample_cache_path(root))
    X, y, w = concatenate_training(cache["samples"])
    print(f"fitting final {selected} on {X.shape}", flush=True)
    model = new_model().fit(X, y, sample_weight=w if model_variant == "frame_dim_balanced" else None)
    bundle = {"model": model, "candidate": selected, "model_variant": model_variant, "inference_variant": inference_variant, "domain_guard": domain_guard, "config": CONFIG, "feature_names": FEATURE_NAMES, "development_tests": DEVELOPMENT_TESTS, "training_frames": [f["name"] for f in frames], "annotation_scope": "coarse AI-assistant polygons, not independent-expert gold masks"}
    output = root / "vision-v6"
    (output / "models").mkdir(parents=True, exist_ok=True)
    model_path = output / "models/falmex-vision-v6.joblib"
    joblib.dump(bundle, model_path, compress=3)
    freeze = {
        "schema": "falmex-vision-v6-freeze-v1", "created_utc": datetime.now(timezone.utc).isoformat(),
        "model_file": str(model_path.relative_to(root)), "model_sha256": sha256(model_path),
        "selected_candidate": selected, "selection_rule": CONFIG["selection_rule"], "config": CONFIG,
        "candidate_provenance": comparison["candidate_provenance"][selected], "feature_names": FEATURE_NAMES,
        "development_tests": list(DEVELOPMENT_TESTS), "reserved_confirmation_tests": list(CONFIRMATION_TESTS),
        "confirmation_status": "B14/B17/B18 video bytes downloaded and metadata-only selection permitted; no confirmation frames or model outputs read at v6 model freeze",
        "development_input_sha256": {relative: sha256(root / relative) for relative in ("development-v6/selection.json", "metadata/vision-v6-split.json", "metadata/vision-v6-protocol-freeze.json", "scripts/falmex_vision_v6.py", "confirmation-v5/annotations/polygons.json", "confirmation-v5/annotations/rasterization-manifest.json")},
        "software": {"python": platform.python_version(), "numpy": np.__version__, "opencv": cv2.__version__, "lightgbm": lgb.__version__},
    }
    (output / "model-freeze.json").write_text(json.dumps(freeze, indent=2))
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
    prediction = postprocess(probability, temporal_difference(image, reference), bundle["inference_variant"])
    if bundle["domain_guard"] != "no_guard" and camera_information_guard(image, bundle["domain_guard"]):
        return np.zeros_like(prediction)
    return prediction


def predict_video(root: Path, args):
    freeze = json.loads((root / "vision-v6/model-freeze.json").read_text())
    model_path = root / freeze["model_file"]
    if sha256(model_path) != freeze["model_sha256"]:
        raise ValueError("Frozen v6 model hash mismatch; refusing prediction")
    bundle = joblib.load(model_path)
    if bundle["config"] != CONFIG or bundle["feature_names"] != FEATURE_NAMES:
        raise ValueError("Inference code differs from frozen v6 model")
    video, output = Path(args.video).resolve(), Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    reference = reference_frame(video, CONFIG["reference_frames"])
    records = []
    for index in [int(x) for x in args.frames.split(",") if x.strip()]:
        image = read_frame(video, index)
        prediction = predict_mask(bundle, image, reference)
        name = f"{args.test_id}_{index:06d}.png"
        cv2.imwrite(str(output / name), prediction * 255)
        guard_active = bundle["domain_guard"] != "no_guard" and camera_information_guard(image, bundle["domain_guard"])
        records.append({"test_id": args.test_id, "frame_index": index, "mask": name, "prediction_area_px": int(prediction.sum()), "camera_guard_active": guard_active})
    (output / "predictions.json").write_text(json.dumps({"model_sha256": freeze["model_sha256"], "candidate": bundle["candidate"], "video": video.name, "video_sha256": sha256(video), "frames": records}, indent=2))
    print(json.dumps({"test_id": args.test_id, "frames": len(records), "model_sha256": freeze["model_sha256"]}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    fold = sub.add_parser("run-fold")
    fold.add_argument("--test-id", required=True, choices=DEVELOPMENT_TESTS)
    sub.add_parser("run-all-folds")
    sub.add_parser("summarize")
    sub.add_parser("train-final")
    inference = sub.add_parser("predict-video")
    inference.add_argument("--video", required=True)
    inference.add_argument("--test-id", required=True)
    inference.add_argument("--frames", required=True)
    inference.add_argument("--output", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "prepare":
        prepare(root)
    elif args.command == "run-fold":
        run_fold(root, args.test_id)
    elif args.command == "run-all-folds":
        run_all_folds(root)
    elif args.command == "summarize":
        summarize_development(root)
    elif args.command == "train-final":
        train_final(root)
    else:
        predict_video(root, args)


if __name__ == "__main__":
    main()
