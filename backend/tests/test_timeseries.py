import numpy as np
import pytest

from falmex.analysis.timeseries import linear_d2_fit, normalized_time_window


def test_linear_d2_fit_recovers_d2_law_slope_and_intercept():
    time = np.linspace(0.0, 10.0, 21)
    d2 = 9.0 - 0.6 * time
    fit = linear_d2_fit(time, d2)
    assert fit["slope_mm2_s"] == pytest.approx(-0.6)
    assert fit["burning_rate_constant_mm2_s"] == pytest.approx(0.6)
    assert fit["intercept_mm2"] == pytest.approx(9.0)
    assert fit["rmse_mm2"] == pytest.approx(0.0, abs=1e-12)
    assert fit["r_squared"] == pytest.approx(1.0)


def test_normalized_time_window_uses_physical_extinction_duration():
    time = np.array([0.0, 1.0, 2.0, 8.0, 9.0, 10.0, np.nan])
    mask = normalized_time_window(time, 0.1, 0.9, duration_s=10.0)
    np.testing.assert_array_equal(mask, [False, True, True, True, True, False, False])


def test_fit_ignores_nonfinite_pairs_but_rejects_insufficient_data():
    fit = linear_d2_fit([0.0, 1.0, 2.0, np.nan], [4.0, 3.0, 2.0, 1.0])
    assert fit["n"] == 3
    with pytest.raises(ValueError, match="At least three"):
        linear_d2_fit([0.0, 1.0], [2.0, 1.0])
    with pytest.raises(ValueError, match="non-zero"):
        linear_d2_fit([1.0, 1.0, 1.0], [3.0, 2.0, 1.0])


def test_window_rejects_invalid_fractions_and_duration():
    with pytest.raises(ValueError, match="0 <= start < end <= 1"):
        normalized_time_window([0.0, 1.0], 0.8, 0.2, duration_s=1.0)
    with pytest.raises(ValueError, match="positive"):
        normalized_time_window([0.0, 1.0], 0.0, 1.0, duration_s=0.0)
