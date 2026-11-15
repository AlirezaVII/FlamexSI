#!/usr/bin/env python3
"""Independent structural, hash, metric and repeated-inference checks for v6."""
from __future__ import annotations

import json
import py_compile
from collections import Counter
from pathlib import Path

import cv2
import joblib
import numpy as np

import falmex_vision_v3 as v3
import falmex_vision_v4 as v4
import falmex_vision_v5 as v5
import falmex_vision_v6 as v6

ROOT = Path(__file__).resolve().parents[1]
CHECKS = []


def check(name, condition, detail=None):
    CHECKS.append({"check": name, "passed": bool(condition), "detail": detail})
    if not condition:
        print(f"FAILED: {name}: {detail}", flush=True)
    else:
        print(f"PASSED: {name}", flush=True)


def load(relative):
    return json.loads((ROOT / relative).read_text())


def main():
    for name in ("falmex_vision_v6.py", "run_confirmation_v6.py", "rasterize_confirmation_v6.py", "evaluate_confirmation_v6.py"):
        py_compile.compile(str(ROOT / "scripts" / name), doraise=True)
    check("four v6 Python entry points compile", True)

    protocol = load("metadata/vision-v6-split.json")
    protocol_freeze = load("metadata/vision-v6-protocol-freeze.json")
    check("protocol unchanged since pre-download freeze", v3.sha256(ROOT / "metadata/vision-v6-split.json") == protocol_freeze["protocol_sha256"])
    check("development and confirmation disjoint", not set(protocol["development_tests"]) & set(protocol["reserved_confirmation_tests"]))
    check("B13/B15/B16 promoted to development", {"B13", "B15", "B16"}.issubset(protocol["development_tests"]))
    check("fresh confirmation tests", protocol["reserved_confirmation_tests"] == ["B14", "B17", "B18"])
    amendment = load("metadata/vision-v6-source-integrity-amendment.json")
    check("source-integrity amendment predates selection and training", amendment["created_before_confirmation_selection_freeze"] and amendment["created_before_final_model_training"])
    check("source amendment used no pixels or model outputs", not amendment["confirmation_frame_pixels_inspected"] and not amendment["model_outputs_inspected"])
    check("original protocol retained after source amendment", amendment["original_protocol_modified"] is False)
    check("24 candidate refinement disclosed", load("metadata/vision-v6-guard-development-refinement.json")["candidate_count_after_refinement"] == 24)

    selection = load("development-v6/selection.json")
    check("132 development rows", len(selection) == 132)
    check("development contains no reserved test", all(r["test_id"] in v6.DEVELOPMENT_TESTS for r in selection))
    dev_manifest = load("development-v6/source-manifest.json")
    check("development manifest covers all rows", len(dev_manifest["frames"]) == 132)
    source_hash_pass = True
    for row in dev_manifest["frames"]:
        source_hash_pass &= v3.sha256(ROOT / row["source"]) == row["source_sha256"]
        source_hash_pass &= v3.sha256(ROOT / row["mask"]) == row["mask_sha256"]
    check("all development source and mask hashes", source_hash_pass)
    video_hash_pass = all(v3.sha256(ROOT / row["file"]) == row["sha256"] and (ROOT / row["file"]).stat().st_size == row["bytes"] for row in dev_manifest["videos"].values())
    check("all 15 development video hashes", video_hash_pass)

    _, frames, _ = v6.load_development(ROOT)
    check("74 features and 24 candidates", len(v6.FEATURE_NAMES) == 74 and len(v6.candidate_names()) == 24)
    check("guard v2 activates only on known development menu frame", [f["name"] for f in frames if v6.camera_information_guard(f["image"], "camera_information_guard_v2")] == ["B16_003563.png"])
    check("original guard remains as failed comparator", not any(v6.camera_information_guard(f["image"], "camera_information_guard") for f in frames))

    counts = Counter(f["test_id"] for f in frames)
    folds_ok, prediction_count = True, 0
    for test in v6.DEVELOPMENT_TESTS:
        path = ROOT / f"vision-v6/folds/{test}.json"
        if not path.exists():
            folds_ok = False
            continue
        fold = json.loads(path.read_text())
        folds_ok &= set(fold["candidates"]) == set(v6.candidate_names())
        for candidate, rows in fold["candidates"].items():
            folds_ok &= len(rows) == counts[test]
            for row in rows:
                mask = ROOT / "vision-v6/fold-predictions" / candidate / test / row["frame"]
                prediction_count += 1
                image = cv2.imread(str(mask), 0)
                folds_ok &= image is not None and image.shape == (480, 720) and set(np.unique(image)).issubset({0, 255})
    check("15 folds, 24 candidates and binary fold masks", folds_ok, {"prediction_masks": prediction_count})
    check("expected fold prediction count", prediction_count == 132 * 24)

    comparison = load("vision-v6/development-comparison.json")
    check("24 candidates summarized", set(comparison["candidates"]) == set(v6.candidate_names()))
    check("selected candidate in ranking", comparison["selected_candidate"] == comparison["ranking"][0])
    check("selection fallback explicit", isinstance(comparison["selection_fallback_used"], bool))
    check("v2 provenance disclosed", all(p == "pre_fold_development_refinement" for c, p in comparison["candidate_provenance"].items() if c.endswith("__camera_information_guard_v2")))
    check("FP ceiling matches frozen reference", abs(comparison["fp_ceiling"] - comparison["frozen_v5_retrospective_reference"]["pooled"]["fp"] * 1.25) < 1e-6)

    freeze = load("vision-v6/model-freeze.json")
    model_path = ROOT / freeze["model_file"]
    check("final model hash", v3.sha256(model_path) == freeze["model_sha256"])
    check("final code hash", freeze["development_input_sha256"]["scripts/falmex_vision_v6.py"] == v3.sha256(ROOT / "scripts/falmex_vision_v6.py"))
    check("final development manifest hash inputs exist", all((ROOT / p).exists() for p in freeze["development_input_sha256"]))
    bundle = joblib.load(model_path)
    check("final bundle matches inference code", bundle["config"] == v6.CONFIG and bundle["feature_names"] == v6.FEATURE_NAMES)
    check("final candidate matches development selection", bundle["candidate"] == comparison["selected_candidate"])
    check("no confirmation in final training frames", all(name.split("_")[0] not in v6.CONFIRMATION_TESTS for name in bundle["training_frames"]))

    confirmation_sources = load("metadata/v6-confirmation-manifest.json")
    source_rows = {row["test_id"]: row for row in confirmation_sources["files"]}
    check("three confirmation source records", set(source_rows) == set(v6.CONFIRMATION_TESTS))
    check("B14/B18 integrity replacements used", source_rows["B14"]["file"].endswith("TESTB14_2ND_VIEW.mp4") and source_rows["B18"]["file"].endswith("TESTB18_2ND_VIEW.mp4"))
    confirmation_video_ok = True
    for test, row in source_rows.items():
        video = ROOT / row["file"]
        confirmation_video_ok &= video.stat().st_size == row["bytes"] == row["expected_bytes"]
        confirmation_video_ok &= v3.sha256(video) == row["sha256"]
        capture = cv2.VideoCapture(str(video))
        confirmation_video_ok &= int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) > 1
        capture.release()
    check("confirmation video sizes hashes and container metadata", confirmation_video_ok)

    confirmation_selection = load("confirmation-v6/selection.json")
    selection_freeze = load("confirmation-v6/selection-freeze.json")
    inference = load("confirmation-v6/inference-freeze.json")
    check("24 confirmation selections", len(confirmation_selection) == 24)
    check("selection hash frozen", v3.sha256(ROOT / "confirmation-v6/selection.json") == selection_freeze["selection_sha256"] == inference["selection_sha256"])
    check("selection freeze predates inference", selection_freeze["created_utc"] < inference["created_utc"])
    check("model freeze postdates selection freeze", freeze["created_utc"] >= selection_freeze["created_utc"])
    check("protocol hash in inference", inference["protocol_sha256"] == protocol_freeze["protocol_sha256"])
    check("96 frozen predictions", len(inference["frames"]) == 96)
    check("four model keys", set(r["model"] for r in inference["frames"]) == {"v3", "v4", "v5", "v6"})
    prediction_hashes_ok = all(v3.sha256(ROOT / r["mask"]) == r["mask_sha256"] for r in inference["frames"])
    check("all frozen prediction hashes", prediction_hashes_ok)
    source_hashes_ok = all(v3.sha256(ROOT / r["source_frame"]) == r["source_sha256"] for r in inference["frames"])
    check("all confirmation source hashes", source_hashes_ok)

    raster = load("confirmation-v6/annotations/rasterization-manifest.json")
    check("source-only non-expert annotation", raster["source_only_annotation"] and not raster["independent_expert_annotation"])
    check("24 rasterized reference masks", len(raster["frames"]) == 24)
    annotation_freeze = load("confirmation-v6/annotation-freeze.json")
    check("annotation frozen after inference", annotation_freeze["created_utc"] > inference["created_utc"])
    check("annotation freeze binds inference", annotation_freeze["inference_freeze_sha256"] == v3.sha256(ROOT / "confirmation-v6/inference-freeze.json"))
    annotation_hashes_ok = all(v3.sha256(ROOT / "confirmation-v6/annotations/masks" / name) == digest for name, digest in annotation_freeze["mask_sha256"].items())
    check("all confirmation annotation hashes", annotation_hashes_ok)
    review = load("independent-review-v6/manifest.json")
    check("v6 independent review still awaits humans", review["status"] == "awaiting_independent_human_annotations" and review["source_frames"] == 24)
    reviewer_templates = list((ROOT / "independent-review-v6").glob("reviewer-*/*.json"))
    check("48 blank independent reviewer templates", len(reviewer_templates) == 48 and all(not json.loads(path.read_text())["shapes"] for path in reviewer_templates))
    metrics = load("confirmation-v6/metrics.json")
    check("four models evaluated", set(metrics["models"]) == {"v3", "v4", "v5", "v6"})
    check("operational readiness false", metrics["operational_readiness"] is False)
    check("independent expert annotation false", metrics["independent_expert_annotation"] is False)
    check("three video clusters only", metrics["video_clusters"] == 3)
    check("v6 paired comparisons present", set(metrics["paired_differences"]) == {"v6_minus_v3", "v6_minus_v4", "v6_minus_v5"})

    # Pixel-identical repeated v6 inference on all reserved frames, after all freezes.
    repeated = True
    by_key = {(r["model"], r["test_id"], r["frame_index"]): r for r in inference["frames"]}
    for test in v6.CONFIRMATION_TESTS:
        rows = [r for r in confirmation_selection if r["test_id"] == test]
        reference = v3.reference_frame(ROOT / rows[0]["video"], 30)
        for row in rows:
            image = cv2.imread(str(ROOT / row["file"]))
            actual = v6.predict_mask(bundle, image, reference)
            record = by_key[("v6", test, row["frame_index"])]
            expected = (cv2.imread(str(ROOT / record["mask"]), 0) > 0).astype(np.uint8)
            repeated &= np.array_equal(actual, expected)
    check("pixel-identical repeated v6 inference on all 24 frames", repeated)

    failed = [r for r in CHECKS if not r["passed"]]
    report = {"schema": "falmex-vision-v6-delivery-verification-v1", "checks": len(CHECKS), "passed": len(CHECKS) - len(failed), "failed": len(failed), "results": CHECKS}
    (ROOT / "vision-v6/delivery-verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"checks": len(CHECKS), "passed": len(CHECKS) - len(failed), "failed": len(failed)}, indent=2))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
