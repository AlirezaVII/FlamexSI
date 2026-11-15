"""Chart data for a finding: points labelled by split, and a smoothed trend line.

The trend is a LOWESS curve (locally weighted linear regression, tricube weights) fitted on
the **discovery** points only, with a bootstrap percentile band. The unseen (held-out)
points are drawn against it, so the chart shows the same discipline as the engine: the
curve was never fitted to the data it is compared with.
"""

import numpy as np
import pandas as pd

from falmex.analysis import condition_columns
from falmex.findings import Finding
from falmex.validation import split_by_experiment

GRID = 60
BOOTSTRAP = 120
MAX_POINTS = 5000


def lowess(x: np.ndarray, y: np.ndarray, grid: np.ndarray, frac: float = 0.6) -> np.ndarray:
    """Local linear fit at each grid point, using the nearest `frac` share of points."""
    n = len(x)
    k = max(3, int(np.ceil(frac * n)))
    out = np.full(len(grid), np.nan)
    for i, g in enumerate(grid):
        d = np.abs(x - g)
        h = np.partition(d, k - 1)[k - 1]
        if h <= 0:
            h = d.max() or 1.0
        w = np.clip(1 - (d / h) ** 3, 0, None) ** 3
        if np.count_nonzero(w) < 3:
            continue
        sw = w.sum()
        mx, my = (w * x).sum() / sw, (w * y).sum() / sw
        vx = (w * (x - mx) ** 2).sum()
        slope = (w * (x - mx) * (y - my)).sum() / vx if vx > 0 else 0.0
        out[i] = my + slope * (g - mx)
    return out


def chart_data(finding: Finding, frame: pd.DataFrame, id_col: str | None,
               color_by: str | None, default_test_fraction: float,
               default_seed: int) -> dict:
    cols = condition_columns(finding.condition)
    x = finding.details.get("focus", cols[0])
    y = finding.outcome
    if x not in frame or y not in frame:
        raise ValueError("This finding has no numeric condition to plot")
    if not pd.api.types.is_numeric_dtype(frame[x]) or pd.api.types.is_bool_dtype(frame[x]):
        raise ValueError("A scatter chart needs a numeric condition")
    if color_by == "none":  # explicitly: colour by discovery / unseen only
        color_by = None
    elif color_by is None and len(cols) > 1:
        color_by = finding.details.get("modifier", cols[1])  # interactions: the modifier
    if color_by is not None and color_by not in frame:
        raise ValueError(f"Unknown column '{color_by}'")

    # rebuild exactly the split the discovery run used
    split = finding.split
    by = None if split is None or split.by == "row" else split.by
    test_fraction = (split.test_fraction if split and split.test_fraction is not None
                     else default_test_fraction)
    seed = split.seed if split and split.seed is not None else default_seed
    _, test = split_by_experiment(frame, by, test_fraction, seed)
    holdout = frame.index.isin(test.index)

    keep = [c for c in dict.fromkeys([id_col, x, y, color_by]) if c and c in frame]
    data = frame[keep].assign(_holdout=holdout).dropna(subset=[x, y])
    data = data.head(MAX_POINTS)
    xv = data[x].astype(float).to_numpy()
    yv = data[y].astype(float).to_numpy()
    disc = ~data["_holdout"].to_numpy()

    trend = None
    if disc.sum() >= 10 and np.ptp(xv[disc]) > 0:
        xd, yd = xv[disc], yv[disc]
        grid = np.linspace(xv.min(), xv.max(), GRID)
        fit = lowess(xd, yd, grid)
        rng = np.random.default_rng(seed)
        boots = []
        for _ in range(BOOTSTRAP):
            idx = rng.integers(0, len(xd), len(xd))
            boots.append(lowess(xd[idx], yd[idx], grid))
        low, high = np.nanpercentile(np.array(boots), [2.5, 97.5], axis=0)
        # never draw the curve beyond the discovery data it was fitted to
        inside = (grid >= xd.min()) & (grid <= xd.max())
        trend = {
            "method": "LOWESS (local linear, tricube weights, span 0.6), fitted on discovery "
                      f"points only; 95% bootstrap band ({BOOTSTRAP} resamples)",
            "x": _clean(grid[inside]), "y": _clean(fit[inside]),
            "low": _clean(low[inside]), "high": _clean(high[inside]),
        }

    def value(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return None
        if isinstance(v, (np.bool_, bool)):
            return bool(v)
        if isinstance(v, (np.integer, np.floating)):
            return float(v)
        return v if isinstance(v, (int, float)) else str(v)

    points = [
        {"id": str(r[id_col]) if id_col in data else str(i), "x": float(r[x]),
         "y": value(r[y]), "split": "holdout" if r["_holdout"] else "discovery",
         "color": value(r[color_by]) if color_by else None}
        for i, r in data.iterrows()
    ]
    color_kind = None
    if color_by:
        s = frame[color_by]
        numeric = pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s)
        color_kind = "numeric" if numeric else "categorical"
    return {
        "x": x, "y": y, "color_by": color_by, "color_kind": color_kind,
        "points": points, "trend": trend,
        "discovery_points": int(disc.sum()), "holdout_points": int((~disc).sum()),
        "color_options": [c for c in frame.columns
                          if not c.startswith("_") and c not in (x, y, id_col)],
    }


def _clean(a: np.ndarray) -> list[float | None]:
    return [None if not np.isfinite(v) else round(float(v), 5) for v in a]
