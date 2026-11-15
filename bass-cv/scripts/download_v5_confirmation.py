#!/usr/bin/env python3
"""Download only the preregistered v5 confirmation files from NASA PSI-25.

No signed URL, temporary query parameter, or credential is logged or persisted.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
API = "https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download"


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def metadata_entries():
    data = json.loads((ROOT / "metadata/PSI-25-investigation.json").read_text())
    split = json.loads((ROOT / "metadata/vision-v5-split.json").read_text())
    wanted = set(split["confirmation_videos"].values())
    entries = []

    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("file_name") in wanted and any(
                    obj.get("subcategory", "").endswith("/" + test)
                    for test in split["reserved_confirmation_tests"]):
                entries.append(obj)
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    walk(data)
    return split, {entry["file_name"]: entry for entry in entries}


def main():
    split, entries = metadata_entries()
    session = requests.Session()
    manifest = {
        "schema": "falmex-vision-v5-confirmation-source-manifest-v1",
        "accession": "PSI-25", "doi": "10.60555/4qc4-de67",
        "download_api": API, "files": [],
    }
    for test in split["reserved_confirmation_tests"]:
        name = split["confirmation_videos"][test]
        entry = entries[name]
        destination = ROOT / "raw" / name
        expected = int(entry["file_size"])
        part = destination.with_suffix(destination.suffix + ".part")
        if destination.exists() and destination.stat().st_size == expected:
            part.unlink(missing_ok=True)
        else:
            for attempt in range(5):
                try:
                    gateway = session.get(API, params={"file": name, "redirect": "false"}, timeout=(30, 90))
                    gateway.raise_for_status()
                    source = gateway.text.strip().strip('"')
                    if not source.startswith(("https://", "http://")):
                        raise IOError("NASA download gateway did not return a file URL")
                    offset = part.stat().st_size if part.exists() else 0
                    headers = {"Range": f"bytes={offset}-"} if offset else {}
                    with session.get(source, headers=headers, stream=True, timeout=(30, 180)) as response:
                        response.raise_for_status()
                        if offset and response.status_code != 206:
                            offset = 0
                        mode = "ab" if offset else "wb"
                        with part.open(mode) as handle:
                            for chunk in response.iter_content(1024 * 1024):
                                if chunk:
                                    handle.write(chunk)
                    if part.stat().st_size != expected:
                        raise IOError(f"Incomplete file: {part.stat().st_size} of {expected} bytes")
                    part.replace(destination)
                    break
                except Exception as error:
                    print(f"{test}: attempt {attempt + 1} incomplete ({type(error).__name__})", flush=True)
                    if attempt == 4:
                        raise
                    time.sleep(3)
        row = {
            "test_id": test, "file": str(destination.relative_to(ROOT)),
            "bytes": destination.stat().st_size, "expected_bytes": expected,
            "sha256": sha256(destination), "source_subcategory": entry["subcategory"],
            "metadata_resource_id": entry["resource_id"]["$oid"],
            "size_passed": destination.stat().st_size == expected,
        }
        manifest["files"].append(row)
        print(json.dumps(row), flush=True)
    (ROOT / "metadata/v5-confirmation-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
