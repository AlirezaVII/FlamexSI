#!/usr/bin/env python3
"""Hash all v6 development inputs without reading confirmation frames."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    rows = json.loads((ROOT / "development-v6/selection.json").read_text())
    videos = {}
    for row in rows:
        if row["test_id"] not in videos:
            path = ROOT / row["video"]
            videos[row["test_id"]] = {"file": row["video"], "bytes": path.stat().st_size, "sha256": sha(path)}
            print(f"video {row['test_id']} hashed", flush=True)
    frames = []
    for row in rows:
        frames.append({"test_id": row["test_id"], "frame_index": row["frame_index"], "source": row["file"], "source_sha256": sha(ROOT / row["file"]), "mask": row["mask"], "mask_sha256": sha(ROOT / row["mask"]), "annotation_provenance": row["development_provenance"]})
    result = {"schema": "falmex-vision-v6-development-source-manifest-v1", "status": "development only; includes promoted B13/B15/B16; not independent-expert gold", "videos": videos, "frames": frames}
    destination = ROOT / "development-v6/source-manifest.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, indent=2))
    temporary.replace(destination)
    print(json.dumps({"videos": len(videos), "frames": len(frames)}), flush=True)


if __name__ == "__main__":
    main()
