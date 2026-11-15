import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis.base import Analyzer, Evaluation, register_analyzer
from falmex.schema import Role, Schema, VarType


@register_analyzer
class RankCorrelation(Analyzer):
    name = "rank_correlation"
    description = (
        "Spearman rank correlation between a numeric condition and a numeric or yes/no "
        "outcome. Detects monotonic relationships without assuming linearity."
    )

    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        xs = [v.name for v in schema.by_role(Role.CONDITION)
              if v.type == VarType.NUMERIC and v.name in frame]
        ys = [v.name for v in schema.by_role(Role.OUTCOME)
              if v.type in (VarType.NUMERIC, VarType.BOOLEAN) and v.name in frame]
        return [(x, y) for x in xs for y in ys]

    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        data = frame[[x, y]].dropna()
        if len(data) < self.min_samples:
            return None
        xv = data[x].astype(float).to_numpy()
        yv = data[y].astype(float).to_numpy()
        if np.ptp(xv) == 0 or np.ptp(yv) == 0:
            return None
        rho, p = stats.spearmanr(xv, yv)
        if not np.isfinite(rho):
            return None
        return Evaluation(
            effect_size=float(rho),
            effect_metric="spearman_rho",
            p_value=float(p),
            n=len(data),
            direction="positive" if rho > 0 else "negative",
            details={"x_range": [float(xv.min()), float(xv.max())]},
        )
