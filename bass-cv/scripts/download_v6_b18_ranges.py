#!/usr/bin/env python3
"""Resume the amended B18 second view with validated parallel byte ranges.

No video pixels are decoded. Signed source URLs remain in memory and are never
logged. Existing contiguous bytes are retained and followed by four segments.
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from download_v6_parallel import ROOT, metadata, sha256


def main():
    split, plan, entries = metadata()
    test = "B18"
    name = plan[test]
    entry = entries[name]
    expected = int(entry["file_size"])
    destination = ROOT / "raw" / name
    base = destination.with_suffix(destination.suffix + ".part")
    if destination.exists() and destination.stat().st_size == expected:
        print(json.dumps({"test_id": test, "status": "already_complete", "bytes": expected}), flush=True)
        return
    base_size = base.stat().st_size if base.exists() else 0
    if not (0 <= base_size < expected):
        raise ValueError("Unexpected contiguous B18 partial size")
    if base_size and base.read_bytes()[:8][4:] != b"ftyp":
        raise ValueError("Refusing to reuse a B18 prefix without an MP4 ftyp header")
    remaining = expected - base_size
    workers = 4
    spans = []
    for index in range(workers):
        start = base_size + remaining * index // workers
        end = base_size + remaining * (index + 1) // workers - 1
        spans.append((index, start, end))

    gateway = requests.Session()
    response = gateway.get(
        "https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download",
        params={"file": name, "redirect": "false"}, timeout=(20, 60)
    )
    response.raise_for_status()
    source = response.text.strip().strip('"')
    if not source.startswith(("https://", "http://")):
        raise IOError("NASA gateway did not return a file URL")

    def fetch(span):
        index, start, end = span
        length = end - start + 1
        path = destination.with_suffix(destination.suffix + f".range-{index}.part")
        session = requests.Session()
        for attempt in range(30):
            try:
                have = path.stat().st_size if path.exists() else 0
                if have == length:
                    return {"index": index, "bytes": have}
                if have > length:
                    raise IOError("Range segment exceeds its expected size")
                offset = start + have
                with session.get(source, headers={"Range": f"bytes={offset}-{end}"}, stream=True, timeout=(20, 30)) as remote:
                    remote.raise_for_status()
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", remote.headers.get("Content-Range", ""))
                    if remote.status_code != 206 or not match:
                        raise IOError("Missing exact partial-content response")
                    if (int(match.group(1)), int(match.group(2)), int(match.group(3))) != (offset, end, expected):
                        raise IOError("Inconsistent Content-Range; refusing to append")
                    with path.open("ab") as handle:
                        written = have
                        for chunk in remote.iter_content(64 * 1024):
                            if not chunk:
                                continue
                            if written + len(chunk) > length:
                                raise IOError("Range response exceeds expected segment size")
                            handle.write(chunk)
                            written += len(chunk)
                if path.stat().st_size != length:
                    raise IOError("Incomplete range segment")
                print(json.dumps({"range": index, "status": "complete", "bytes": length}), flush=True)
                return {"index": index, "bytes": length}
            except Exception as error:
                print(json.dumps({"range": index, "attempt": attempt + 1, "error": type(error).__name__}), flush=True)
                if attempt == 29:
                    raise RuntimeError(f"Range {index} incomplete after retries") from None
                time.sleep(2)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(fetch, spans))

    assembly = destination.with_suffix(destination.suffix + ".assembly.part")
    with assembly.open("wb") as output:
        if base_size:
            with base.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    output.write(chunk)
        for index, _, _ in spans:
            path = destination.with_suffix(destination.suffix + f".range-{index}.part")
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    output.write(chunk)
    if assembly.stat().st_size != expected:
        raise IOError("Assembled B18 file has incorrect size")
    assembly.replace(destination)
    row = {
        "test_id": test, "file": str(destination.relative_to(ROOT)),
        "bytes": expected, "sha256": sha256(destination),
        "container_validation": "separate metadata-only gate still required",
        "frames_decoded": False,
    }
    print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
