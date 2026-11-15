"""Flammability map: where does a material burn, as a function of oxygen and gravity (or flow)?

Estimated only from experiments loaded into FlamexSI — no built-in reference numbers. Model:

    logit P(burn) = b0 + b1·oxygen + b2·x [+ b3·pressure]

fitted by maximum likelihood (IRLS, tiny ridge for numerical stability) on rows with a known
outcome, where "burn" means the flame was not extinguished. The boundary drawn is where the
fitted probability is 50%; its uncertainty comes from bootstrap resampling of experiments.
Outside the range of the data the map is an extrapolation and is marked as such.

Published limits (e.g. a maximum oxygen concentration from a NASA report) are entered by
the team with a citation and shown next to the estimate, never mixed into it.
"""

from datetime import datetime

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

OXYGEN, OUTCOME, PRESSURE, MATERIAL = "oxygen", "extinction", "pressure", "material"
AXES = ("gravity", "flow_rate")
MIN_ROWS, MIN_PER_CLASS = 20, 5
GRID = 40
BOOTSTRAP = 200


class ReferenceLimit(BaseModel):
    """A published flammability limit, entered by a person with its source."""

    limit_id: str
    created_at: datetime
    material: str = Field(min_length=1)
    kind: str = Field(default="MOC", min_length=2)  # MOC, LOI, ... as named by the source
    oxygen_percent: float = Field(gt=0, le=100)
    pressure_kpa: float | None = Field(default=None, gt=0)
    gravity_g: float | None = Field(default=None, ge=0)
    flow_cm_s: float | None = Field(default=None, ge=0)
    source: str = Field(min_length=5)  # full citation
    url: str = ""
    note: str = ""
    entered_by: str = Field(min_length=2)


def _logit_fit(X: np.ndarray, y: np.ndarray, ridge: float = 1e-4, iters: int = 50):
    beta = np.zeros(X.shape[1])
    for _ in range(iters):
        eta = np.clip(X @ beta, -30, 30)
        p = 1 / (1 + np.exp(-eta))
        w = p * (1 - p) + 1e-9
        H = X.T @ (X * w[:, None]) + ridge * np.eye(X.shape[1])
        step = np.linalg.solve(H, X.T @ (y - p) - ridge * beta)
        beta += step
        if np.max(np.abs(step)) < 1e-8:
            break
    eta = np.clip(X @ beta, -30, 30)
    p = 1 / (1 + np.exp(-eta))
    w = p * (1 - p) + 1e-9
    cov = np.linalg.pinv(X.T @ (X * w[:, None]))
    return beta, np.sqrt(np.clip(np.diag(cov), 0, None))


class _Model:
    """Logistic model on standardized predictors; predicts on the original scale."""

    def __init__(self, data: pd.DataFrame, cols: list[str], y: np.ndarray):
        self.cols = cols
        raw = data[cols].astype(float).to_numpy()
        self.mu, self.sd = raw.mean(axis=0), raw.std(axis=0)
        self.sd[self.sd == 0] = 1.0
        X = np.column_stack([np.ones(len(raw)), (raw - self.mu) / self.sd])
        self.beta, self.se = _logit_fit(X, y)

    def prob(self, values: np.ndarray) -> np.ndarray:
        z = (values - self.mu) / self.sd
        eta = self.beta[0] + z @ self.beta[1:]
        return 1 / (1 + np.exp(-np.clip(eta, -30, 30)))

    def oxygen_at(self, p: float, others: dict[str, float]) -> float | None:
        """Oxygen where P(burn) = p, holding the other predictors at `others`."""
        i = self.cols.index(OXYGEN)
        b_o = self.beta[1 + i] / self.sd[i]
        if b_o <= 0:
            return None  # burning does not become more likely with oxygen in this data
        logit = np.log(p / (1 - p))
        rest = self.beta[0] - self.beta[1 + i] * self.mu[i] / self.sd[i]
        for j, c in enumerate(self.cols):
            if c != OXYGEN:
                rest += self.beta[1 + j] * (others[c] - self.mu[j]) / self.sd[j]
        return float((logit - rest) / b_o)


def flammability_map(frame: pd.DataFrame, *, axis: str, material: str | None,
                     pressure: float | None, at_x: float | None, at_oxygen: float | None,
                     seed: int = 42) -> dict:
    if axis not in AXES:
        raise ValueError(f"axis must be one of {AXES}")
    missing = [c for c in (OXYGEN, OUTCOME, axis) if c not in frame]
    if missing:
        raise ValueError(f"This dataset has no {', '.join(missing)} column; a flammability map "
                         "needs oxygen, the chosen axis and whether the flame went out.")
    data = frame
    if material:
        if MATERIAL not in frame:
            raise ValueError("This dataset has no material column")
        data = data[data[MATERIAL].astype(str) == material]
    use_p = PRESSURE in data and data[PRESSURE].notna().sum() >= MIN_ROWS \
        and np.ptp(data[PRESSURE].dropna().astype(float)) > 0
    cols = [OXYGEN, axis] + ([PRESSURE] if use_p else [])
    data = data.dropna(subset=[*cols, OUTCOME])
    burned = (~data[OUTCOME].astype(bool)).to_numpy().astype(float)
    n_burn = int(burned.sum())
    if len(data) < MIN_ROWS or min(n_burn, len(data) - n_burn) < MIN_PER_CLASS:
        raise ValueError(
            f"Not enough data: {len(data)} experiments ({n_burn} burned, "
            f"{len(data) - n_burn} went out); need at least {MIN_ROWS} with {MIN_PER_CLASS} "
            "of each outcome."
        )

    model = _Model(data, cols, burned)
    ranges = {c: [float(data[c].min()), float(data[c].max())] for c in cols}
    p_level = float(pressure) if (use_p and pressure is not None) else (
        float(data[PRESSURE].median()) if use_p else None)

    xs = np.linspace(ranges[axis][0], ranges[axis][1], GRID)
    o_lo, o_hi = min(15.0, ranges[OXYGEN][0]), max(40.0, ranges[OXYGEN][1])
    os_ = np.linspace(o_lo, o_hi, GRID)
    gx, go = np.meshgrid(xs, os_)
    pts = {OXYGEN: go.ravel(), axis: gx.ravel()}
    if use_p:
        pts[PRESSURE] = np.full(go.size, p_level)
    probs = model.prob(np.column_stack([pts[c] for c in cols])).reshape(go.shape)
    in_data = (go >= ranges[OXYGEN][0]) & (go <= ranges[OXYGEN][1])

    def others(xv: float) -> dict[str, float]:
        return {axis: xv, **({PRESSURE: p_level} if use_p else {})}

    boundary = [{"x": round(float(xv), 5),
                 "oxygen": None if (o := model.oxygen_at(0.5, others(xv))) is None
                 else round(o, 3)} for xv in xs]

    # bootstrap: the 50% boundary at the chosen point, and P(burn) there
    point = None
    if at_x is not None:
        rng = np.random.default_rng(seed)
        o_star, p_at = [], []
        for _ in range(BOOTSTRAP):
            idx = rng.integers(0, len(data), len(data))
            if burned[idx].min() == burned[idx].max():
                continue
            m = _Model(data.iloc[idx], cols, burned[idx])
            o = m.oxygen_at(0.5, others(at_x))
            if o is not None:
                o_star.append(o)
            if at_oxygen is not None:
                v = {OXYGEN: at_oxygen, **others(at_x)}
                p_at.append(float(m.prob(np.array([[v[c] for c in cols]]))[0]))
        est = model.oxygen_at(0.5, others(at_x))
        v = {OXYGEN: at_oxygen, **others(at_x)} if at_oxygen is not None else None
        point = {
            "x": at_x,
            "oxygen_limit_50": None if est is None else round(est, 3),
            "oxygen_limit_ci": [round(float(np.percentile(o_star, q)), 3) for q in (2.5, 97.5)]
            if len(o_star) >= BOOTSTRAP // 2 else None,
            "oxygen": at_oxygen,
            "p_burn": None if v is None else round(
                float(model.prob(np.array([[v[c] for c in cols]]))[0]), 4),
            "p_burn_ci": [round(float(np.percentile(p_at, q)), 4) for q in (2.5, 97.5)]
            if len(p_at) >= BOOTSTRAP // 2 else None,
            "extrapolation": [c for c, val in (v or others(at_x)).items()
                              if not ranges[c][0] <= val <= ranges[c][1]],
        }

    return {
        "axis": axis, "material": material, "n": len(data), "n_burned": n_burn,
        "predictors": cols, "pressure_used": p_level, "ranges": ranges,
        "coefficients": {c: {"per_sd": round(float(model.beta[1 + j]), 4),
                             "se": round(float(model.se[1 + j]), 4),
                             "z": round(float(model.beta[1 + j] / model.se[1 + j]), 3)
                             if model.se[1 + j] else None}
                         for j, c in enumerate(cols)},
        "grid": {"x": [round(float(v), 5) for v in xs], "oxygen": [round(float(v), 4) for v in os_],
                 "p_burn": np.round(probs, 4).tolist(), "in_data": in_data.tolist()},
        "boundary": boundary,
        "point": point,
        "points": [{"x": float(r[axis]), "oxygen": float(r[OXYGEN]), "burned": bool(b)}
                   for (_, r), b in zip(data.iterrows(), burned, strict=True)][:3000],
        "method": __doc__.strip(),
    }
