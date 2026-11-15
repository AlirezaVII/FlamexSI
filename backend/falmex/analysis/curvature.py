"""Curvature: is the relationship between a condition and an outcome curved rather than a
straight line? Rank correlation only sees monotonic trends, so a rise-then-fall (or a
fall-then-rise) can stay invisible to it.

Model, on the standardized condition:  y = b0 + b1·x + b2·x² + e
The curvature is b2, tested with a t-test; the linear term stays in the model. The effect
size is the partial correlation of x², t / sqrt(t² + df). Validated with a Freedman–Lane
permutation (residuals of the straight-line model are shuffled).

A curve can also come from saturation or from a few extreme points; the chart and its
smoothed trend line are part of the evidence.
"""

import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis.base import Analyzer, Evaluation, register_analyzer
from falmex.analysis.interaction import MIN_ROWS, ols
from falmex.schema import Role, Schema, VarType


@register_analyzer
class Curvature(Analyzer):
    name = "curvature"
    description = (
        "Curved (non-linear) relationship between a numeric condition and a numeric outcome: "
        "quadratic term on top of the straight line, t-test on the quadratic term. Validated "
        "with a Freedman–Lane permutation test."
    )

    permutation_of = (
        "Freedman–Lane permutations (residuals of the straight-line model shuffled)"
    )

    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        xs = [v.name for v in schema.by_role(Role.CONDITION)
              if v.type == VarType.NUMERIC and v.name in frame]
        ys = [v.name for v in schema.by_role(Role.OUTCOME)
              if v.type == VarType.NUMERIC and v.name in frame]
        return [(x, y) for x in xs for y in ys]

    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        data = frame[[x, y]].dropna()
        if len(data) < max(self.min_samples, MIN_ROWS):
            return None
        xv = data[x].astype(float).to_numpy()
        yv = data[y].astype(float).to_numpy()
        # a curve needs enough distinct condition levels to be told apart from noise
        if np.ptp(xv) == 0 or np.ptp(yv) == 0 or len(np.unique(xv)) < 5:
            return None
        z = (xv - xv.mean()) / xv.std()
        zy = (yv - yv.mean()) / yv.std()
        coef, se, df = ols(np.column_stack([np.ones(len(z)), z, z * z]), zy)
        if se[2] == 0 or df < 1:
            return None
        t = coef[2] / se[2]
        p = float(2 * stats.t.sf(abs(t), df))
        bend = "upward" if t > 0 else "downward"
        # where the fitted parabola turns, if it turns inside the observed range
        vertex = None
        if coef[2] != 0:
            v = -coef[1] / (2 * coef[2]) * xv.std() + xv.mean()
            if xv.min() < v < xv.max():
                vertex = round(float(v), 4)
        yl, xl = y.replace("_", " "), x.replace("_", " ")
        return Evaluation(
            effect_size=float(t / np.sqrt(t * t + df)),
            effect_metric="partial_r_quadratic",
            p_value=p,
            n=len(data),
            direction="positive" if t > 0 else "negative",
            details={
                "x_range": [float(xv.min()), float(xv.max())],
                "bend": bend,
                "turning_point": vertex,
                "std_coefficients": {"linear": round(float(coef[1]), 4),
                                     "quadratic": round(float(coef[2]), 4)},
                "headline": f"{yl.capitalize()} follows a curve across {xl} "
                            f"(bends {bend}), not a straight line",
            },
        )

    def permute(self, data, x, y, rng):
        """Freedman–Lane: shuffle residuals of the straight-line model."""
        clean = data[[x, y]].dropna()
        xv = clean[x].astype(float).to_numpy()
        yv = clean[y].astype(float).to_numpy()
        design = np.column_stack([np.ones(len(xv)), xv])
        coef, *_ = np.linalg.lstsq(design, yv, rcond=None)
        fitted = design @ coef
        out = clean.copy()
        out[y] = fitted + rng.permutation(yv - fitted)
        return out
