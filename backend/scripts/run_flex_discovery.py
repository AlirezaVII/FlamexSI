"""Reproduce the targeted Falmex analyses on the official NASA PSI-69 FLEX table.

Example (from backend/):
    python scripts/run_flex_discovery.py \
      --input "/path/PSI-69_Experimental table_FLEX.csv" \
      --metadata /path/PSI-69.json --output /path/flex-results

No LLM is called. Every run uses the same raw bytes and records its complete
statistical configuration, source hash, findings and validation outcomes.
"""

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd

from falmex.engine import DiscoveryConfig, run_discovery
from falmex.findings import SourceRef
from falmex.ingest import read_file
from falmex.pipeline import standardize
from falmex.schema import Schema

OUTCOMES = [
    "droplet_burning_rate_constant",
    "visible_extinction_diameter",
    "burn_time",
    "extinction_diameter_ratio",
    "test_end_extinction_versus_completion",
]
PRIMARY_CONDITIONS = [
    "oxygen",
    "pressure",
    "initial_droplet_diameter",
    "material",
]
COMPOSITION_CONDITIONS = [
    "oxygen",
    "nitrogen_fraction",
    "carbon_dioxide_fraction",
    "helium_fraction",
]
ANALYZERS = ["rank_correlation", "group_difference", "curvature", "interaction"]


def _specifications(seed: int) -> dict[str, DiscoveryConfig]:
    common = {
        "analyzers": ANALYZERS,
        "outcomes": OUTCOMES,
        "test_fraction": 0.3,
        "alpha": 0.05,
        "min_samples": 20,
        "seed": seed,
    }
    return {
        "primary_experiment_split": DiscoveryConfig(
            **common,
            conditions=PRIMARY_CONDITIONS,
            goal="Targeted FLEX associations with oxygen, pressure, D0 and fuel",
            extra={
                "family": "primary targeted exploration; not preregistered or causal",
                "split_group": "experiment_id",
            },
        ),
        "composition_experiment_split": DiscoveryConfig(
            **{
                **common,
                "outcomes": [
                    "droplet_burning_rate_constant",
                    "extinction_diameter_ratio",
                    "test_end_extinction_versus_completion",
                ],
            },
            conditions=COMPOSITION_CONDITIONS,
            goal="Exploratory FLEX gas-composition associations",
            extra={
                "family": "secondary composition exploration",
                "compositional_warning": (
                    "O2, N2, CO2 and He fractions sum to one; individual associations "
                    "are not independent component effects"
                ),
                "split_group": "experiment_id",
            },
        ),
        "primary_test_date_split": DiscoveryConfig(
            **common,
            conditions=PRIMARY_CONDITIONS,
            split_by="test_date",
            goal="Sensitivity: primary FLEX analysis held out by test date",
            extra={
                "family": "sensitivity analysis for shared-date dependence",
                "split_group": "test_date",
            },
        ),
    }


def _flatten(findings) -> list[dict]:
    rows = []
    for finding in findings:
        validations = {v.method: v for v in finding.validations}
        holdout = validations.get("holdout_replication")
        permutation = validations.get("permutation_test")
        rows.append({
            "status": finding.status.value,
            "analyzer": finding.analyzer,
            "condition": finding.condition,
            "outcome": finding.outcome,
            "effect_metric": finding.effect_metric,
            "effect_size": finding.effect_size,
            "p_value": finding.p_value,
            "q_value": finding.q_value,
            "n_train": finding.n_train,
            "holdout_passed": holdout.passed if holdout else None,
            "holdout_effect": holdout.metrics.get("test_effect") if holdout else None,
            "holdout_p": holdout.metrics.get("test_p_value") if holdout else None,
            "holdout_n": holdout.metrics.get("test_n") if holdout else None,
            "permutation_passed": permutation.passed if permutation else None,
            "permutation_p": (
                permutation.metrics.get("permutation_p_value") if permutation else None
            ),
            "uncertainty_low": finding.uncertainty.low if finding.uncertainty else None,
            "uncertainty_high": finding.uncertainty.high if finding.uncertainty else None,
            "stable_share": finding.uncertainty.stable_share if finding.uncertainty else None,
            "headline": finding.headline,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    content = args.input.read_bytes()
    sha256 = hashlib.sha256(content).hexdigest()
    result = read_file(args.input.name, content)
    schema = Schema.load()
    frame, pipeline_report = standardize(result.tables[0].frame, schema, sha256[:16])
    args.output.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.output / "standardized_flex.csv", index=False)

    source_id = sha256[:16]
    sources = {source_id: SourceRef(source_id=source_id, filename=args.input.name, sha256=sha256)}
    investigation = json.loads(args.metadata.read_text()) if args.metadata else None
    manifest = {
        "investigation": investigation,
        "source": {"filename": args.input.name, "sha256": sha256, "bytes": len(content)},
        "ingestion": result.metadata,
        "pipeline": pipeline_report.to_dict(),
        "rows": len(frame),
        "seed": args.seed,
        "llm_used": False,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str))

    for name, config in _specifications(args.seed).items():
        print(f"Running {name}...", flush=True)
        findings = run_discovery(
            frame, schema, dataset_id=f"psi69-{sha256[:12]}", synthetic=False,
            sources=sources, config=config,
        )
        run_dir = args.output / name
        run_dir.mkdir(exist_ok=True)
        payload = {
            "config": config.__dict__,
            "n_findings": len(findings),
            "status_counts": pd.Series([f.status.value for f in findings]).value_counts().to_dict(),
            "findings": [f.model_dump(mode="json") for f in findings],
        }
        (run_dir / "findings.json").write_text(json.dumps(payload, indent=2, default=str))
        pd.DataFrame(_flatten(findings)).to_csv(run_dir / "findings.csv", index=False)
        print(name, payload["status_counts"], flush=True)


if __name__ == "__main__":
    main()
