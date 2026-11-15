import numpy as np
import pandas as pd
import pytest

from falmex.analysis.uncertainty import (
    BURNING_RATE_EXPANDED_95_MM2_S,
    COVERAGE_FACTOR_95,
    DIAMETER_EXPANDED_95_MM,
    add_typical_uncertainty_scenario,
    d2_residual_standard_uncertainty,
    extinction_ratio_standard_uncertainty,
    normalized_d2_residual_standard_uncertainty,
)


def test_ratio_uncertainty_matches_taylor_derivatives():
    result = extinction_ratio_standard_uncertainty(2.0, 1.0, 0.1)
    expected = np.sqrt((0.1 / 2.0) ** 2 + (1.0 * 0.1 / 2.0**2) ** 2)
    assert result == pytest.approx(expected)


def test_d2_residual_uncertainty_includes_all_inputs():
    result = d2_residual_standard_uncertainty(2.0, 1.0, 0.5, 6.0, 0.1, 0.01, 0.2)
    expected = np.sqrt(0.4**2 + 0.2**2 + 0.06**2 + 0.1**2)
    assert result == pytest.approx(expected)


def test_normalized_residual_accounts_for_shared_d0():
    result = normalized_d2_residual_standard_uncertainty(2.0, 1.0, 0.5, 6.0, 0.1, 0.01)
    # r_n = 1 - (1 + 3) / 4 = 0. Derivatives are 1, -0.5 and -1.5.
    expected = np.sqrt(0.1**2 + 0.05**2 + 0.015**2)
    assert result == pytest.approx(expected)


def test_invalid_values_return_nan_instead_of_warnings_or_infinity():
    assert np.isnan(extinction_ratio_standard_uncertainty(0.0, 1.0))
    assert np.isnan(d2_residual_standard_uncertainty(2.0, np.nan, 0.5, 6.0))
    assert np.isnan(normalized_d2_residual_standard_uncertainty(0.0, 1.0, 0.5, 6.0))


def test_scenario_preserves_measurements_and_expands_standard_uncertainty():
    frame = pd.DataFrame(
        {
            "experiment_id": [1],
            "initial_droplet_diameter": [2.0],
            "visible_extinction_diameter": [1.0],
            "droplet_burning_rate_constant": [0.5],
            "burn_time": [6.0],
        }
    )
    result = add_typical_uncertainty_scenario(frame)
    assert result.loc[0, "initial_droplet_diameter"] == 2.0
    assert result.loc[0, "diameter_standard_uncertainty_scenario_mm"] == pytest.approx(
        DIAMETER_EXPANDED_95_MM / COVERAGE_FACTOR_95
    )
    assert result.loc[0, "burning_rate_standard_uncertainty_scenario_mm2_s"] == pytest.approx(
        BURNING_RATE_EXPANDED_95_MM2_S / COVERAGE_FACTOR_95
    )
    assert result.loc[0, "extinction_ratio_expanded_95_scenario"] == pytest.approx(
        COVERAGE_FACTOR_95 * result.loc[0, "extinction_ratio_standard_uncertainty"]
    )


def test_scenario_rejects_unrelated_tables():
    with pytest.raises(ValueError, match="Missing required FLEX columns"):
        add_typical_uncertainty_scenario(pd.DataFrame({"experiment_id": [1]}))
