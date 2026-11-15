"""The landing page's 'Falmex tries to prove itself wrong' example, from the real FLEX data.

Reads the findings the engine produced for NASA's PSI-69 FLEX experimental table (the same
findings listed in the app) and keeps two of them:
  passed    the highest-ranked validated correlation, with its unseen-data replication,
            shuffle test and every third-variable check
  rejected  the highest-ranked finding that failed validation (shown as what is dropped)
Output: frontend/src/lib/flight/showcase.json. Usage:
  python backend/scripts/build_showcase.py [API base, default http://129.212.254.115:3000]
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/lib/flight/showcase.json"


def get(base: str, path: str):
    with urllib.request.urlopen(base + path, timeout=120) as r:
        return json.load(r)


def build(base: str) -> dict:
    ds = next(d for d in get(base, "/api/datasets") if d["name"].startswith("NASA PSI-69 FLEX"))
    findings = get(base, f"/api/findings?dataset_id={ds['dataset_id']}&limit=500")
    passed = next(f for f in findings
                  if f["status"] == "validated" and f["analyzer"] == "rank_correlation")
    rejected = next(f for f in findings if f["status"] == "rejected")
    val = {v["method"]: v["metrics"] for v in passed["validations"]}
    checks = [p for p in passed["deep"] if p["probe"] == "third_variable"]
    validated = [f for f in findings if f["status"] == "validated"]
    return {
        "dataset": ds["name"],
        "source": "NASA PSI-69, FLEX experimental table",
        "finding_id": passed["finding_id"],
        "headline": passed["headline"],
        "method": passed["effect_metric"],
        "n_experiments": passed["evidence"]["n_experiments"],
        "split": passed["split"],
        "discovery_effect": val["holdout_replication"]["discovery_effect"],
        "unseen_effect": val["holdout_replication"]["test_effect"],
        "shuffles_as_strong": val["permutation_test"]["shuffles_as_strong"],
        "permutations": val["permutation_test"]["permutations"],
        "effect_all_rows": checks[0]["metrics"]["effect_without_control"] if checks else None,
        "controls": [{"control": p["params"]["control"], "verdict": p["verdict"],
                      "effect": p["metrics"]["effect_with_control"],
                      "retained_share": p["metrics"]["retained_share"]} for p in checks],
        "rank": 1,
        "of": len(validated),
        "tested": len(findings),
        "rejected": {"finding_id": rejected["finding_id"], "headline": rejected["headline"],
                     "why": rejected["status_explanation"]},
    }


if __name__ == "__main__":
    out = build(sys.argv[1] if len(sys.argv) > 1 else "http://129.212.254.115:3000")
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(out["headline"], out["discovery_effect"], out["unseen_effect"], len(out["controls"]))
