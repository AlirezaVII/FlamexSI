"""Pre-processing for NASA PSI-69 Flame Extinguishment Experiment (FLEX) tables.

The original upload is still stored byte-for-byte. This adapter only makes its
meaning explicit: missing markers, approximate values, invalid pressure and
FLEX-specific derived quantities. It deliberately does not turn Disruption into
either Completion or Extinction.
"""

from typing import Any

import numpy as np
import pandas as pd

FLEX_REQUIRED_COLUMNS = {
    "FLEX Test #",
    "FLEX Identifier",
    "Fuel",
    "Ambient pressure; mmHg",
    "O initial ambient composition; mole fraction",
    "Droplet initial diameter; mm",
    "Visible flame extinction diameter; mm",
    "Burning rate; mm",
    "Burn time; s",
    "Test end",
}
MISSING_MARKERS = {"–", "—", "-"}


def is_flex_table(frame: pd.DataFrame) -> bool:
    return FLEX_REQUIRED_COLUMNS.issubset(frame.columns)


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(frame[column], errors="coerce")


def prepare_flex(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Return an analysis-ready FLEX table and its auditable cleaning decisions."""
    out = frame.copy()
    for column in out.columns:
        series = out[column]
        if not (pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series)):
            continue
        out[column] = out[column].map(
            lambda value: value.strip() if isinstance(value, str) else value
        )
        out[column] = out[column].replace(MISSING_MARKERS, pd.NA)

    # Keep the literal values (~6 and ~9 in PSI-69 v5) as well as a numeric column.
    burn_time_raw = out["Burn time; s"].copy()
    out["Burn time original"] = burn_time_raw
    approximate = burn_time_raw.map(
        lambda value: isinstance(value, str) and value.strip().startswith("~")
    )
    out["Burn time approximate"] = approximate
    out["Burn time; s"] = burn_time_raw.map(
        lambda value: value.strip().lstrip("~").strip() if isinstance(value, str) else value
    )

    # A pressure of zero is not a valid ambient condition for these experiments.
    # Retain the row and original value, flag it, and exclude only the pressure value.
    pressure = _numeric(out, "Ambient pressure; mmHg")
    out["Ambient pressure raw; mmHg"] = pressure
    invalid_pressure = pressure.notna() & (pressure <= 0)
    out["Pressure quality"] = np.select(
        [pressure.isna(), invalid_pressure], ["missing", "invalid_nonpositive"], default="valid"
    )
    out.loc[invalid_pressure, "Ambient pressure; mmHg"] = np.nan

    # This Boolean is defined only where the endpoint semantics are unambiguous.
    # Disruption remains available separately in Test end and is never relabelled.
    endpoint = out["Test end"].astype("string").str.strip().str.lower()
    extinction_vs_completion = pd.Series(pd.NA, index=out.index, dtype="boolean")
    extinction_vs_completion.loc[endpoint == "extinction"] = True
    extinction_vs_completion.loc[endpoint == "completion"] = False
    out["Test-end extinction versus completion"] = extinction_vs_completion

    d0 = _numeric(out, "Droplet initial diameter; mm")
    de = _numeric(out, "Visible flame extinction diameter; mm")
    burning_constant = _numeric(out, "Burning rate; mm")
    burn_time = pd.to_numeric(out["Burn time; s"], errors="coerce")

    valid_ratio = d0.gt(0) & de.ge(0)
    out["Extinction diameter ratio"] = (de / d0).where(valid_ratio)

    # D²(t) = D0² - K t gives an endpoint consistency diagnostic, not an
    # independent burning-rate measurement or a test of causation.
    residual = d0.pow(2) - de.pow(2) - burning_constant * burn_time
    out["D2 law residual; mm2"] = residual
    out["D2 law normalized residual"] = (residual / d0.pow(2)).where(d0.gt(0))

    test_ids = out["FLEX Test #"]
    metadata: dict[str, Any] = {
        "adapter": "nasa_flex_psi69",
        "missing_markers": sorted(MISSING_MARKERS),
        "approximate_burn_time_test_ids": test_ids[approximate].astype(str).tolist(),
        "invalid_pressure_test_ids": test_ids[invalid_pressure].astype(str).tolist(),
        "derived": {
            "extinction_diameter_ratio": "visible_extinction_diameter / initial_droplet_diameter",
            "d2_law_residual_mm2": "D0^2 - De^2 - K * burn_time; endpoint QC only",
            "test_end_extinction_vs_completion": (
                "True=Extinction, False=Completion, missing=Disruption or unknown"
            ),
        },
    }
    return out, metadata
