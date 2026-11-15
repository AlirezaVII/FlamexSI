import numpy as np
import pandas as pd
import pytest

from falmex.analysis.compositional import add_diluent_balances, close_and_balance_three_parts


def test_closure_removes_rounding_error_and_balances_are_orthonormal():
    result = close_and_balance_three_parts([21.0], [0.49], [0.30])
    closed = result[["closed_oxygen", "closed_nitrogen", "closed_alternative"]].iloc[0]
    assert closed.sum() == pytest.approx(1.0)
    assert result.raw_three_part_sum.iloc[0] == pytest.approx(1.0)

    # Basis vectors e1=(sqrt(2/3),-1/sqrt(6),-1/sqrt(6)) and
    # e2=(0,1/sqrt(2),-1/sqrt(2)) are orthonormal in Aitchison geometry.
    e1 = np.array([np.sqrt(2 / 3), -1 / np.sqrt(6), -1 / np.sqrt(6)])
    e2 = np.array([0.0, 1 / np.sqrt(2), -1 / np.sqrt(2)])
    assert e1 @ e2 == pytest.approx(0.0)
    assert e1 @ e1 == pytest.approx(1.0)
    assert e2 @ e2 == pytest.approx(1.0)


def test_known_composition_has_expected_log_ratio_balances():
    result = close_and_balance_three_parts([0.25], [0.25], [0.5], oxygen_is_percent=False)
    assert result.b_oxygen.iloc[0] == pytest.approx(
        np.sqrt(2 / 3) * np.log(0.25 / np.sqrt(0.25 * 0.5))
    )
    assert result.b_alternative.iloc[0] == pytest.approx(np.log(2.0) / np.sqrt(2.0))


def test_structural_zero_is_rejected_instead_of_replaced():
    with pytest.raises(ValueError, match="strictly positive"):
        close_and_balance_three_parts([21.0], [79.0], [0.0])


def test_diluent_subsets_do_not_mix_structural_zero_families():
    frame = pd.DataFrame(
        {
            "experiment_id": [1, 2, 3],
            "oxygen": [21.0, 21.0, 21.0],
            "nitrogen_fraction": [0.49, 0.49, 0.79],
            "carbon_dioxide_fraction": [0.30, 0.0, 0.0],
            "helium_fraction": [0.0, 0.30, 0.0],
        }
    )
    co2 = add_diluent_balances(frame, "CO2")
    helium = add_diluent_balances(frame, "He")
    assert co2.experiment_id.tolist() == [1]
    assert helium.experiment_id.tolist() == [2]
    assert np.isfinite(co2.b_alternative.iloc[0])
    assert np.isfinite(helium.b_alternative.iloc[0])


def test_unrelated_table_is_rejected():
    with pytest.raises(ValueError, match="Missing FLEX gas columns"):
        add_diluent_balances(pd.DataFrame({"oxygen": [21.0]}), "CO2")
