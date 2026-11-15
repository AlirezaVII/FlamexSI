"""Zero-aware, three-part compositional transforms for FLEX gas subsets."""

from __future__ import annotations

import numpy as np
import pandas as pd

GAS_COLUMNS = {
    "CO2": ("oxygen", "nitrogen_fraction", "carbon_dioxide_fraction"),
    "He": ("oxygen", "nitrogen_fraction", "helium_fraction"),
}


def close_and_balance_three_parts(
    oxygen: object,
    nitrogen: object,
    alternative: object,
    *,
    oxygen_is_percent: bool = True,
) -> pd.DataFrame:
    """Close three positive parts and return the protocol's orthonormal balances.

    No pseudocount or zero replacement is performed. Non-positive or non-finite
    inputs raise an error so structural zeros cannot silently enter a log-ratio.
    """
    o2, n2, alt = (np.asarray(value, dtype=float) for value in (oxygen, nitrogen, alternative))
    if not (o2.shape == n2.shape == alt.shape):
        raise ValueError("Gas-part arrays must have equal shapes")
    if oxygen_is_percent:
        o2 = o2 / 100.0
    total = o2 + n2 + alt
    valid = np.isfinite(total) & (total > 0) & (o2 > 0) & (n2 > 0) & (alt > 0)
    if not np.all(valid):
        raise ValueError("Three-part closure requires finite, strictly positive gas parts")
    closed_o2, closed_n2, closed_alt = o2 / total, n2 / total, alt / total
    b_oxygen = np.sqrt(2.0 / 3.0) * np.log(closed_o2 / np.sqrt(closed_n2 * closed_alt))
    b_alternative = np.log(closed_alt / closed_n2) / np.sqrt(2.0)
    return pd.DataFrame(
        {
            "raw_three_part_sum": total,
            "closed_oxygen": closed_o2,
            "closed_nitrogen": closed_n2,
            "closed_alternative": closed_alt,
            "b_oxygen": b_oxygen,
            "b_alternative": b_alternative,
        }
    )


def add_diluent_balances(frame: pd.DataFrame, diluent: str) -> pd.DataFrame:
    """Select one protocol subset and attach its within-row closed balances."""
    if diluent not in GAS_COLUMNS:
        raise ValueError("diluent must be 'CO2' or 'He'")
    required = set(GAS_COLUMNS["CO2"]) | set(GAS_COLUMNS["He"])
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Missing FLEX gas columns: {sorted(missing)}")
    if diluent == "CO2":
        mask = (frame.helium_fraction == 0) & (frame.carbon_dioxide_fraction > 0)
    else:
        mask = (frame.carbon_dioxide_fraction == 0) & (frame.helium_fraction > 0)
    out = frame.loc[mask].copy()
    oxygen, nitrogen, alternative = GAS_COLUMNS[diluent]
    balances = close_and_balance_three_parts(
        out[oxygen], out[nitrogen], out[alternative], oxygen_is_percent=True
    )
    balances.index = out.index
    out["diluent"] = diluent
    out["alternative_fraction_raw"] = out[alternative]
    return pd.concat([out, balances], axis=1)
