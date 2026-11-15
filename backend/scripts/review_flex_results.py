"""Descriptive robustness and physical-QC checks for the standardized FLEX table."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from falmex.deep import ThirdVariable

PAIRS = [
    ("oxygen", "droplet_burning_rate_constant"),
    ("oxygen", "visible_extinction_diameter"),
    ("oxygen", "burn_time"),
    ("oxygen", "extinction_diameter_ratio"),
    ("initial_droplet_diameter", "droplet_burning_rate_constant"),
    ("initial_droplet_diameter", "visible_extinction_diameter"),
    ("initial_droplet_diameter", "burn_time"),
    ("initial_droplet_diameter", "extinction_diameter_ratio"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="standardized_flex.csv")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    frame = pd.read_csv(args.input)
    args.output.mkdir(parents=True, exist_ok=True)

    within_fuel = []
    fuel_control = []
    for x, y in PAIRS:
        for fuel, group in frame.groupby("material"):
            data = group[[x, y]].dropna()
            rho, p = stats.spearmanr(data[x], data[y])
            within_fuel.append({
                "condition": x, "outcome": y, "fuel": fuel, "n": len(data),
                "spearman_rho": rho, "p_value_descriptive": p,
            })
        data = frame[[x, y, "material"]].dropna().copy()
        data["fuel_indicator"] = (data["material"] == "Heptane").astype(int)
        raw = stats.spearmanr(data[x], data[y])
        partial, p, n = ThirdVariable.partial_spearman(data, x, y, "fuel_indicator")
        fuel_control.append({
            "condition": x, "outcome": y, "n": n,
            "spearman_rho": raw.statistic, "raw_p_value": raw.pvalue,
            "partial_rho_controlling_fuel": partial, "partial_p_value": p,
        })
    pd.DataFrame(within_fuel).to_csv(args.output / "within_fuel_correlations.csv", index=False)
    pd.DataFrame(fuel_control).to_csv(args.output / "fuel_controlled_correlations.csv", index=False)

    qc = frame.dropna(subset=["d2_law_residual_mm2", "d2_law_normalized_residual"]).copy()
    qc["abs_normalized_residual"] = qc["d2_law_normalized_residual"].abs()
    grouped = qc.groupby("test_end").agg(
        n=("experiment_id", "size"),
        median_residual_mm2=("d2_law_residual_mm2", "median"),
        median_normalized_residual=("d2_law_normalized_residual", "median"),
        q05_normalized_residual=("d2_law_normalized_residual", lambda s: s.quantile(0.05)),
        q95_normalized_residual=("d2_law_normalized_residual", lambda s: s.quantile(0.95)),
        share_abs_normalized_gt_0_1=("abs_normalized_residual", lambda s: (s > 0.1).mean()),
        share_abs_normalized_gt_0_25=("abs_normalized_residual", lambda s: (s > 0.25).mean()),
    ).reset_index()
    grouped.to_csv(args.output / "d2_qc_by_test_end.csv", index=False)
    extreme_columns = [
        "experiment_id", "flex_identifier", "material", "test_end",
        "initial_droplet_diameter", "visible_extinction_diameter",
        "droplet_burning_rate_constant", "burn_time", "d2_law_residual_mm2",
        "d2_law_normalized_residual",
    ]
    qc.nlargest(20, "abs_normalized_residual")[extreme_columns].to_csv(
        args.output / "d2_largest_residuals.csv", index=False
    )

    gas = frame[[
        "oxygen", "nitrogen_fraction", "carbon_dioxide_fraction", "helium_fraction"
    ]].copy()
    gas["oxygen"] = gas["oxygen"] / 100
    gas_sum = gas.sum(axis=1, min_count=4)
    ratio_anomalies = frame.loc[
        frame["extinction_diameter_ratio"].gt(1),
        ["experiment_id", "flex_identifier", "extinction_diameter_ratio"],
    ]
    summary = {
        "rows": len(frame),
        "test_dates": int(frame["test_date"].nunique()),
        "missing": {c: int(frame[c].isna().sum()) for c in [
            "oxygen", "pressure", "initial_droplet_diameter", "visible_extinction_diameter",
            "droplet_burning_rate_constant", "burn_time", "extinction_diameter_ratio",
        ]},
        "gas_fraction_sum": {
            "min": float(gas_sum.min()), "max": float(gas_sum.max()),
            "rows_not_close_to_one": int((~np.isclose(gas_sum, 1)).sum()),
        },
        "extinction_ratio_above_one": ratio_anomalies.to_dict("records"),
        "d2_qc": {
            "n": len(qc),
            "median_normalized_residual": float(qc["d2_law_normalized_residual"].median()),
            "share_abs_normalized_gt_0_1": float((qc["abs_normalized_residual"] > 0.1).mean()),
            "share_abs_normalized_gt_0_25": float((qc["abs_normalized_residual"] > 0.25).mean()),
            "interpretation": (
                "Endpoint consistency diagnostic only. K is fitted over a portion of the "
                "D² history, so nonzero residuals are expected and are not independent tests "
                "of the D² law."
            ),
        },
        "robustness_interpretation": (
            "Within-fuel and fuel-controlled checks are descriptive sensitivity analyses on "
            "all rows, not additional independent validation."
        ),
    }
    (args.output / "robustness_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
