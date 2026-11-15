#!/usr/bin/env python3
"""Build self-contained, secret-scanned v6 delivery and review archives."""
from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent
ARCHIVE = OUTPUT / "FlamexSI-Vision-v6-full.zip"
REVIEW_ARCHIVE = OUTPUT / "FlamexSI-independent-review-v6.zip"


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_tree(files: set[Path], directory: Path, suffixes=None):
    if not directory.exists():
        raise FileNotFoundError(directory)
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix in {".log", ".pid", ".pyc", ".part"} or any(
            part in {"__pycache__", "cache", "rejected-downloads"} for part in path.parts
        ):
            continue
        if path.name in {"package-result.json", "package-error.log"}:
            continue
        if suffixes and path.suffix not in suffixes:
            continue
        files.add(path)


def main():
    files: set[Path] = set()
    for relative in (
        "requirements.txt",
        "metadata/PSI-25-investigation.json",
        "metadata/vision-v6-split.json",
        "metadata/vision-v6-protocol-freeze.json",
        "metadata/vision-v6-guard-development-refinement.json",
        "metadata/vision-v6-source-integrity-amendment.json",
        "metadata/v6-confirmation-manifest.json",
        "development-v6/selection.json",
        "development-v6/source-manifest.json",
        "confirmation-v5/annotations/polygons.json",
        "confirmation-v5/annotations/rasterization-manifest.json",
        "FlamexSI-Vision-v6-report.md",
    ):
        path = ROOT / relative
        if not path.exists():
            raise FileNotFoundError(path)
        files.add(path)

    add_tree(files, ROOT / "scripts", {".py"})
    # The superseded v5 verifier contains literal secret detectors; it is not needed by v6.
    files.discard(ROOT / "scripts/verify_delivery_v5.py")
    add_tree(files, ROOT / "vision-v6")
    add_tree(files, ROOT / "confirmation-v6")
    add_tree(files, ROOT / "independent-review-v6")
    for version in ("v3", "v4", "v5"):
        for relative in (f"vision-{version}/model-freeze.json", f"vision-{version}/MODEL_CARD.md"):
            files.add(ROOT / relative)
        add_tree(files, ROOT / f"vision-{version}/models")
    for relative in ("vision-v5/report.md", "FlamexSI-Vision-v4-report.md", "FlamexSI-Vision-v3-report.md"):
        files.add(ROOT / relative)

    confirmation_sources = json.loads((ROOT / "metadata/v6-confirmation-manifest.json").read_text())
    for row in confirmation_sources["files"]:
        files.add(ROOT / row["file"])

    development = json.loads((ROOT / "development-v6/selection.json").read_text())
    for row in development:
        for key in ("file", "mask", "video", "annotation_polygons"):
            value = row.get(key)
            if isinstance(value, str) and (ROOT / value).is_file():
                files.add(ROOT / value)
        test = row["test_id"]
        name = Path(row["file"]).name
        if test in ("B13", "B15", "B16"):
            files.add(ROOT / "confirmation-v5/frozen-predictions/v5" / test / name)
        else:
            files.add(ROOT / "vision-v5/fold-predictions/unweighted__small_core_bounded_hysteresis_r4" / test / name)

    for path in files:
        if not path.is_file():
            raise FileNotFoundError(path)
        relative = path.relative_to(ROOT)
        if any(part in {"rejected-downloads", "cache", "__pycache__"} for part in relative.parts):
            raise ValueError(f"Excluded path selected: {relative}")
        if path.name.endswith((".part", ".log", ".pid")) or ".range-" in path.name:
            raise ValueError(f"Temporary path selected: {relative}")
        if path.suffix in {".py", ".json", ".md", ".txt", ".csv"}:
            content = path.read_bytes()
            markers = (
                b"AWS" + b"AccessKeyId",
                b"X-Amz-" + b"Signature",
                b"x-amz-" + b"security-token",
            )
            for marker in markers:
                if marker in content:
                    raise ValueError(f"Temporary credential marker in {relative}")

    # A manifest cannot contain its own hash; regenerate it strictly from payload files.
    files.discard(ROOT / "vision-v6/delivery-manifest.json")
    records = []
    for path in sorted(files, key=lambda p: str(p.relative_to(ROOT))):
        records.append({
            "file": str(path.relative_to(ROOT)),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })
    manifest = {
        "schema": "falmex-vision-v6-delivery-manifest-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "accession": "PSI-25",
        "doi": "10.60555/4qc4-de67",
        "confirmation_result": "v6 zero TP on five coarse source-only positive references; development gains did not generalize",
        "operational_readiness": False,
        "independent_expert_annotation": False,
        "files": records,
    }
    manifest_path = ROOT / "vision-v6/delivery-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    files.add(manifest_path)

    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5, allowZip64=True) as archive:
        for path in sorted(files, key=lambda p: str(p.relative_to(ROOT))):
            compression = zipfile.ZIP_STORED if path.suffix in {".mp4", ".png", ".joblib"} else zipfile.ZIP_DEFLATED
            archive.write(path, str(path.relative_to(ROOT)), compress_type=compression)
    with zipfile.ZipFile(ARCHIVE) as archive:
        corrupt = archive.testzip()
        if corrupt is not None:
            raise ValueError(f"CRC failure: {corrupt}")
        entries = len(archive.infolist())

    review_files: set[Path] = set()
    add_tree(review_files, ROOT / "independent-review-v6")
    for relative in (
        "confirmation-v6/selection.json",
        "scripts/compare_annotations.py",
        "scripts/labelme_to_masks.py",
        "requirements.txt",
    ):
        review_files.add(ROOT / relative)
    add_tree(review_files, ROOT / "confirmation-v6/source-frames", {".png"})
    with zipfile.ZipFile(REVIEW_ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for path in sorted(review_files, key=lambda p: str(p.relative_to(ROOT))):
            archive.write(path, str(path.relative_to(ROOT)))
    with zipfile.ZipFile(REVIEW_ARCHIVE) as archive:
        corrupt = archive.testzip()
        if corrupt is not None:
            raise ValueError(f"Review CRC failure: {corrupt}")
        review_entries = len(archive.infolist())

    result = {
        "archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size,
        "entries": entries, "sha256": sha256(ARCHIVE), "crc_passed": True,
        "review_archive": str(REVIEW_ARCHIVE), "review_bytes": REVIEW_ARCHIVE.stat().st_size,
        "review_entries": review_entries, "review_sha256": sha256(REVIEW_ARCHIVE),
        "review_crc_passed": True,
    }
    (OUTPUT / "FlamexSI-Vision-v6-full.sha256").write_text(result["sha256"] + "  " + ARCHIVE.name + "\n", encoding="utf-8")
    (OUTPUT / "FlamexSI-independent-review-v6.sha256").write_text(result["review_sha256"] + "  " + REVIEW_ARCHIVE.name + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
