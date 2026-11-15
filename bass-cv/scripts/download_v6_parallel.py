#!/usr/bin/env python3
"""Resumable parallel downloader for preregistered v6 confirmation bytes.

Only file sizes and hashes are logged. Signed URLs and credentials are never
persisted. No video frame is decoded by this script.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
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


def metadata():
    data = json.loads((ROOT / "metadata/PSI-25-investigation.json").read_text())
    split = json.loads((ROOT / "metadata/vision-v6-split.json").read_text())
    source_plan = dict(split["confirmation_videos"])
    amendment_path = ROOT / "metadata/vision-v6-source-integrity-amendment.json"
    if amendment_path.exists():
        amendment = json.loads(amendment_path.read_text())
        for row in amendment.get("source_replacements", []):
            source_plan[row["test_id"]] = row["replacement_file"]
    wanted = set(source_plan.values())
    entries = {}

    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("file_name") in wanted and obj.get("visible", True):
                entries[obj["file_name"]] = obj
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    walk(data)
    return split, source_plan, entries


def download(test: str, name: str, entry: dict):
    destination = ROOT / "raw" / name
    expected = int(entry["file_size"])
    part = destination.with_suffix(destination.suffix + ".part")
    session = requests.Session()
    if destination.exists() and destination.stat().st_size == expected:
        part.unlink(missing_ok=True)
    elif part.exists() and part.stat().st_size == expected:
        # A prior response may have delivered every byte but stalled before EOF.
        # Promote only an exact-size part; container validation remains a separate gate.
        part.replace(destination)
    else:
        for attempt in range(12):
            try:
                gateway = session.get(API, params={"file": name, "redirect": "false"}, timeout=(20, 60))
                gateway.raise_for_status()
                source = gateway.text.strip().strip('"')
                if not source.startswith(("https://", "http://")):
                    raise IOError("NASA gateway did not return a file URL")
                offset = part.stat().st_size if part.exists() else 0
                headers = {"Range": f"bytes={offset}-"} if offset else {}
                with session.get(source, headers=headers, stream=True, timeout=(20, 30)) as response:
                    response.raise_for_status()
                    if offset and response.status_code != 206:
                        offset = 0
                    if offset:
                        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", response.headers.get("Content-Range", ""))
                        if not match or int(match.group(1)) != offset or (match.group(3) != "*" and int(match.group(3)) != expected):
                            raise IOError("Invalid or inconsistent Content-Range; refusing to append")
                    with part.open("ab" if offset else "wb") as handle:
                        written = offset
                        for chunk in response.iter_content(64 * 1024):
                            if chunk:
                                if written + len(chunk) > expected:
                                    raise IOError("Response exceeds expected file size; refusing to append")
                                handle.write(chunk)
                                written += len(chunk)
                if part.stat().st_size != expected:
                    raise IOError(f"Incomplete file: {part.stat().st_size} of {expected} bytes")
                part.replace(destination)
                break
            except Exception as error:
                print(f"{test}: attempt {attempt + 1} incomplete ({type(error).__name__}); retained bytes={part.stat().st_size if part.exists() else 0}", flush=True)
                if attempt == 11:
                    raise RuntimeError(f"{test}: download incomplete after 12 attempts") from None
                time.sleep(2)
    row = {
        "test_id": test, "file": str(destination.relative_to(ROOT)),
        "bytes": destination.stat().st_size, "expected_bytes": expected,
        "sha256": sha256(destination), "source_subcategory": entry["subcategory"],
        "metadata_resource_id": entry["resource_id"]["$oid"],
        "size_passed": destination.stat().st_size == expected,
        "frames_decoded": False,
    }
    print(json.dumps(row), flush=True)
    return row


def main():
    split, source_plan, entries = metadata()
    jobs = [(test, source_plan[test], entries[source_plan[test]]) for test in split["reserved_confirmation_tests"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda job: download(*job), jobs))
    manifest = {"schema": "falmex-vision-v6-confirmation-source-manifest-v1", "accession": "PSI-25", "doi": "10.60555/4qc4-de67", "download_api": API, "files": rows}
    (ROOT / "metadata/v6-confirmation-manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
