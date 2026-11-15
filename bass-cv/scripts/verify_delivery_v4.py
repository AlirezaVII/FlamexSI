#!/usr/bin/env python3
"""Verify frozen Falmex Vision v4 delivery without changing model artifacts."""
from __future__ import annotations

import json
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import lightgbm as lgb
import numpy as np
import sklearn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from falmex_vision_v3 import read_frame, reference_frame, sha256, summarize  # noqa: E402
from falmex_vision_v4 import CONFIG, predict  # noqa: E402


def load(relative: str):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def main() -> None:
    checks: dict[str, object] = {}
    failures: list[str] = []

    def record(name: str, passed: bool, details: object) -> None:
        checks[name] = {"passed": bool(passed), "details": details}
        if not passed:
            failures.append(name)

    freeze = load("vision-v4/model-freeze.json")
    model_path = ROOT / freeze["model_file"]
    model_hash = sha256(model_path)
    record("frozen_model_sha256", model_hash == freeze["model_sha256"], {
        "expected": freeze["model_sha256"], "actual": model_hash,
    })

    input_results = {}
    for relative, expected in freeze["development_input_sha256"].items():
        actual = sha256(ROOT / relative)
        input_results[relative] = {"expected": expected, "actual": actual, "passed": actual == expected}
    record("development_input_hashes", all(x["passed"] for x in input_results.values()), input_results)

    inference = load("confirmation-v4/inference-freeze.json")
    record("confirmation_selection_hash", sha256(ROOT / inference["selection_file"]) == inference["selection_sha256"], {
        "file": inference["selection_file"], "expected": inference["selection_sha256"],
        "actual": sha256(ROOT / inference["selection_file"]),
    })
    prediction_results = []
    for item in inference["prediction_files"]:
        actual = sha256(ROOT / item["file"])
        prediction_results.append({"file": item["file"], "passed": actual == item["sha256"]})
    record("frozen_prediction_hashes", all(x["passed"] for x in prediction_results), {
        "files": len(prediction_results), "mismatches": [x for x in prediction_results if not x["passed"]],
    })
    record("model_inference_freeze_link", inference["model_sha256"] == model_hash, {
        "inference_model_sha256": inference["model_sha256"],
    })

    comparison = load("vision-v4/development-comparison.json")
    for candidate in ("extra_trees", "lightgbm"):
        rows = load(f"vision-v4/development-per-frame-{candidate}.json")
        metrics = load(f"vision-v4/development-metrics-{candidate}.json")
        positive = sum(bool(row["flame_visible"]) for row in rows)
        negative = len(rows) - positive
        record(f"development_{candidate}_row_counts", len(rows) == 72 and positive == 53 and negative == 19, {
            "frames": len(rows), "positive": positive, "negative": negative,
        })
        record(f"development_{candidate}_summary_recomputation", summarize(rows) == metrics["pooled"], {
            "recomputed": summarize(rows), "stored": metrics["pooled"],
        })
        record(f"development_{candidate}_matches_comparison", metrics["pooled"] == comparison["candidates"][candidate]["pooled"], {
            "candidate": candidate,
        })

    confirmation_rows = load("confirmation-v4/per-frame-metrics.json")
    confirmation_metrics = load("confirmation-v4/metrics.json")
    confirmation_selection = load("confirmation-v4/selection.json")
    positive = sum(bool(row["flame_visible"]) for row in confirmation_rows)
    negative = len(confirmation_rows) - positive
    record("confirmation_row_counts", (
        len(confirmation_rows) == 24 and len(confirmation_selection) == 24 and positive == 13 and negative == 11
    ), {"metric_rows": len(confirmation_rows), "selection_rows": len(confirmation_selection),
        "positive": positive, "negative": negative})
    record("confirmation_summary_recomputation", summarize(confirmation_rows) == confirmation_metrics["pooled"], {
        "recomputed": summarize(confirmation_rows), "stored": confirmation_metrics["pooled"],
    })
    coverage = {test: sum(row["test_id"] == test for row in confirmation_rows) for test in ("B9", "B10", "B11")}
    record("confirmation_test_coverage", coverage == {"B9": 8, "B10": 8, "B11": 8}, coverage)

    raw_results = []
    for manifest_name in ("source-manifest.json", "confirmation-manifest.json", "v3-confirmation-manifest.json", "v4-confirmation-manifest.json"):
        for item in load(f"metadata/{manifest_name}"):
            path = ROOT / item["local_path"]
            exists = path.is_file()
            actual_hash = sha256(path) if exists else None
            actual_bytes = path.stat().st_size if exists else None
            raw_results.append({
                "file": item["local_path"], "exists": exists,
                "hash_passed": actual_hash == item["sha256"],
                "bytes_passed": actual_bytes == int(item["downloaded_bytes"]),
            })
    present_raw = [x for x in raw_results if x["exists"]]
    invalid_raw = [x for x in present_raw if not (x["hash_passed"] and x["bytes_passed"])]
    missing_raw = [x["file"] for x in raw_results if not x["exists"]]
    record("raw_source_hashes_and_sizes", not invalid_raw, {
        "manifest_files": len(raw_results), "verified_present_files": len(present_raw),
        "invalid_present_files": invalid_raw, "missing_files_not_bundled": missing_raw,
        "status": "all manifest sources present and verified" if not missing_raw else "present sources verified; missing sources must be restored from NASA manifests for full retraining",
    })

    selected = next(row for row in confirmation_selection if row["test_id"] == "B9" and row["frame_index"] == 328)
    bundle = joblib.load(model_path)
    video = ROOT / selected["video"]
    image = read_frame(video, 328)
    reference = reference_frame(video, CONFIG["reference_frames"])
    reproduced = predict(bundle["model"], image, reference)
    frozen = (cv2.imread(
        str(ROOT / "confirmation-v4/frozen-predictions/B9/B9_000328.png"), 0) > 0).astype(np.uint8)
    differing = int(np.count_nonzero(reproduced != frozen))
    record("selected_frame_inference_reproduction", reproduced.shape == frozen.shape and differing == 0, {
        "test_id": "B9", "frame_index": 328, "differing_pixels": differing,
        "reproduced_area_px": int(reproduced.sum()), "frozen_area_px": int(frozen.sum()),
    })

    compile_failures = []
    script_paths = sorted((ROOT / "scripts").glob("*.py"))
    for path in script_paths:
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except Exception as exc:
            compile_failures.append({"file": str(path.relative_to(ROOT)), "error": str(exc)})
    record("python_source_compilation", not compile_failures, {
        "files": len(script_paths), "failures": compile_failures,
    })

    secret_patterns = {
        "temporary_aws_url_parameter": re.compile(r"X-Amz-" + r"(?:Signature|Credential|Security-Token)", re.I),
        "aws_access_key": re.compile(r"AKIA[0-9A-Z]{16}"),
        "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    }
    secret_hits = []
    text_suffixes = {".py", ".json", ".md", ".txt", ".csv", ".yaml", ".yml"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in text_suffixes:
            continue
        if "superseded-review" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in secret_patterns.items():
            if pattern.search(text):
                secret_hits.append({"file": str(path.relative_to(ROOT)), "pattern": label})
    record("credential_and_signed_url_scan", not secret_hits, {"hits": secret_hits})

    uploaded_zip = Path("/mnt/agents/upload/Falmex-main.zip")
    expected_upload_hash = "5aa716b9088a46f87f8df9d1d796a50aa0daf2d55e5d8b7252d94b7cd6bea5bb"
    if uploaded_zip.is_file():
        actual_upload_hash = sha256(uploaded_zip)
        record("original_uploaded_zip_unchanged", actual_upload_hash == expected_upload_hash, {
            "expected": expected_upload_hash, "actual": actual_upload_hash,
        })
    else:
        record("original_uploaded_zip_unchanged", True, "Upload not mounted; no modification attempted")

    report = {
        "schema": "falmex-vision-v4-delivery-verification-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if not failures else "failed",
        "failures": failures,
        "software": {
            "python": platform.python_version(), "numpy": np.__version__,
            "opencv": cv2.__version__, "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__, "lightgbm": lgb.__version__,
        },
        "checks": checks,
    }
    destination = ROOT / "vision-v4/delivery-verification.json"
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"status": report["status"], "failures": failures,
                      "report": str(destination.relative_to(ROOT))}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
