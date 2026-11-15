"""Run literature-based uncertainty sensitivity analyses for FLEX findings.

The numerical scenarios use Shaw and Yu's typical expanded uncertainties for
methanol/heptane. They are not per-row uncertainty estimates, independent
replication, or replacements for the original D(t) image histories.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis.uncertainty import (
    BURNING_RATE_STANDARD_MM2_S,
    COVERAGE_FACTOR_95,
    DIAMETER_STANDARD_MM,
    add_typical_uncertainty_scenario,
)

D0 = "initial_droplet_diameter"
DE = "visible_extinction_diameter"
K = "droplet_burning_rate_constant"
RATIO = "extinction_diameter_ratio"
BURN_TIME = "burn_time"

SPECS = [
    {"key": "H1", "condition": "oxygen", "outcome": K, "label": "Oxygen -> K"},
    {"key": "H2", "condition": D0, "outcome": DE, "label": "D0 -> De"},
    {"key": "H3A", "condition": "oxygen", "outcome": DE, "label": "Oxygen -> De"},
    {"key": "H3B", "condition": "oxygen", "outcome": RATIO, "label": "Oxygen -> De/D0"},
    {"key": "D0-burn", "condition": D0, "outcome": BURN_TIME, "label": "D0 -> burn time"},
    {"key": "D0-ratio", "condition": D0, "outcome": RATIO, "label": "D0 -> De/D0"},
]
SCOPES = ["All", "Methanol", "Heptane"]


def perturbed_positive(values: np.ndarray, standard: float, rng: np.random.Generator) -> np.ndarray:
    return np.maximum(values + rng.normal(0.0, standard, len(values)), 0.001)


def perturbed_nonnegative(
    values: np.ndarray, standard: float, rng: np.random.Generator
) -> np.ndarray:
    return np.maximum(values + rng.normal(0.0, standard, len(values)), 0.0)


def simulate_association(
    frame: pd.DataFrame,
    spec: dict[str, str],
    repeats: int,
    rng: np.random.Generator,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    condition, outcome = spec["condition"], spec["outcome"]
    required = {condition, outcome}
    if outcome == RATIO:
        required.update({D0, DE})
    usable = frame.dropna(subset=sorted(required)).copy()
    x_original = usable[condition].to_numpy(dtype=float)
    y_original = usable[outcome].to_numpy(dtype=float)
    original = float(stats.spearmanr(x_original, y_original).statistic)
    samples = []
    records = []

    for index in range(repeats):
        d0 = perturbed_positive(usable[D0].to_numpy(dtype=float), DIAMETER_STANDARD_MM, rng)
        de = perturbed_nonnegative(usable[DE].to_numpy(dtype=float), DIAMETER_STANDARD_MM, rng)
        rate = perturbed_nonnegative(
            usable[K].to_numpy(dtype=float), BURNING_RATE_STANDARD_MM2_S, rng
        )
        x = x_original.copy()
        y = y_original.copy()
        if condition == D0:
            x = d0
        if outcome == DE:
            y = de
        elif outcome == K:
            y = rate
        elif outcome == RATIO:
            y = de / d0
        rho = float(stats.spearmanr(x, y).statistic)
        samples.append(rho)
        records.append(
            {
                "hypothesis": spec["key"],
                "condition": condition,
                "outcome": outcome,
                "scope": usable.attrs["scope"],
                "simulation": index + 1,
                "spearman_rho": rho,
            }
        )

    expected_sign = np.sign(original)
    same_sign = float(np.mean(np.sign(samples) == expected_sign))
    summary = {
        "hypothesis": spec["key"],
        "condition": condition,
        "outcome": outcome,
        "scope": usable.attrs["scope"],
        "n": len(usable),
        "original_spearman_rho": original,
        "scenario_median_rho": float(np.median(samples)),
        "scenario_q025_rho": float(np.quantile(samples, 0.025)),
        "scenario_q975_rho": float(np.quantile(samples, 0.975)),
        "scenario_min_rho": float(np.min(samples)),
        "scenario_max_rho": float(np.max(samples)),
        "same_sign_share": same_sign,
        "simulations": repeats,
        "interpretation": (
            "Measurement-error scenario distribution, not a confidence interval or replication"
        ),
    }
    return summary, records


def make_forest_plot(summary: pd.DataFrame, output: Path) -> None:
    selected = [
        ("H1", "All"),
        ("H2", "All"),
        ("H3A", "All"),
        ("H3B", "All"),
        ("D0-burn", "All"),
        ("D0-ratio", "All"),
        ("D0-ratio", "Heptane"),
        ("D0-burn", "Methanol"),
    ]
    labels = {
        ("H1", "All"): "Oxygen -> K | all",
        ("H2", "All"): "D0 -> De | all",
        ("H3A", "All"): "Oxygen -> De | all",
        ("H3B", "All"): "Oxygen -> De/D0 | all",
        ("D0-burn", "All"): "D0 -> burn time | all",
        ("D0-ratio", "All"): "D0 -> De/D0 | all",
        ("D0-ratio", "Heptane"): "D0 -> De/D0 | heptane",
        ("D0-burn", "Methanol"): "D0 -> burn time | methanol",
    }
    rows = []
    for key in selected:
        row = summary[(summary.hypothesis == key[0]) & (summary.scope == key[1])].iloc[0]
        rows.append((labels[key], row))

    fig, ax = plt.subplots(figsize=(10, 7), constrained_layout=True)
    positions = np.arange(len(rows))[::-1]
    for position, (_label, row) in zip(positions, rows, strict=True):
        low = row.scenario_q025_rho
        high = row.scenario_q975_rho
        median = row.scenario_median_rho
        ax.errorbar(
            median,
            position,
            xerr=[[median - low], [high - median]],
            fmt="o",
            color="#0072B2",
            ecolor="#0072B2",
            elinewidth=2,
            capsize=4,
            label="Scenario median and central 95% range" if position == positions[0] else None,
        )
        ax.scatter(
            row.original_spearman_rho,
            position,
            marker="D",
            s=45,
            color="#D55E00",
            zorder=4,
            label="Observed full-table rho" if position == positions[0] else None,
        )
    ax.axvline(0, color="#444444", linewidth=1, linestyle="--")
    ax.set_yticks(positions, [label for label, _ in rows])
    ax.set_xlabel("Spearman rho")
    ax.set_title("FLEX measurement-error sensitivity scenarios")
    ax.grid(axis="x", alpha=0.2)
    ax.legend(loc="best", frameon=False)
    fig.text(
        0.5,
        -0.03,
        (
            "Scenario ranges are not confidence intervals or external validation. "
            "Independent normal perturbations; De censored at zero."
        ),
        ha="center",
        fontsize=9,
    )
    fig.savefig(output, dpi=170, bbox_inches="tight")
    plt.close(fig)


def make_residual_plot(frame: pd.DataFrame, output: Path) -> None:
    usable = frame.dropna(
        subset=["d2_law_normalized_residual", "normalized_d2_residual_expanded_95_scenario"]
    ).copy()
    largest = usable.reindex(
        usable.d2_law_normalized_residual.abs().sort_values(ascending=False).index
    ).head(15)
    largest = largest.sort_values("d2_law_normalized_residual")
    fig, ax = plt.subplots(figsize=(10, 7), constrained_layout=True)
    positions = np.arange(len(largest))
    ax.errorbar(
        largest.d2_law_normalized_residual,
        positions,
        xerr=largest.normalized_d2_residual_expanded_95_scenario,
        fmt="o",
        color="#0072B2",
        ecolor="#999999",
        capsize=3,
    )
    ax.axvline(0, color="#444444", linestyle="--", linewidth=1)
    ax.set_yticks(positions, [f"Test {int(value)}" for value in largest.experiment_id])
    ax.set_xlabel("Normalized endpoint residual and scenario expanded interval")
    ax.set_title("Largest FLEX D² endpoint residuals with uncertainty scenario")
    ax.grid(axis="x", alpha=0.2)
    fig.text(
        0.5,
        -0.03,
        (
            "Residuals are endpoint-consistency diagnostics, not independent tests "
            "of the D² law or proof of measurement error."
        ),
        ha="center",
        fontsize=9,
    )
    fig.savefig(output, dpi=170, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="standardized_flex.csv")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--simulations", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.simulations < 100:
        parser.error("--simulations must be at least 100")

    frame = pd.read_csv(args.input)
    enriched = add_typical_uncertainty_scenario(frame)
    args.output.mkdir(parents=True, exist_ok=True)
    enriched.to_csv(args.output / "uncertainty_by_row.csv", index=False)

    rng = np.random.default_rng(args.seed)
    summaries = []
    simulation_records = []
    for spec in SPECS:
        for scope in SCOPES:
            scoped = frame if scope == "All" else frame[frame.material == scope].copy()
            scoped.attrs["scope"] = scope
            summary, records = simulate_association(scoped, spec, args.simulations, rng)
            summaries.append(summary)
            simulation_records.extend(records)

    summary_frame = pd.DataFrame(summaries)
    summary_frame.to_csv(args.output / "association_uncertainty_summary.csv", index=False)
    pd.DataFrame(simulation_records).to_csv(
        args.output / "association_simulations.csv", index=False
    )

    residual = enriched.dropna(
        subset=["d2_law_residual_mm2", "d2_residual_expanded_95_scenario"]
    ).copy()
    residual["covered_by_expanded_scenario"] = (
        residual.d2_law_residual_mm2.abs() <= residual.d2_residual_expanded_95_scenario
    )
    residual["covered_by_normalized_expanded_scenario"] = (
        residual.d2_law_normalized_residual.abs()
        <= residual.normalized_d2_residual_expanded_95_scenario
    )
    largest = residual.reindex(
        residual.d2_law_normalized_residual.abs().sort_values(ascending=False).index
    ).head(15)
    largest_output = largest[
        [
            "experiment_id",
            "flex_identifier",
            "material",
            "test_end",
            "d2_law_residual_mm2",
            "d2_residual_expanded_95_scenario",
            "d2_law_normalized_residual",
            "normalized_d2_residual_expanded_95_scenario",
            "covered_by_expanded_scenario",
            "covered_by_normalized_expanded_scenario",
        ]
    ]
    largest_output.to_csv(args.output / "largest_residuals_with_uncertainty.csv", index=False)

    test129 = enriched[enriched.experiment_id == 129].iloc[0]
    ratio_interval = [
        float(test129.extinction_diameter_ratio - test129.extinction_ratio_expanded_95_scenario),
        float(test129.extinction_diameter_ratio + test129.extinction_ratio_expanded_95_scenario),
    ]
    payload = {
        "analysis_type": "literature-based measurement uncertainty sensitivity scenario",
        "source": {
            "authors": "Shaw and Yu",
            "title": (
                "ISS Droplet Combustion Experiments - Uncertainties in Droplet Sizes "
                "and Burning Rates"
            ),
            "doi": "10.1007/s12217-014-9377-x",
            "url": "https://link.springer.com/article/10.1007/s12217-014-9377-x",
            "method": "Taylor-series propagation",
            "typical_95_expanded_diameter_mm": 0.1,
            "typical_95_expanded_burning_rate_mm2_s": 0.005,
            "applicable_fuels": ["Methanol", "Heptane"],
        },
        "scenario": {
            "coverage_factor": COVERAGE_FACTOR_95,
            "diameter_standard_uncertainty_mm": DIAMETER_STANDARD_MM,
            "burning_rate_standard_uncertainty_mm2_s": BURNING_RATE_STANDARD_MM2_S,
            "burn_time_standard_uncertainty_s": 0.0,
            "simulations": args.simulations,
            "seed": args.seed,
            "input_errors_assumed_independent": True,
            "de_perturbations_censored_at_zero": True,
            "oxygen_pressure_protocol_and_systematic_errors_included": False,
        },
        "limitations": [
            "Typical literature values are not per-row PSI-69 uncertainty budgets.",
            "Shaw and Yu analyze instantaneous local-polynomial rates; PSI K is an average fit.",
            "The 1.96 conversion and normal perturbations are working sensitivity assumptions.",
            (
                "Diameter, K, and endpoint errors may be correlated; independence is "
                "only an approximation."
            ),
            "Uncertainty can be larger near ignition and extinction.",
            "Scenario ranges are not confidence intervals and do not change replication status.",
        ],
        "residual_qc": {
            "n": len(residual),
            "covered_by_expanded_scenario_count": int(residual.covered_by_expanded_scenario.sum()),
            "covered_by_expanded_scenario_share": float(
                residual.covered_by_expanded_scenario.mean()
            ),
            "covered_by_normalized_expanded_scenario_count": int(
                residual.covered_by_normalized_expanded_scenario.sum()
            ),
            "covered_by_normalized_expanded_scenario_share": float(
                residual.covered_by_normalized_expanded_scenario.mean()
            ),
            "interpretation": (
                "Coverage is endpoint consistency under a scenario, not proof that a row is correct"
            ),
        },
        "test_129": {
            "extinction_diameter_ratio": float(test129.extinction_diameter_ratio),
            "expanded_95_scenario_interval": ratio_interval,
            "interval_contains_one": bool(ratio_interval[0] <= 1.0 <= ratio_interval[1]),
        },
    }
    with (args.output / "uncertainty_summary.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    make_forest_plot(summary_frame, args.output / "association_uncertainty_forest.png")
    make_residual_plot(enriched, args.output / "d2_residual_uncertainty.png")
    print(f"Wrote uncertainty scenario for {len(frame)} rows and {len(summary_frame)} associations")
    coverage = payload["residual_qc"]["covered_by_expanded_scenario_share"]
    print(f"Residual scenario coverage: {coverage:.3f}")
    print(f"Test 129 ratio interval: {ratio_interval}")
    print("External replication: false; per-row measurement uncertainties recovered: false")


if __name__ == "__main__":
    main()
