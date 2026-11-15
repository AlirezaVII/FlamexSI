"""First-order measurement-uncertainty propagation for FLEX derived quantities.

The functions implement Taylor-series propagation under an explicit independent-
input approximation. They do not infer per-row uncertainties from the PSI table.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DIAMETER_EXPANDED_95_MM = 0.1
BURNING_RATE_EXPANDED_95_MM2_S = 0.005
COVERAGE_FACTOR_95 = 1.96
DIAMETER_STANDARD_MM = DIAMETER_EXPANDED_95_MM / COVERAGE_FACTOR_95
BURNING_RATE_STANDARD_MM2_S = BURNING_RATE_EXPANDED_95_MM2_S / COVERAGE_FACTOR_95


def _arrays(*values: object) -> tuple[np.ndarray, ...]:
    return tuple(np.asarray(value, dtype=float) for value in values)


def extinction_ratio_standard_uncertainty(
    initial_diameter: object,
    extinction_diameter: object,
    diameter_standard_uncertainty: object = DIAMETER_STANDARD_MM,
) -> np.ndarray:
    """Propagate independent D0 and De errors into R_D = De / D0.

    u_R^2 = (u_De / D0)^2 + (De * u_D0 / D0^2)^2.
    Invalid or non-positive D0 values produce NaN.
    """
    d0, de, uncertainty = _arrays(
        initial_diameter, extinction_diameter, diameter_standard_uncertainty
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        variance = (uncertainty / d0) ** 2 + (de * uncertainty / d0**2) ** 2
        result = np.sqrt(variance)
    return np.where((d0 > 0) & np.isfinite(result), result, np.nan)


def d2_residual_standard_uncertainty(
    initial_diameter: object,
    extinction_diameter: object,
    burning_rate: object,
    burn_time: object,
    diameter_standard_uncertainty: object = DIAMETER_STANDARD_MM,
    burning_rate_standard_uncertainty: object = BURNING_RATE_STANDARD_MM2_S,
    burn_time_standard_uncertainty: object = 0.0,
) -> np.ndarray:
    """Propagate independent errors into r = D0^2 - De^2 - K * t_b."""
    d0, de, rate, time, u_diameter, u_rate, u_time = _arrays(
        initial_diameter,
        extinction_diameter,
        burning_rate,
        burn_time,
        diameter_standard_uncertainty,
        burning_rate_standard_uncertainty,
        burn_time_standard_uncertainty,
    )
    variance = (
        (2 * d0 * u_diameter) ** 2
        + (2 * de * u_diameter) ** 2
        + (time * u_rate) ** 2
        + (rate * u_time) ** 2
    )
    result = np.sqrt(variance)
    valid = np.isfinite(result) & np.isfinite(d0 + de + rate + time)
    return np.where(valid, result, np.nan)


def normalized_d2_residual_standard_uncertainty(
    initial_diameter: object,
    extinction_diameter: object,
    burning_rate: object,
    burn_time: object,
    diameter_standard_uncertainty: object = DIAMETER_STANDARD_MM,
    burning_rate_standard_uncertainty: object = BURNING_RATE_STANDARD_MM2_S,
    burn_time_standard_uncertainty: object = 0.0,
) -> np.ndarray:
    """Propagate independent errors into r_n = 1 - (De^2 + K*t_b)/D0^2.

    The shared D0 in the numerator and denominator is differentiated exactly;
    treating the ratio and residual as independent would be incorrect.
    """
    d0, de, rate, time, u_diameter, u_rate, u_time = _arrays(
        initial_diameter,
        extinction_diameter,
        burning_rate,
        burn_time,
        diameter_standard_uncertainty,
        burning_rate_standard_uncertainty,
        burn_time_standard_uncertainty,
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        shared = de**2 + rate * time
        variance = (
            (2 * shared * u_diameter / d0**3) ** 2
            + (2 * de * u_diameter / d0**2) ** 2
            + (time * u_rate / d0**2) ** 2
            + (rate * u_time / d0**2) ** 2
        )
        result = np.sqrt(variance)
    valid = (d0 > 0) & np.isfinite(result) & np.isfinite(d0 + de + rate + time)
    return np.where(valid, result, np.nan)


def add_typical_uncertainty_scenario(frame: pd.DataFrame) -> pd.DataFrame:
    """Add literature-based scenario uncertainties without changing raw values.

    Shaw and Yu report typical 95% expanded uncertainties for methanol/heptane.
    Dividing by 1.96 is a working standard-uncertainty scenario, not a recovery
    of the actual uncertainty budget for any individual PSI-69 test.
    """
    required = {
        "experiment_id",
        "initial_droplet_diameter",
        "visible_extinction_diameter",
        "droplet_burning_rate_constant",
        "burn_time",
    }
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Missing required FLEX columns: {sorted(missing)}")

    out = frame.copy()
    d0 = out["initial_droplet_diameter"]
    de = out["visible_extinction_diameter"]
    rate = out["droplet_burning_rate_constant"]
    time = out["burn_time"]
    out["diameter_standard_uncertainty_scenario_mm"] = DIAMETER_STANDARD_MM
    out["burning_rate_standard_uncertainty_scenario_mm2_s"] = BURNING_RATE_STANDARD_MM2_S
    out["extinction_ratio_standard_uncertainty"] = extinction_ratio_standard_uncertainty(d0, de)
    out["d2_residual_standard_uncertainty"] = d2_residual_standard_uncertainty(d0, de, rate, time)
    out["normalized_d2_residual_standard_uncertainty"] = (
        normalized_d2_residual_standard_uncertainty(d0, de, rate, time)
    )
    out["extinction_ratio_expanded_95_scenario"] = (
        COVERAGE_FACTOR_95 * out["extinction_ratio_standard_uncertainty"]
    )
    out["d2_residual_expanded_95_scenario"] = (
        COVERAGE_FACTOR_95 * out["d2_residual_standard_uncertainty"]
    )
    out["normalized_d2_residual_expanded_95_scenario"] = (
        COVERAGE_FACTOR_95 * out["normalized_d2_residual_standard_uncertainty"]
    )
    return out
