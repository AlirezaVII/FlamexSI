#!/usr/bin/env python3
"""Build the small near-final Falmex competition handoff package."""
from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent
ARCHIVE = OUTPUT / "Falmex-مسابقه-پیش‌نهایی-v6.zip"


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    metrics = json.loads((ROOT / "confirmation-v6/metrics.json").read_text(encoding="utf-8"))
    pooled = {name: values["pooled"] for name, values in metrics["models"].items()}
    assert pooled["v6"]["tp"] == 0 and pooled["v6"]["positive_macro_iou"] == 0
    assert pooled["v4"]["tp"] == pooled["v5"]["tp"] == 0
    assert abs(pooled["v3"]["positive_macro_iou"] - 0.09840383817229406) < 1e-12
    verification = json.loads((ROOT / "vision-v6/delivery-verification.json").read_text(encoding="utf-8"))
    assert verification["checks"] == verification["passed"] == 55 and verification["failed"] == 0
    real_review_root = ROOT / "independent-review-results-v6"
    real_processing_path = real_review_root / "review-processing.json"
    real_processing = json.loads(real_processing_path.read_text(encoding="utf-8")) if real_processing_path.exists() else None
    real_agreement = None
    if real_processing:
        real_agreement = json.loads((real_review_root / "agreement/agreement-summary.json").read_text(encoding="utf-8"))
        assert real_processing["frames"] == real_agreement["frames"] == 24
        assert real_processing["adjudication_frames"] == 24

    status = {
        "schema": "falmex-competition-handoff-status-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": "near_final_pending_third_adjudication_and_team_portal_fields" if real_processing else "near_final_pending_external_human_review_and_team_portal_fields",
        "project": "Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data",
        "work_packages": ["FLEX / PSI-69 statistical discovery", "BASS-II / PSI-25 supervised computer vision"],
        "v6_delivery_verification": {"passed": 55, "failed": 0},
        "v6_development_fallback_used": True,
        "v6_confirmation": {
            model: {
                "positive_macro_iou": values["positive_macro_iou"],
                "micro_iou": values["micro_iou"], "tp": values["tp"],
                "fp": values["fp"], "fn": values["fn"],
            }
            for model, values in pooled.items()
        },
        "independent_human_annotations": (
            "two_user_supplied_sets_processed_identity_expertise_independence_not_verified"
            if real_processing else "awaiting_actual_submissions"
        ),
        "third_adjudication": (
            "awaiting_actual_third_adjudicator_24_frames"
            if real_processing else "pending_reviewer_agreement_analysis"
        ),
        "real_reviewer_agreement": real_agreement,
        "real_reviewer_results_created_from_uploads": bool(real_processing),
        "independent_expert_validation": False,
        "operational_readiness": False,
        "review_automation_synthetic_selftest_passed": True,
        "real_reviewer_results_created_by_selftest": False,
        "team_and_portal_fields_complete": False,
        "competition_portal_requirements_verified": False,
        "public_demo_or_website_published": False,
        "v7_tuning_after_confirmation": False,
        "evidence_archives": {
            "Falmex-Vision-v6-کامل.zip": {
                "bytes": 482831977,
                "sha256": "cd957358eee42f5c0023c9b10114c65737ac2bb26a36b9127e48cdfbcb56bce3",
            },
            "Falmex-بازبینی-مستقل-v6.zip": {
                "bytes": 30009265,
                "sha256": "df2757c9ce8b4cf715fa468a35a588f5eed54d35633a74e0e4457c4762ad7a72",
            },
            "Falmex-داور-سوم-v6.zip": {
                "bytes": 18649007,
                "sha256": "12eaad39ea6b8984cadf70aa62bff46057c5ddc045530b49e48e590fe68c6aab",
            },
        },
        "pending_review_cannot_retroactively_make_v6_successful": True,
    }
    status_path = ROOT / "submission-v6/submission-status.json"
    status_path.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")

    mapping = {
        ROOT / "submission-v6/README.md": "README.md",
        ROOT / "submission-v6/راهنمای-فارسی.md": "راهنمای-فارسی.md",
        ROOT / "submission-v6/فرم-مسابقه-پیش‌نویس.md": "فرم-مسابقه-پیش‌نویس.md",
        ROOT / "submission-v6/submission-status.json": "submission-status.json",
        ROOT / "submission-v6/review-automation-selftest.json": "review-automation-selftest.json",
        ROOT / "requirements.txt": "requirements.txt",
        ROOT / "scripts/process_independent_review_v6.py": "scripts/process_independent_review_v6.py",
        ROOT / "scripts/compare_annotations.py": "scripts/compare_annotations.py",
        ROOT / "scripts/labelme_to_masks.py": "scripts/labelme_to_masks.py",
        ROOT / "scripts/verify_delivery_v6.py": "scripts/verify_delivery_v6.py",
        ROOT / "vision-v6/MODEL_CARD.md": "vision-v6/MODEL_CARD.md",
        ROOT / "vision-v6/گزارش-فارسی.md": "vision-v6/گزارش-فارسی.md",
        ROOT / "vision-v6/delivery-verification.json": "vision-v6/delivery-verification.json",
        ROOT / "confirmation-v6/metrics.json": "confirmation-v6/metrics.json",
        ROOT / "confirmation-v6/per-frame-metrics.json": "confirmation-v6/per-frame-metrics.json",
        ROOT / "confirmation-v6/same-video-comparison.csv": "confirmation-v6/same-video-comparison.csv",
        ROOT / "confirmation-v6/results-comparison.png": "confirmation-v6/results-comparison.png",
        ROOT / "metadata/vision-v6-split.json": "metadata/vision-v6-split.json",
        OUTPUT / "Falmex-FLEX-گزارش.md": "reports/Falmex-FLEX-گزارش.md",
    }
    if real_processing:
        mapping.update({
            real_review_root / "REVIEW_ADDENDUM.md": "independent-review-results-v6/REVIEW_ADDENDUM.md",
            real_review_root / "گزارش-بازبینی-واقعی.md": "independent-review-results-v6/گزارش-بازبینی-واقعی.md",
            real_review_root / "upload-provenance.json": "independent-review-results-v6/upload-provenance.json",
            real_review_root / "review-processing.json": "independent-review-results-v6/review-processing.json",
            real_review_root / "agreement/agreement-summary.json": "independent-review-results-v6/agreement/agreement-summary.json",
            real_review_root / "agreement/agreement-per-frame.json": "independent-review-results-v6/agreement/agreement-per-frame.json",
            real_review_root / "adjudication-queue.csv": "independent-review-results-v6/adjudication-queue.csv",
            real_review_root / "agreement-contact-sheet.png": "independent-review-results-v6/agreement-contact-sheet.png",
        })
    for source, archive_name in mapping.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        if source.suffix == ".py":
            compile(source.read_text(encoding="utf-8"), archive_name, "exec")
        if source.suffix in {".py", ".json", ".md", ".txt", ".csv"}:
            content = source.read_bytes()
            markers = (b"AWS" + b"AccessKeyId", b"X-Amz-" + b"Signature", b"x-amz-" + b"security-token")
            if any(marker in content for marker in markers):
                raise ValueError(f"Temporary credential marker in {archive_name}")

    records = [
        {"file": archive_name, "bytes": source.stat().st_size, "sha256": sha256(source)}
        for source, archive_name in sorted(mapping.items(), key=lambda item: item[1])
    ]
    manifest = {
        "schema": "falmex-competition-handoff-manifest-v1",
        "created_utc": status["created_utc"],
        "status": status["status"],
        "files": records,
    }
    manifest_path = ROOT / "submission-v6/package-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    mapping[manifest_path] = "package-manifest.json"

    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=8) as archive:
        for source, archive_name in sorted(mapping.items(), key=lambda item: item[1]):
            compression = zipfile.ZIP_STORED if source.suffix == ".png" else zipfile.ZIP_DEFLATED
            archive.write(source, archive_name, compress_type=compression)
    with zipfile.ZipFile(ARCHIVE) as archive:
        corrupt = archive.testzip()
        entries = len(archive.infolist())
        packaged_status = json.loads(archive.read("submission-status.json"))
        packaged_manifest = json.loads(archive.read("package-manifest.json"))
        assert packaged_status["operational_readiness"] is False
        assert packaged_status["independent_expert_validation"] is False
        assert len(packaged_manifest["files"]) == entries - 1
    if corrupt:
        raise ValueError(f"CRC failure: {corrupt}")

    digest = sha256(ARCHIVE)
    (OUTPUT / "Falmex-مسابقه-پیش‌نهایی-v6.sha256").write_text(
        f"{digest}  {ARCHIVE.name}\n", encoding="utf-8"
    )
    shutil.copy2(ROOT / "submission-v6/راهنمای-فارسی.md", OUTPUT / "Falmex-مسابقه-راهنمای-فارسی.md")
    result = {
        "archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size,
        "entries": entries, "sha256": digest, "crc_passed": True,
        "manifest_payload_files": len(records),
        "status": status["status"], "v6_confirmation_tp": pooled["v6"]["tp"],
        "independent_human_review_pending": True,
        "third_adjudication_frames_pending": real_processing["adjudication_frames"] if real_processing else None,
    }
    (ROOT / "submission-v6/package-result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
