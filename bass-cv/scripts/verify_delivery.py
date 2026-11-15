#!/usr/bin/env python3
"""Verify frozen Falmex Vision v3 delivery without changing model artifacts."""
from __future__ import annotations

import hashlib
import json
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import joblib
import numpy as np
import sklearn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from falmex_vision_v3 import CONFIG, predict, read_frame, reference_frame, sha256, summarize  # noqa: E402


def load(relative: str):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def main() -> None:
    checks: dict[str, object] = {}
    failures: list[str] = []

    def record(name: str, passed: bool, details: object) -> None:
        checks[name] = {"passed": bool(passed), "details": details}
        if not passed:
            failures.append(name)

    freeze = load("vision-v3/model-freeze.json")
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

    inference = load("confirmation-v3/inference-freeze.json")
    prediction_results = []
    for item in inference["prediction_files"]:
        actual = sha256(ROOT / item["file"])
        prediction_results.append({
            "file": item["file"], "passed": actual == item["sha256"],
            "expected": item["sha256"], "actual": actual,
        })
    record("frozen_prediction_hashes", all(x["passed"] for x in prediction_results), {
        "files": len(prediction_results),
        "mismatches": [x for x in prediction_results if not x["passed"]],
    })
    record("model_inference_freeze_link", inference["model_sha256"] == model_hash, {
        "inference_model_sha256": inference["model_sha256"],
    })

    dev_rows = load("vision-v3/development-per-frame.json")
    dev_metrics = load("vision-v3/development-metrics.json")
    dev_positive = sum(bool(row["flame_visible"]) for row in dev_rows)
    dev_negative = len(dev_rows) - dev_positive
    record("development_row_counts", len(dev_rows) == 48 and dev_positive == 33 and dev_negative == 15, {
        "frames": len(dev_rows), "positive": dev_positive, "negative": dev_negative,
    })
    record("development_summary_recomputation", summarize(dev_rows) == dev_metrics["pooled"], {
        "recomputed": summarize(dev_rows), "stored": dev_metrics["pooled"],
    })

    confirmation_rows = load("confirmation-v3/per-frame-metrics.json")
    confirmation_metrics = load("confirmation-v3/metrics.json")
    confirmation_selection = load("confirmation-v3/selection.json")
    conf_positive = sum(bool(row["flame_visible"]) for row in confirmation_rows)
    conf_negative = len(confirmation_rows) - conf_positive
    record("confirmation_row_counts", (
        len(confirmation_rows) == 24 and len(confirmation_selection) == 24
        and conf_positive == 20 and conf_negative == 4
    ), {
        "metric_rows": len(confirmation_rows), "selection_rows": len(confirmation_selection),
        "positive": conf_positive, "negative": conf_negative,
    })
    record("confirmation_summary_recomputation", summarize(confirmation_rows) == confirmation_metrics["pooled"], {
        "recomputed": summarize(confirmation_rows), "stored": confirmation_metrics["pooled"],
    })
    record("confirmation_test_coverage", {
        test: sum(row["test_id"] == test for row in confirmation_rows) for test in ("B6", "B8", "B12")
    } == {"B6": 8, "B8": 8, "B12": 8}, {
        test: sum(row["test_id"] == test for row in confirmation_rows) for test in ("B6", "B8", "B12")
    })

    raw_results = []
    for manifest_name in ("source-manifest.json", "confirmation-manifest.json", "v3-confirmation-manifest.json"):
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
    record("raw_source_hashes_and_sizes", all(
        x["exists"] and x["hash_passed"] and x["bytes_passed"] for x in raw_results
    ), {"files": len(raw_results), "failures": [x for x in raw_results if not all(
        (x["exists"], x["hash_passed"], x["bytes_passed"]))]})

    selected = next(row for row in confirmation_selection if row["test_id"] == "B6" and row["frame_index"] == 259)
    bundle = joblib.load(model_path)
    video = ROOT / selected["video"]
    image = read_frame(video, 259)
    reference = reference_frame(video, CONFIG["reference_frames"])
    reproduced = predict(bundle["model"], image, reference)
    frozen = (cv2.imread(
        str(ROOT / "confirmation-v3/frozen-predictions/B6/B6_000259.png"), 0) > 0).astype(np.uint8)
    differing = int(np.count_nonzero(reproduced != frozen))
    record("selected_frame_inference_reproduction", reproduced.shape == frozen.shape and differing == 0, {
        "test_id": "B6", "frame_index": 259, "differing_pixels": differing,
        "reproduced_area_px": int(reproduced.sum()), "frozen_area_px": int(frozen.sum()),
    })

    compile_failures = []
    script_paths = sorted((ROOT / "scripts").glob("*.py"))
    for path in script_paths:
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except Exception as exc:  # report all syntax failures together
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
        "schema": "falmex-vision-v3-delivery-verification-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if not failures else "failed",
        "failures": failures,
        "software": {
            "python": platform.python_version(), "numpy": np.__version__,
            "opencv": cv2.__version__, "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "checks": checks,
    }
    destination = ROOT / "vision-v3/delivery-verification.json"
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"status": report["status"], "failures": failures,
                      "report": str(destination.relative_to(ROOT))}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
