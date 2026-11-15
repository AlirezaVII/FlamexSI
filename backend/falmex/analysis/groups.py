import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis.base import Analyzer, Evaluation, register_analyzer
from falmex.schema import Role, Schema, VarType


@register_analyzer
class GroupDifference(Analyzer):
    name = "group_difference"
    description = (
        "Compares outcomes across categories of a condition (e.g. material). "
        "Kruskal-Wallis for numeric outcomes, chi-square for yes/no outcomes."
    )
    signed = False

    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        xs = [v.name for v in schema.by_role(Role.CONDITION)
              if v.type == VarType.CATEGORICAL and v.name in frame]
        ys = [v.name for v in schema.by_role(Role.OUTCOME)
              if v.type in (VarType.NUMERIC, VarType.BOOLEAN) and v.name in frame]
        return [(x, y) for x in xs for y in ys]

    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        data = frame[[x, y]].dropna()
        if len(data) < self.min_samples:
            return None
        counts = data[x].value_counts()
        data = data[data[x].isin(counts[counts >= 2].index)]
        if data[x].nunique() < 2:
            return None

        if pd.api.types.is_bool_dtype(data[y]):
            table = pd.crosstab(data[x], data[y].astype(bool))
            if table.shape[1] < 2:
                return None
            chi2, p, _, _ = stats.chi2_contingency(table)
            n = int(table.to_numpy().sum())
            k = min(table.shape) - 1
            effect = float(np.sqrt(chi2 / (n * k))) if k > 0 else 0.0
            rates = data.groupby(x)[y].mean().astype(float)
            return Evaluation(
                effect_size=min(effect, 1.0), effect_metric="cramers_v", p_value=float(p),
                n=n, direction="differs",
                details={"rate_by_group": rates.round(3).to_dict(),
                         "highest": str(rates.idxmax()), "lowest": str(rates.idxmin())},
            )

        groups = [g[y].astype(float).to_numpy() for _, g in data.groupby(x)]
        if all(np.ptp(g) == 0 for g in groups) and len({g[0] for g in groups}) == 1:
            return None
        h, p = stats.kruskal(*groups)
        n, k = len(data), len(groups)
        effect = max(0.0, (h - k + 1) / (n - k)) if n > k else 0.0
        medians = data.groupby(x)[y].median().astype(float)
        return Evaluation(
            effect_size=min(float(effect), 1.0), effect_metric="epsilon_squared",
            p_value=float(p), n=n, direction="differs",
            details={"median_by_group": medians.round(4).to_dict(),
                     "highest": str(medians.idxmax()), "lowest": str(medians.idxmin())},
        )
