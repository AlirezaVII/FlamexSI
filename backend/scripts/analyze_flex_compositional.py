"""Run the locked, zero-aware FLEX diluent compositional protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import GroupKFold

from falmex.analysis.compositional import add_diluent_balances
from falmex.validation import benjamini_hochberg

OUTCOMES = {
    "K": "droplet_burning_rate_constant",
    "ratio": "extinction_diameter_ratio",
}
BASE_COLUMNS = ["intercept", "log_initial_diameter", "pressure_100kpa", "heptane"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def design_matrix(
    frame: pd.DataFrame, *, fuel: bool = True, test_end: bool = False
) -> pd.DataFrame:
    design = pd.DataFrame(
        {
            "intercept": 1.0,
            "b_oxygen": frame.b_oxygen.astype(float),
            "b_alternative": frame.b_alternative.astype(float),
            "log_initial_diameter": np.log(frame.initial_droplet_diameter.astype(float)),
            "pressure_100kpa": frame.pressure.astype(float) / 100.0,
        },
        index=frame.index,
    )
    if fuel:
        design["heptane"] = (frame.material == "Heptane").astype(float)
    if test_end:
        indicators = pd.get_dummies(
            frame.test_end.astype(str), prefix="test_end", drop_first=True, dtype=float
        )
        design = pd.concat([design, indicators], axis=1)
    return design.astype(float)


def fit_model(
    frame: pd.DataFrame,
    outcome: str,
    *,
    model_id: str,
    diluent: str,
    scope: str,
    role: str,
    fuel: bool = True,
    test_end: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]], pd.DataFrame, Any]:
    required = [
        outcome,
        "b_oxygen",
        "b_alternative",
        "initial_droplet_diameter",
        "pressure",
        "material",
        "test_date",
    ]
    if test_end:
        required.append("test_end")
    usable = frame.dropna(subset=required).copy()
    design = design_matrix(usable, fuel=fuel, test_end=test_end)
    minimum_n = 30 if role == "primary" else 15
    minimum_dates = 10 if role == "primary" else 5
    rank = int(np.linalg.matrix_rank(design.to_numpy()))
    n_params = design.shape[1]
    n_dates = usable.test_date.nunique()
    evaluable = (
        len(usable) >= minimum_n
        and n_dates >= minimum_dates
        and rank == n_params
        and len(usable) >= 3 * n_params
    )
    summary: dict[str, Any] = {
        "model_id": model_id,
        "diluent": diluent,
        "outcome": outcome,
        "scope": scope,
        "role": role,
        "status": "evaluated" if evaluable else "not_evaluable",
        "n": len(usable),
        "n_dates": n_dates,
        "n_parameters": n_params,
        "design_rank": rank,
        "small_cluster_warning": n_dates < 20,
    }
    if not evaluable:
        return summary, [], design, None

    fit = sm.OLS(usable[outcome].astype(float), design).fit(
        cov_type="cluster",
        cov_kwds={"groups": usable.test_date.to_numpy(), "use_correction": True},
        use_t=True,
    )
    coefficients = []
    for name in design.columns:
        low, high = fit.conf_int().loc[name]
        coefficients.append(
            {
                "model_id": model_id,
                "diluent": diluent,
                "outcome": outcome,
                "scope": scope,
                "role": role,
                "term": name,
                "estimate": fit.params[name],
                "cluster_se": fit.bse[name],
                "ci95_low": low,
                "ci95_high": high,
                "p_value": fit.pvalues[name],
                "n": len(usable),
                "n_dates": n_dates,
            }
        )
    estimate = fit.params["b_alternative"]
    low, high = fit.conf_int().loc["b_alternative"]
    doubling_scale = np.log(2.0) / np.sqrt(2.0)
    summary.update(
        {
            "beta_alternative": estimate,
            "cluster_se": fit.bse["b_alternative"],
            "ci95_low": low,
            "ci95_high": high,
            "p_value": fit.pvalues["b_alternative"],
            "effect_per_alternative_n2_doubling": estimate * doubling_scale,
            "doubling_ci95_low": low * doubling_scale,
            "doubling_ci95_high": high * doubling_scale,
            "r_squared_in_sample": fit.rsquared,
            "rmse_in_sample": float(np.sqrt(np.mean(fit.resid**2))),
            "cluster_df": n_dates - 1,
        }
    )
    return summary, coefficients, design, fit


def leave_one_date_out(
    frame: pd.DataFrame, outcome: str, design: pd.DataFrame, model_id: str
) -> list[dict[str, Any]]:
    usable = frame.loc[design.index]
    records = []
    for date in sorted(usable.test_date.unique()):
        keep = usable.test_date != date
        train = design.loc[keep]
        if np.linalg.matrix_rank(train.to_numpy()) < train.shape[1]:
            continue
        beta = np.linalg.lstsq(train.to_numpy(), usable.loc[keep, outcome], rcond=None)[0]
        records.append(
            {
                "model_id": model_id,
                "omitted_test_date": date,
                "n": int(keep.sum()),
                "beta_alternative": beta[train.columns.get_loc("b_alternative")],
            }
        )
    return records


def grouped_predictions(
    frame: pd.DataFrame, outcome: str, design: pd.DataFrame, model_id: str
) -> tuple[dict[str, Any], pd.DataFrame]:
    usable = frame.loc[design.index].copy()
    baseline_columns = [column for column in BASE_COLUMNS if column in design.columns]
    groups = usable.test_date.to_numpy()
    splitter = GroupKFold(n_splits=min(5, len(np.unique(groups))))
    predictions = []
    for fold, (train, test) in enumerate(splitter.split(design, groups=groups), start=1):
        full_train = design.iloc[train]
        base_train = design.iloc[train][baseline_columns]
        if (
            np.linalg.matrix_rank(full_train.to_numpy()) < full_train.shape[1]
            or np.linalg.matrix_rank(base_train.to_numpy()) < base_train.shape[1]
        ):
            raise ValueError(f"Rank-deficient training fold in {model_id}")
        full_beta = np.linalg.lstsq(full_train, usable[outcome].iloc[train], rcond=None)[0]
        base_beta = np.linalg.lstsq(base_train, usable[outcome].iloc[train], rcond=None)[0]
        fold_frame = usable.iloc[test][
            ["experiment_id", "flex_identifier", "test_date", "material"]
        ].copy()
        fold_frame["model_id"] = model_id
        fold_frame["fold"] = fold
        fold_frame["observed"] = usable[outcome].iloc[test].to_numpy()
        fold_frame["predicted_full"] = design.iloc[test].to_numpy() @ full_beta
        fold_frame["predicted_baseline"] = (
            design.iloc[test][baseline_columns].to_numpy() @ base_beta
        )
        predictions.append(fold_frame)
    predicted = pd.concat(predictions).sort_index()
    observed = predicted.observed.to_numpy()
    full = predicted.predicted_full.to_numpy()
    baseline = predicted.predicted_baseline.to_numpy()
    full_rmse = mean_squared_error(observed, full) ** 0.5
    baseline_rmse = mean_squared_error(observed, baseline) ** 0.5
    summary = {
        "model_id": model_id,
        "prediction_n": len(predicted),
        "n_folds": predicted.fold.nunique(),
        "full_rmse": full_rmse,
        "baseline_rmse": baseline_rmse,
        "delta_rmse_full_minus_baseline": full_rmse - baseline_rmse,
        "rmse_ratio_full_over_baseline": full_rmse / baseline_rmse,
        "full_mae": mean_absolute_error(observed, full),
        "baseline_mae": mean_absolute_error(observed, baseline),
        "negative_full_prediction_count": int(np.sum(full < 0)),
        "negative_baseline_prediction_count": int(np.sum(baseline < 0)),
        "interpretation": "Date-grouped descriptive check, not independent campaign validation",
    }
    return summary, predicted


def descriptive_n2(frame: pd.DataFrame) -> pd.DataFrame:
    mask = (frame.carbon_dioxide_fraction == 0) & (frame.helium_fraction == 0)
    subset = frame.loc[mask]
    records = []
    for fuel, group in [("All", subset), *list(subset.groupby("material"))]:
        for label, outcome in OUTCOMES.items():
            values = group[outcome].dropna()
            records.append(
                {
                    "subset": "N2-only",
                    "fuel": fuel,
                    "outcome": label,
                    "n": len(values),
                    "mean": values.mean(),
                    "standard_deviation": values.std(),
                    "median": values.median(),
                    "q25": values.quantile(0.25),
                    "q75": values.quantile(0.75),
                }
            )
    return pd.DataFrame(records)


def make_coefficient_plot(primary: pd.DataFrame, output: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.8), constrained_layout=True)
    for axis, outcome in zip(axes, OUTCOMES, strict=True):
        rows = primary[primary.outcome == OUTCOMES[outcome]].copy()
        rows["order"] = rows.diluent.map({"CO2": 0, "He": 1})
        rows = rows.sort_values("order", ascending=False)
        positions = np.arange(len(rows))
        axis.errorbar(
            rows.beta_alternative,
            positions,
            xerr=[rows.beta_alternative - rows.ci95_low, rows.ci95_high - rows.beta_alternative],
            fmt="o",
            color="#0072B2",
            ecolor="#0072B2",
            capsize=5,
            markersize=7,
        )
        axis.axvline(0.0, color="#555555", linestyle="--", linewidth=1)
        axis.set_yticks(
            positions,
            [
                f"{row.diluent} | n={row.n}, dates={row.n_dates}\nBH q={row.bh_q_value:.3g}"
                for row in rows.itertuples()
            ],
        )
        unit = "K (mm²/s)" if outcome == "K" else "De/D₀"
        axis.set_xlabel(f"β for alternative/N₂ balance | outcome: {unit}")
        axis.grid(axis="x", alpha=0.2)
    fig.suptitle("Adjusted compositional associations with date-clustered 95% intervals")
    fig.text(
        0.5,
        -0.04,
        "Observed-covariate adjustment only; no causal or independent-protocol claim.",
        ha="center",
        fontsize=9,
    )
    fig.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(fig)


def make_prediction_plot(primary: pd.DataFrame, predictions: pd.DataFrame, output: Path) -> None:
    fig, axes = plt.subplots(2, 2, figsize=(10, 9), constrained_layout=True)
    for axis, model_id in zip(axes.flat, primary.model_id, strict=True):
        subset = predictions[predictions.model_id == model_id]
        for fuel, marker in [("Methanol", "o"), ("Heptane", "s")]:
            points = subset[subset.material == fuel]
            axis.scatter(
                points.observed,
                points.predicted_full,
                s=24,
                alpha=0.72,
                marker=marker,
                label=fuel,
            )
        low = min(subset.observed.min(), subset.predicted_full.min())
        high = max(subset.observed.max(), subset.predicted_full.max())
        axis.plot([low, high], [low, high], "--", color="#555555", linewidth=1)
        summary = primary[primary.model_id == model_id].iloc[0]
        axis.set_title(
            f"{model_id} | full RMSE={summary.full_rmse:.3g}; baseline={summary.baseline_rmse:.3g}"
        )
        axis.set_xlabel("Observed")
        axis.set_ylabel("Date-grouped out-of-fold prediction")
        axis.grid(alpha=0.18)
    axes.flat[0].legend(frameon=False)
    fig.suptitle("Compositional model prediction checks: full model with gas balances")
    fig.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--protocol-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    lock = json.loads(args.protocol_lock.read_text(encoding="utf-8"))
    if sha256(args.protocol) != lock["protocol_sha256"]:
        raise ValueError("Compositional protocol hash differs from the locked version")

    source = pd.read_csv(args.input)
    args.output.mkdir(parents=True, exist_ok=True)
    balances = pd.concat([add_diluent_balances(source, key) for key in ["CO2", "He"]])
    balance_columns = [
        "experiment_id",
        "flex_identifier",
        "test_date",
        "material",
        "diluent",
        "oxygen",
        "nitrogen_fraction",
        "alternative_fraction_raw",
        "raw_three_part_sum",
        "closed_oxygen",
        "closed_nitrogen",
        "closed_alternative",
        "b_oxygen",
        "b_alternative",
        "initial_droplet_diameter",
        "pressure",
        "test_end",
        *OUTCOMES.values(),
    ]
    balances[balance_columns].to_csv(args.output / "compositional_balances_by_row.csv", index=False)
    descriptive_n2(source).to_csv(args.output / "n2_only_descriptive.csv", index=False)

    summaries: list[dict[str, Any]] = []
    coefficients: list[dict[str, Any]] = []
    loo_records: list[dict[str, Any]] = []
    prediction_summaries: list[dict[str, Any]] = []
    prediction_frames: list[pd.DataFrame] = []
    primary_designs: dict[str, pd.DataFrame] = {}
    for diluent in ["CO2", "He"]:
        subset = balances[balances.diluent == diluent].copy()
        for outcome_label, outcome in OUTCOMES.items():
            model_id = f"{diluent}_{outcome_label}"
            summary, coefs, design, fit = fit_model(
                subset,
                outcome,
                model_id=model_id,
                diluent=diluent,
                scope="pooled_fuels",
                role="primary",
            )
            summaries.append(summary)
            coefficients.extend(coefs)
            if fit is None:
                continue
            primary_designs[model_id] = design
            loo_records.extend(leave_one_date_out(subset, outcome, design, model_id))
            prediction_summary, predicted = grouped_predictions(subset, outcome, design, model_id)
            prediction_summaries.append(prediction_summary)
            prediction_frames.append(predicted)

            for fuel in ["Methanol", "Heptane"]:
                scoped = subset[subset.material == fuel]
                scoped_summary, scoped_coefs, _, _ = fit_model(
                    scoped,
                    outcome,
                    model_id=f"{model_id}_{fuel}",
                    diluent=diluent,
                    scope=fuel,
                    role="within_fuel_sensitivity",
                    fuel=False,
                )
                summaries.append(scoped_summary)
                coefficients.extend(scoped_coefs)
            end_summary, end_coefs, _, _ = fit_model(
                subset,
                outcome,
                model_id=f"{model_id}_test_end",
                diluent=diluent,
                scope="pooled_fuels",
                role="test_end_sensitivity",
                test_end=True,
            )
            summaries.append(end_summary)
            coefficients.extend(end_coefs)

    models = pd.DataFrame(summaries)
    primary = models[models.role == "primary"].copy()
    primary["bh_q_value"] = benjamini_hochberg(primary.p_value.tolist())
    models = models.merge(
        primary[["model_id", "bh_q_value"]], on="model_id", how="left", validate="one_to_one"
    )
    models = models.merge(
        pd.DataFrame(prediction_summaries), on="model_id", how="left", validate="one_to_one"
    )
    models.to_csv(args.output / "compositional_model_summary.csv", index=False)
    pd.DataFrame(coefficients).merge(
        primary[["model_id", "bh_q_value"]], on="model_id", how="left"
    ).to_csv(args.output / "compositional_coefficients.csv", index=False)

    loo = pd.DataFrame(loo_records)
    loo_summary = (
        loo.groupby("model_id")
        .beta_alternative.agg(["min", "max", "median", "count"])
        .reset_index()
    )
    original = primary.set_index("model_id").beta_alternative
    loo_summary["same_sign_share"] = [
        float(
            np.mean(
                np.sign(loo.loc[loo.model_id == model_id, "beta_alternative"])
                == np.sign(original[model_id])
            )
        )
        for model_id in loo_summary.model_id
    ]
    loo.to_csv(args.output / "leave_one_date_out.csv", index=False)
    loo_summary.to_csv(args.output / "leave_one_date_out_summary.csv", index=False)
    predictions = pd.concat(prediction_frames, ignore_index=True)
    predictions.to_csv(args.output / "date_grouped_predictions.csv", index=False)

    primary = models[models.role == "primary"].copy()
    make_coefficient_plot(primary, args.output / "compositional_primary_coefficients.png")
    make_prediction_plot(
        primary, predictions, args.output / "compositional_grouped_predictions.png"
    )

    payload = {
        "analysis_type": "zero-aware three-part compositional association analysis",
        "protocol_version": lock["protocol_version"],
        "protocol_sha256": lock["protocol_sha256"],
        "protocol_verified": True,
        "input_sha256": sha256(args.input),
        "external_registry_preregistration": False,
        "causal_effects_established": False,
        "full_protocol_control_established": False,
        "independent_campaign_validation": False,
        "primary_models": primary.to_dict(orient="records"),
        "negative_out_of_fold_predictions": int(primary.negative_full_prediction_count.sum()),
        "structural_zero_policy": (
            "Separate positive CO2 and He subsets; no pseudocount replacement"
        ),
        "n2_only_policy": "Descriptive only; not forced into three-part log-ratios",
        "limitations": [
            "Tether/free-float, translation and detailed deployment fields are absent from PSI-69.",
            "Date clustering does not recover independent campaigns or all protocol differences.",
            "He models have fewer than 20 date clusters; cluster-robust p-values are exploratory.",
            "Disjoint CO2 and He subset coefficients are not a direct He-versus-CO2 contrast.",
            "Grouped prediction checks are not independent campaign validation.",
            "Linear OLS is an association model here, not a physically bounded ratio predictor.",
            (
                "Observed associations do not establish mechanisms or operational "
                "safety recommendations."
            ),
        ],
    }
    with (args.output / "compositional_analysis_summary.json").open(
        "w", encoding="utf-8"
    ) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(
        primary[
            [
                "model_id",
                "n",
                "n_dates",
                "beta_alternative",
                "p_value",
                "bh_q_value",
                "delta_rmse_full_minus_baseline",
            ]
        ].to_string(index=False)
    )
    print("Causal effects established: false; full protocol control: false")


if __name__ == "__main__":
    main()
