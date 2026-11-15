#!/usr/bin/env python3
"""Verify the lightweight GitHub BASS-II bundle without raw videos or training caches."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    checks = []

    def check(name: str, condition: bool, detail="") -> None:
        checks.append({"check": name, "passed": bool(condition), "detail": str(detail)})
        if not condition:
            raise ValueError(f"{name}: {detail}")

    freeze_path = ROOT / "confirmation-v6/inference-freeze.json"
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    check("96 frozen prediction records", len(freeze["frames"]) == 96, len(freeze["frames"]))
    for row in freeze["frames"]:
        path = ROOT / row["mask"]
        check(f"prediction {row['mask']}", path.is_file() and sha256(path) == row["mask_sha256"])
    sources = sorted((ROOT / "confirmation-v6/source-frames").glob("*.png"))
    check("24 non-duplicated source frames", len(sources) == 24, len(sources))
    source_hashes = {row["source_frame"]: row["source_sha256"] for row in freeze["frames"]}
    check("24 unique frozen source records", len(source_hashes) == 24, len(source_hashes))
    for name, expected in source_hashes.items():
        path = ROOT / name
        check(f"source {name}", path.is_file() and sha256(path) == expected)
    for version, record in freeze["models"].items():
        path = ROOT / record["model_file"]
        if version == "v3":
            check("large v3 model deliberately external", not path.is_file(),
                  "frozen v3 masks remain locally verifiable; full model is in the evidence archive")
        else:
            check(f"{version} model hash", path.is_file() and sha256(path) == record["model_sha256"])
    review = json.loads((ROOT / "independent-review-results-v6/review-processing.json").read_text(encoding="utf-8"))
    check("real review has 24 adjudication frames", review["adjudication_frames"] == 24,
          review["adjudication_frames"])
    check("third adjudication remains pending", review["status"] == "awaiting_third_adjudication")
    check("reviewer expertise not inferred", review["reviewer_identity_expertise_and_independence_not_technically_verified"] is True)
    metrics = json.loads((ROOT / "confirmation-v6/metrics.json").read_text(encoding="utf-8"))
    check("original v6 confirmation TP remains zero", metrics["models"]["v6"]["pooled"]["tp"] == 0)
    check("operational readiness remains false", metrics["operational_readiness"] is False)
    result = {
        "schema": "falmex-lightweight-github-verification-v1",
        "status": "passed",
        "checks": len(checks),
        "scope": "lightweight source/model/frozen-mask/review integrity; not full training reproduction",
        "third_adjudication_completed": False,
        "independent_expert_validation": False,
        "operational_readiness": False,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
