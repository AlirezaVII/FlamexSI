"""Read-only scientific review bundle for the verified FLEX / PSI-69 analysis.

The UI receives the same JSON and CSV outputs produced by the analysis scripts. Numerical
results are never duplicated in frontend constants. The bundle is exposed only for the
matching real PSI-69 source, never for synthetic or unrelated datasets.
"""

import csv
import hashlib
import json
from pathlib import Path
from typing import Any

from falmex.storage import DatasetRecord, SourceRecord

ARTIFACT_ROOT = Path(__file__).resolve().parent / "review_artifacts"

ARTIFACTS = {
    "review_overview": "review/eight_findings_overview.png",
    "review_table": "review/eight_findings_review.csv",
    "time_series_plot": "time_series/figure6_refit_review.png",
    "time_series_fits": "time_series/figure6_fit_summary.csv",
    "compositional_coefficients_plot": (
        "compositional/compositional_primary_coefficients.png"
    ),
    "compositional_predictions_plot": (
        "compositional/compositional_grouped_predictions.png"
    ),
    "compositional_protocol": "compositional/protocol_v1.md",
    "compositional_protocol_lock": "compositional/protocol_lock.json",
    "replication_protocol": "replication/protocol_v1.md",
    "replication_protocol_lock": "replication/protocol_lock.json",
    "replication_results": "replication/replication_results.csv",
    "uncertainty_plot": "uncertainty/association_uncertainty_forest.png",
    "residual_uncertainty_plot": "uncertainty/d2_residual_uncertainty.png",
    "uncertainty_associations": "uncertainty/association_uncertainty_summary.csv",
}

MEDIA_TYPES = {
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".png": "image/png",
}


def _json(path: str) -> Any:
    return json.loads((ARTIFACT_ROOT / path).read_text(encoding="utf-8"))


def _csv(path: str) -> list[dict[str, Any]]:
    """CSV records with numeric values restored and empty cells represented as null."""
    with (ARTIFACT_ROOT / path).open(encoding="utf-8", newline="") as handle:
        rows = []
        for raw in csv.DictReader(handle):
            row: dict[str, Any] = {}
            for key, value in raw.items():
                if value == "":
                    row[key] = None
                    continue
                try:
                    row[key] = int(value) if value.lstrip("-").isdigit() else float(value)
                except ValueError:
                    row[key] = value
            rows.append(row)
        return rows


def artifact_path(key: str) -> Path:
    """Resolve only the explicit public artifact whitelist; no user-controlled paths."""
    if key not in ARTIFACTS:
        raise KeyError(key)
    path = (ARTIFACT_ROOT / ARTIFACTS[key]).resolve()
    if ARTIFACT_ROOT.resolve() not in path.parents or not path.is_file():
        raise FileNotFoundError(key)
    return path


def _artifact_index() -> list[dict[str, Any]]:
    out = []
    for key in ARTIFACTS:
        path = artifact_path(key)
        out.append(
            {
                "key": key,
                "filename": path.name,
                "media_type": MEDIA_TYPES[path.suffix],
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    return out


def load_review() -> dict[str, Any]:
    manifest = _json("manifest.json")
    investigation = manifest["investigation"]
    return {
        "source": manifest["source"],
        "ingestion": manifest["ingestion"],
        "pipeline": manifest["pipeline"],
        "investigation": {
            key: investigation.get(key)
            for key in (
                "accession",
                "title",
                "investigationAcronym",
                "doi",
                "version",
                "licenseIdentifier",
                "releaseDate",
                "flightProgram",
                "managingNasaCenter",
                "experimentHardware",
            )
        },
        "scope": _json("review/metadata_review.json"),
        "review": _json("review/review_summary.json"),
        "replication": _json("replication/feasibility.json"),
        "uncertainty": _json("uncertainty/uncertainty_summary.json"),
        "time_series": {
            **_json("time_series/figure6_analysis_summary.json"),
            "fits": _csv("time_series/figure6_fit_summary.csv"),
        },
        "compositional": _json("compositional/compositional_analysis_summary.json"),
        "artifacts": _artifact_index(),
    }


def scientific_review_for_dataset(
    dataset: DatasetRecord,
    sources: list[SourceRecord],
    findings: list[Any],
) -> dict[str, Any] | None:
    """Attach the verified bundle only to the unchanged, matching real PSI-69 table."""
    review = load_review()
    expected_sha = review["source"]["sha256"]
    if (
        dataset.synthetic
        or dataset.n_rows != review["pipeline"]["rows_out"]
        or expected_sha not in {source.sha256 for source in sources}
    ):
        return None
    statuses = ("validated", "candidate", "rejected", "not_significant")
    review["finding_status_counts"] = {
        status: sum(f.status == status for f in findings) for status in statuses
    }
    review["finding_total"] = len(findings)
    return review
