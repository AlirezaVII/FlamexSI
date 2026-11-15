"""Descriptive D²(t) fitting utilities for reviewed droplet histories.

A fitted slope is not automatically a burning-rate measurement. The caller must
separate pre-extinction combustion from post-extinction vaporization and record
whether the input is raw, analyzed, or digitized from a publication.
"""

from __future__ import annotations

import numpy as np


def normalized_time_window(
    time_s: object,
    start_fraction: float,
    end_fraction: float,
    *,
    origin_s: float = 0.0,
    duration_s: float | None = None,
) -> np.ndarray:
    """Return a finite-time mask for a fixed fraction of a physical time window."""
    time = np.asarray(time_s, dtype=float)
    if not 0.0 <= start_fraction < end_fraction <= 1.0:
        raise ValueError("Window fractions must satisfy 0 <= start < end <= 1")
    if duration_s is None:
        finite = time[np.isfinite(time)]
        if not len(finite):
            raise ValueError("At least one finite time is required")
        duration_s = float(np.max(finite) - origin_s)
    if duration_s <= 0:
        raise ValueError("Window duration must be positive")
    lower = origin_s + start_fraction * duration_s
    upper = origin_s + end_fraction * duration_s
    return np.isfinite(time) & (time >= lower) & (time <= upper)


def linear_d2_fit(time_s: object, d2_mm2: object) -> dict[str, float | int]:
    """Fit D² = intercept + slope*t by OLS; K = -slope for pre-extinction data.

    Standard errors and p-values are intentionally omitted: digitized points are
    downsampled and serially structured, so naive OLS inference would overstate
    the independent information content.
    """
    time = np.asarray(time_s, dtype=float)
    d2 = np.asarray(d2_mm2, dtype=float)
    if time.shape != d2.shape or time.ndim != 1:
        raise ValueError("time_s and d2_mm2 must be one-dimensional arrays of equal length")
    valid = np.isfinite(time) & np.isfinite(d2)
    time, d2 = time[valid], d2[valid]
    if len(time) < 3:
        raise ValueError("At least three finite points are required")
    if np.ptp(time) <= 0:
        raise ValueError("Fit times must span a non-zero interval")

    slope, intercept = np.polyfit(time, d2, 1)
    predicted = intercept + slope * time
    residual = d2 - predicted
    centered = d2 - np.mean(d2)
    ss_res = float(np.sum(residual**2))
    ss_tot = float(np.sum(centered**2))
    return {
        "n": int(len(time)),
        "time_min_s": float(np.min(time)),
        "time_max_s": float(np.max(time)),
        "slope_mm2_s": float(slope),
        "intercept_mm2": float(intercept),
        "burning_rate_constant_mm2_s": float(-slope),
        "rmse_mm2": float(np.sqrt(np.mean(residual**2))),
        "r_squared": float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float("nan"),
    }
