"""Two-way interactions: does the association of one condition with an outcome depend on
the level of another condition (e.g. oxygen × flow velocity on burning rate)?

Model, on standardized variables:  y = b0 + b1·x1 + b2·x2 + b3·x1·x2 + e
The interaction is b3, tested with an ordinary t-test. Both main effects stay in the model,
so b3 measures only what the product adds beyond them. The effect size is the partial
correlation of the product term, t / sqrt(t² + df), in [-1, 1].

The permutation test uses Freedman–Lane: residuals of the main-effects model are shuffled,
so the null hypothesis is "no interaction", not "no association at all".
"""

from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis.base import (
    COMBINE,
    Analyzer,
    Evaluation,
    condition_columns,
    register_analyzer,
)
from falmex.schema import Role, Schema, VarType

MIN_ROWS = 20  # four coefficients need clearly more rows than parameters


def _z(v: np.ndarray) -> np.ndarray:
    return (v - v.mean()) / v.std()


def ols(design: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    """Coefficients, their standard errors and residual degrees of freedom."""
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    df = len(y) - design.shape[1]
    resid = y - design @ coef
    sigma2 = float(resid @ resid) / df
    cov = sigma2 * np.linalg.pinv(design.T @ design)
    return coef, np.sqrt(np.clip(np.diag(cov), 0, None)), df


@register_analyzer
class Interaction(Analyzer):
    name = "interaction"
    description = (
        "Two-way interaction between two numeric conditions on a numeric outcome: linear model "
        "with both main effects and their product (standardized); t-test on the product term. "
        "Validated with a Freedman–Lane permutation test."
    )

    permutation_of = (
        "Freedman–Lane permutations (residuals of the main-effects model shuffled)"
    )

    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        xs = [v.name for v in schema.by_role(Role.CONDITION)
              if v.type == VarType.NUMERIC and v.name in frame]
        ys = [v.name for v in schema.by_role(Role.OUTCOME)
              if v.type == VarType.NUMERIC and v.name in frame]
        return [(f"{a}{COMBINE}{b}", y) for a, b in combinations(xs, 2) for y in ys]

    def _data(self, frame: pd.DataFrame, x: str, y: str) -> tuple[pd.DataFrame, str, str] | None:
        x1, x2 = condition_columns(x)
        data = frame[[x1, x2, y]].dropna()
        if len(data) < max(self.min_samples, MIN_ROWS):
            return None
        if any(np.ptp(data[c].astype(float).to_numpy()) == 0 for c in (x1, x2, y)):
            return None
        return data, x1, x2

    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        prepared = self._data(frame, x, y)
        if prepared is None:
            return None
        data, x1, x2 = prepared
        a = data[x1].astype(float).to_numpy()
        b = data[x2].astype(float).to_numpy()
        yv = data[y].astype(float).to_numpy()
        za, zb, zy = _z(a), _z(b), _z(yv)
        design = np.column_stack([np.ones(len(za)), za, zb, za * zb])
        coef, se, df = ols(design, zy)
        if se[3] == 0 or df < 1:
            return None
        t = coef[3] / se[3]
        p = float(2 * stats.t.sf(abs(t), df))
        effect = float(t / np.sqrt(t * t + df))

        # Describe the interaction in the data's own units: the slope of y on the focus
        # condition at a low and a high level (10th / 90th percentile) of the other one.
        focus, other = (x1, x2) if abs(coef[1]) >= abs(coef[2]) else (x2, x1)
        bf = coef[1] if focus == x1 else coef[2]
        f_raw = a if focus == x1 else b
        o_raw = b if focus == x1 else a
        lo, hi = np.percentile(o_raw, [10, 90])
        z_lo, z_hi = (lo - o_raw.mean()) / o_raw.std(), (hi - o_raw.mean()) / o_raw.std()
        scale = yv.std() / f_raw.std()
        slope_lo, slope_hi = (bf + coef[3] * z_lo) * scale, (bf + coef[3] * z_hi) * scale
        return Evaluation(
            effect_size=effect,
            effect_metric="partial_r_interaction",
            p_value=p,
            n=len(data),
            direction="positive" if t > 0 else "negative",
            details={
                "focus": focus, "modifier": other,
                "modifier_low": round(float(lo), 4), "modifier_high": round(float(hi), 4),
                "slope_at_low": round(float(slope_lo), 4),
                "slope_at_high": round(float(slope_hi), 4),
                "std_coefficients": {"main_" + x1: round(float(coef[1]), 4),
                                     "main_" + x2: round(float(coef[2]), 4),
                                     "interaction": round(float(coef[3]), 4)},
                "x_ranges": {x1: [float(a.min()), float(a.max())],
                             x2: [float(b.min()), float(b.max())]},
                "headline": _headline(focus, other, y, slope_lo, slope_hi),
            },
        )

    def permute(self, data, x, y, rng):
        """Freedman–Lane: shuffle residuals of the main-effects-only model."""
        x1, x2 = condition_columns(x)
        clean = data[[x1, x2, y]].dropna()
        design = np.column_stack([np.ones(len(clean)), clean[x1].astype(float),
                                  clean[x2].astype(float)])
        yv = clean[y].astype(float).to_numpy()
        coef, *_ = np.linalg.lstsq(design, yv, rcond=None)
        fitted = design @ coef
        out = clean.copy()
        out[y] = fitted + rng.permutation(yv - fitted)
        return out


def _headline(focus: str, other: str, y: str, slope_lo: float, slope_hi: float) -> str:
    f, o, yl = (s.replace("_", " ") for s in (focus, other, y))
    if np.sign(slope_lo) != np.sign(slope_hi):
        change = "changes direction"
    elif abs(slope_hi) > abs(slope_lo):
        change = "is stronger"
    else:
        change = "is weaker"
    return f"The {f}–{yl} association {change} at higher {o} (interaction)"
