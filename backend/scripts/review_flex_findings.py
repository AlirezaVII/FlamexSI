"""Create reproducible plots and audit tables for the eight robust FLEX findings.

This is a machine-assisted scientific review, not formal expert approval.
Run after run_flex_discovery.py and review_flex_results.py. Matplotlib is a
reporting-only dependency and is not used by the discovery engine.
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

FUEL_COLORS = {"Methanol": "#0072B2", "Heptane": "#D55E00"}
PRIMARY = "primary_experiment_split"
DATE_SPLIT = "primary_test_date_split"

SPECS = [
    {
        "review_id": 1,
        "condition": "oxygen",
        "outcome": "droplet_burning_rate_constant",
        "analyzer": "rank_correlation",
        "title": "Oxygen and burning-rate constant K",
        "x_label": "Initial oxygen (mole %)",
        "y_label": "K (mm$^2$/s)",
        "decision": "candidate_insight",
        "scope": "Both fuels; associational, within observed FLEX conditions",
    },
    {
        "review_id": 2,
        "condition": "initial_droplet_diameter",
        "outcome": "visible_extinction_diameter",
        "analyzer": "rank_correlation",
        "title": "Initial and visible-extinction droplet diameters",
        "x_label": "Initial diameter D0 (mm)",
        "y_label": "Visible-extinction diameter De (mm)",
        "decision": "candidate_insight_descriptive",
        "scope": "Both fuels; 197 rows with measured De; descriptive relationship",
    },
    {
        "review_id": 3,
        "condition": "oxygen",
        "outcome": "extinction_diameter_ratio",
        "analyzer": "rank_correlation",
        "title": "Oxygen and extinction-diameter ratio",
        "x_label": "Initial oxygen (mole %)",
        "y_label": "De / D0",
        "decision": "candidate_insight_shared_evidence",
        "scope": "Both fuels; combine with oxygen versus De, not independent discoveries",
    },
    {
        "review_id": 4,
        "condition": "oxygen",
        "outcome": "burn_time",
        "analyzer": "rank_correlation",
        "title": "Oxygen and recorded burn time",
        "x_label": "Initial oxygen (mole %)",
        "y_label": "Recorded burn time (s)",
        "decision": "finding_only",
        "scope": "Do not interpret causally without protocol and diameter controls",
    },
    {
        "review_id": 5,
        "condition": "initial_droplet_diameter",
        "outcome": "burn_time",
        "analyzer": "rank_correlation",
        "title": "Initial diameter and recorded burn time",
        "x_label": "Initial diameter D0 (mm)",
        "y_label": "Recorded burn time (s)",
        "decision": "finding_only_fuel_dependent",
        "scope": "Strong within methanol, weak within heptane; no general Insight",
    },
    {
        "review_id": 6,
        "condition": "initial_droplet_diameter",
        "outcome": "extinction_diameter_ratio",
        "analyzer": "rank_correlation",
        "title": "Initial diameter and extinction-diameter ratio",
        "x_label": "Initial diameter D0 (mm)",
        "y_label": "De / D0",
        "decision": "heptane_scoped_candidate",
        "scope": "Supported mainly within heptane; methanol subset is not supportive",
    },
    {
        "review_id": 7,
        "condition": "oxygen",
        "outcome": "visible_extinction_diameter",
        "analyzer": "rank_correlation",
        "title": "Oxygen and visible-extinction diameter",
        "x_label": "Initial oxygen (mole %)",
        "y_label": "Visible-extinction diameter De (mm)",
        "decision": "merge_with_oxygen_extinction_theme",
        "scope": "Both fuels; same evidence theme as oxygen versus De / D0",
    },
    {
        "review_id": 8,
        "condition": "material",
        "outcome": "burn_time",
        "analyzer": "group_difference",
        "title": "Fuel group and recorded burn time",
        "x_label": "Fuel",
        "y_label": "Recorded burn time (s)",
        "decision": "finding_only_descriptive",
        "scope": "Descriptive group difference, not an isolated causal fuel effect",
    },
]


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def finding_lookup(payload: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    return {
        (item["condition"], item["outcome"], item["analyzer"]): item
        for item in payload["findings"]
    }


def holdout_metrics(finding: dict[str, Any]) -> dict[str, Any]:
    validation = next(
        item for item in finding["validations"] if item["method"] == "holdout_replication"
    )
    return validation["metrics"]


def add_binned_median(ax: plt.Axes, frame: pd.DataFrame, x: str, y: str) -> None:
    if len(frame) < 12 or frame[x].nunique() < 4:
        return
    try:
        bins = pd.qcut(frame[x], q=min(8, frame[x].nunique()), duplicates="drop")
    except ValueError:
        return
    summary = frame.groupby(bins, observed=True)[[x, y]].median()
    ax.plot(
        summary[x],
        summary[y],
        color="#222222",
        linewidth=1.5,
        marker="s",
        markersize=4,
        linestyle="--",
        label="Descriptive binned median",
        zorder=4,
    )


def metric_text(spec: dict[str, Any], primary: dict[str, Any], dated: dict[str, Any]) -> str:
    key = (spec["condition"], spec["outcome"], spec["analyzer"])
    first = primary[key]
    second = dated[key]
    first_holdout = holdout_metrics(first)
    second_holdout = holdout_metrics(second)
    metric = "rho" if spec["analyzer"] == "rank_correlation" else "epsilon^2"
    return (
        f"Experiment split: {metric}={first['effect_size']:.3f}; "
        f"holdout={first_holdout['test_effect']:.3f}\n"
        f"Date split: {metric}={second['effect_size']:.3f}; "
        f"holdout={second_holdout['test_effect']:.3f}"
    )


def plot_rank(
    ax: plt.Axes,
    frame: pd.DataFrame,
    spec: dict[str, Any],
    primary: dict[str, Any],
    dated: dict[str, Any],
    within: pd.DataFrame,
    compact: bool = False,
) -> None:
    x, y = spec["condition"], spec["outcome"]
    usable = frame.dropna(subset=[x, y])
    for fuel, group in usable.groupby("material"):
        ax.scatter(
            group[x],
            group[y],
            s=15 if compact else 24,
            alpha=0.48,
            color=FUEL_COLORS[fuel],
            edgecolors="none",
            label=fuel,
        )
    add_binned_median(ax, usable, x, y)
    ax.set_title(f"{spec['review_id']}. {spec['title']}", fontsize=10 if compact else 13)
    ax.set_xlabel(spec["x_label"])
    ax.set_ylabel(spec["y_label"])
    ax.grid(alpha=0.18)

    key = (x, y, spec["analyzer"])
    n = primary[key]["evidence"]["n_rows"]
    text = metric_text(spec, primary, dated) + f"\nAll usable rows: n={n}"
    fuel_rows = within[(within.condition == x) & (within.outcome == y)]
    for fuel in ("Methanol", "Heptane"):
        row = fuel_rows[fuel_rows.fuel == fuel]
        if not row.empty:
            text += f"\n{fuel}: rho={row.iloc[0].spearman_rho:.3f} (n={int(row.iloc[0].n)})"
    ax.text(
        0.02,
        0.98,
        text,
        transform=ax.transAxes,
        va="top",
        ha="left",
        fontsize=6.7 if compact else 8.5,
        bbox={
            "boxstyle": "round,pad=0.4",
            "facecolor": "white",
            "alpha": 0.88,
            "edgecolor": "#BBBBBB",
        },
    )
    if y == "extinction_diameter_ratio":
        flagged = usable[usable.experiment_id == 129]
        if not flagged.empty:
            row = flagged.iloc[0]
            ax.annotate(
                "Test 129: De/D0 slightly > 1",
                (row[x], row[y]),
                xytext=(12, -28),
                textcoords="offset points",
                fontsize=7 if compact else 9,
                arrowprops={"arrowstyle": "->", "color": "#555555"},
            )
    handles, labels = ax.get_legend_handles_labels()
    ax.legend(handles, labels, fontsize=7 if compact else 9, loc="lower right", frameon=False)


def plot_group(
    ax: plt.Axes,
    frame: pd.DataFrame,
    spec: dict[str, Any],
    primary: dict[str, Any],
    dated: dict[str, Any],
    compact: bool = False,
) -> None:
    fuels = ["Methanol", "Heptane"]
    usable = frame.dropna(subset=["material", "burn_time"])
    values = [usable.loc[usable.material == fuel, "burn_time"].to_numpy() for fuel in fuels]
    box = ax.boxplot(
        values,
        tick_labels=fuels,
        showfliers=False,
        patch_artist=True,
        medianprops={"color": "black", "linewidth": 1.5},
    )
    rng = np.random.default_rng(42)
    for index, (fuel, group) in enumerate(zip(fuels, values, strict=True), start=1):
        box["boxes"][index - 1].set_facecolor(FUEL_COLORS[fuel])
        box["boxes"][index - 1].set_alpha(0.25)
        jitter = rng.uniform(-0.10, 0.10, len(group))
        ax.scatter(
            np.full(len(group), index) + jitter,
            group,
            s=15 if compact else 24,
            alpha=0.45,
            color=FUEL_COLORS[fuel],
            edgecolors="none",
        )
        ax.text(
            index,
            max(group) * 1.02,
            f"median={np.median(group):.1f} s; n={len(group)}",
            ha="center",
            fontsize=7 if compact else 9,
        )
    ax.set_ylim(bottom=0, top=max(usable.burn_time) * 1.14)
    ax.set_title(f"{spec['review_id']}. {spec['title']}", fontsize=10 if compact else 13)
    ax.set_xlabel(spec["x_label"])
    ax.set_ylabel(spec["y_label"])
    ax.grid(axis="y", alpha=0.18)
    ax.text(
        0.02,
        0.98,
        metric_text(spec, primary, dated),
        transform=ax.transAxes,
        va="top",
        fontsize=7 if compact else 9,
        bbox={
            "boxstyle": "round,pad=0.4",
            "facecolor": "white",
            "alpha": 0.88,
            "edgecolor": "#BBBBBB",
        },
    )


def review_rows(
    primary: dict[str, Any], dated: dict[str, Any], within: pd.DataFrame
) -> list[dict[str, Any]]:
    rows = []
    for spec in SPECS:
        key = (spec["condition"], spec["outcome"], spec["analyzer"])
        first, second = primary[key], dated[key]
        first_holdout, second_holdout = holdout_metrics(first), holdout_metrics(second)
        row = {
            "review_id": spec["review_id"],
            "condition": spec["condition"],
            "outcome": spec["outcome"],
            "analyzer": spec["analyzer"],
            "n": first["evidence"]["n_rows"],
            "primary_effect": first["effect_size"],
            "primary_holdout_effect": first_holdout["test_effect"],
            "primary_holdout_p": first_holdout["test_p_value"],
            "date_effect": second["effect_size"],
            "date_holdout_effect": second_holdout["test_effect"],
            "date_holdout_p": second_holdout["test_p_value"],
            "q_value_primary": first["q_value"],
            "review_decision": spec["decision"],
            "scope_and_limitation": spec["scope"],
            "formal_expert_approval": False,
        }
        if spec["analyzer"] == "rank_correlation":
            fuel_rows = within[
                (within.condition == spec["condition"]) & (within.outcome == spec["outcome"])
            ]
            for fuel in ("Methanol", "Heptane"):
                match = fuel_rows[fuel_rows.fuel == fuel].iloc[0]
                row[f"{fuel.lower()}_rho"] = match.spearman_rho
                row[f"{fuel.lower()}_n"] = int(match.n)
                row[f"{fuel.lower()}_descriptive_p"] = match.p_value_descriptive
        rows.append(row)
    return rows


def metadata_audit(frame: pd.DataFrame) -> dict[str, Any]:
    dates = pd.to_datetime(frame.test_date, format="mixed")
    per_date = frame.assign(parsed_date=dates).groupby("parsed_date").size()
    duplicates = frame[frame.flex_identifier.duplicated(keep=False)]
    return {
        "review_type": "source-grounded metadata audit; not a complete row-by-row crosswalk",
        "official_report": {
            "title": (
                "Detailed Results from the Flame Extinguishment Experiment (FLEX) "
                "March 2009 to December 2011"
            ),
            "document_id": "NASA/TP-2015-216046",
            "url": "https://ntrs.nasa.gov/citations/20150023456",
            "documented_setting": "MDCA inside CIR, Destiny module, International Space Station",
            "documented_series_size": 284,
            "documented_operations": (
                "Periodically scheduled intervals, generally about 4-10 droplets"
            ),
        },
        "psi_table_audit": {
            "rows": len(frame),
            "minimum_test_date": str(dates.min().date()),
            "maximum_test_date": str(dates.max().date()),
            "unique_test_dates": int(frame.test_date.nunique()),
            "rows_per_test_date_min": int(per_date.min()),
            "rows_per_test_date_max": int(per_date.max()),
            "duplicate_identifier_rows": duplicates[
                ["experiment_id", "flex_identifier", "test_date", "test_gmt", "material"]
            ].to_dict(orient="records"),
        },
        "numbering_evidence": {
            "psi_experiment_id": 274,
            "flex_identifier": "H19H201",
            "psi_test_date": "12/8/2011",
            "nasa_report_test": "FLEX-280",
            "conclusion": "PSI test numbers must not be assumed equal to report test numbers",
        },
        "environment_conclusion": {
            "series_level_label": "ISS_microgravity_flight_series",
            "basis": (
                "Official report scope, matching date interval, and identifier/date cross-checks"
            ),
            "limitation": (
                "PSI has no per-row space/ground column and no complete 274-row "
                "crosswalk was produced"
            ),
            "per_row_labels_added": False,
        },
        "campaign_conclusion": {
            "recommended_field": "operational_date_proxy=test_date",
            "official_campaign_id_recovered": False,
            "limitation": (
                "A test date is real operations metadata, not a verified campaign identifier"
            ),
        },
        "partial_gravity_claim_allowed": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True, help="FLEX results directory")
    parser.add_argument("--output", type=Path, required=True, help="Review output directory")
    args = parser.parse_args()

    frame = pd.read_csv(args.results / "standardized_flex.csv")
    within = pd.read_csv(args.results / "robustness" / "within_fuel_correlations.csv")
    primary_payload = load_json(args.results / PRIMARY / "findings.json")
    dated_payload = load_json(args.results / DATE_SPLIT / "findings.json")
    primary = finding_lookup(primary_payload)
    dated = finding_lookup(dated_payload)

    args.output.mkdir(parents=True, exist_ok=True)
    plot_dir = args.output / "plots"
    plot_dir.mkdir(exist_ok=True)

    rows = review_rows(primary, dated, within)
    pd.DataFrame(rows).to_csv(args.output / "eight_findings_review.csv", index=False)
    summary = {
        "review_type": "machine-assisted scientific review",
        "formal_expert_approval": False,
        "independent_external_validation": False,
        "reviewed_findings": len(rows),
        "recommended_candidate_insight_themes": [
            "oxygen versus burning-rate constant K",
            "initial diameter versus visible-extinction diameter",
            "oxygen versus extinction diameters (De and De/D0 combined)",
        ],
        "findings": rows,
    }
    with (args.output / "review_summary.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    with (args.output / "metadata_review.json").open("w", encoding="utf-8") as handle:
        json.dump(metadata_audit(frame), handle, ensure_ascii=False, indent=2)

    filenames = []
    for spec in SPECS:
        fig, ax = plt.subplots(figsize=(8.2, 6.2), constrained_layout=True)
        if spec["analyzer"] == "rank_correlation":
            plot_rank(ax, frame, spec, primary, dated, within)
        else:
            plot_group(ax, frame, spec, primary, dated)
        footer = "Associations, not causal effects. Points are colored by fuel."
        if spec["analyzer"] == "rank_correlation":
            footer += " Dashed lines are descriptive medians."
        else:
            footer += " Boxes show the interquartile range and median."
        fig.text(0.5, -0.025, footer, ha="center", fontsize=9, color="#444444")
        filename = f"{spec['review_id']:02d}_{spec['condition']}_{spec['outcome']}.png"
        fig.savefig(plot_dir / filename, dpi=170, bbox_inches="tight")
        plt.close(fig)
        filenames.append(filename)

    fig, axes = plt.subplots(4, 2, figsize=(16, 23), constrained_layout=True)
    for ax, spec in zip(axes.flat, SPECS, strict=True):
        if spec["analyzer"] == "rank_correlation":
            plot_rank(ax, frame, spec, primary, dated, within, compact=True)
        else:
            plot_group(ax, frame, spec, primary, dated, compact=True)
    fig.suptitle(
        "Falmex / NASA FLEX: machine-assisted review of eight robust findings",
        fontsize=17,
    )
    fig.savefig(args.output / "eight_findings_overview.png", dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Reviewed {len(rows)} findings")
    print(f"Wrote {len(filenames)} individual plots and one overview to {args.output}")
    print("Formal expert approval: false; external validation: false")


if __name__ == "__main__":
    main()
