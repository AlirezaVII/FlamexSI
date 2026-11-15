"""Seed an empty workspace from the real PSI-69 CSV and saved date-split findings.

This is a preview/bootstrap convenience, not mock analysis: ingestion runs through the same
adapter and standardizer as uploads. Existing workspaces are never replaced.
"""

import json
from pathlib import Path

from falmex import services
from falmex.findings import Finding
from falmex.schema import Schema
from falmex.settings import get_settings
from falmex.storage import Store

SEED_DIR = Path(__file__).resolve().parent.parent / "review_seed"
RAW_PATH = SEED_DIR / "PSI-69_Experimental table_FLEX.csv"
FINDINGS_PATH = SEED_DIR / "findings.json"


def seed_review_workspace(data_dir: Path) -> str | None:
    store = Store(data_dir)
    try:
        if store.list_datasets():
            return None
        dataset, source, _ = services.ingest_upload(
            store,
            Schema.load(),
            RAW_PATH.name,
            RAW_PATH.read_bytes(),
            name="NASA FLEX / PSI-69 — real ISS flight-series table",
        )
        if dataset is None:
            raise RuntimeError("The PSI-69 seed did not produce a dataset")
        saved = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))["findings"]
        findings = []
        for raw in saved:
            finding = Finding(**{**raw, "dataset_id": dataset.dataset_id})
            findings.append(finding.model_dump(mode="json"))
        store.save_findings(dataset.dataset_id, findings)
        print(
            f"Seeded real PSI-69: {dataset.n_rows} rows, {len(findings)} findings, "
            f"source {source.sha256[:12]}"
        )
        return dataset.dataset_id
    finally:
        store.close()


if __name__ == "__main__":
    seed_review_workspace(get_settings().data_dir)
