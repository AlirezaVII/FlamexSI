"""Validation: is a discovered relationship real, or a chance pattern?

Discovery only ever sees the TRAIN split. Validators then check the
relationship against data it has not seen (holdout) and against chance
(permutation). The exact methods will be revisited once we see NASA's data;
new validators plug in via @register_validator.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from falmex.analysis.base import Analyzer, Evaluation


@dataclass
class ValidationResult:
    method: str
    passed: bool | None  # None = inconclusive (e.g. too little data)
    message: str
    metrics: dict = field(default_factory=dict)


def split_by_experiment(
    frame: pd.DataFrame, id_col: str | None, test_fraction: float, seed: int
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Train/test split that never puts rows of one experiment on both sides."""
    rng = np.random.default_rng(seed)
    if id_col and id_col in frame:
        ids = rng.permutation(np.asarray(frame[id_col].dropna().unique(), dtype=object))
        n_test = int(round(len(ids) * test_fraction))
        test_ids = set(ids[:n_test])
        mask = frame[id_col].isin(test_ids)
    else:
        mask = pd.Series(rng.random(len(frame)) < test_fraction, index=frame.index)
    return frame[~mask], frame[mask]


class Validator(ABC):
    name = "base"

    def __init__(self, alpha: float = 0.05, seed: int = 42):
        self.alpha = alpha
        self.seed = seed

    @abstractmethod
    def validate(
        self, analyzer: Analyzer, discovered: Evaluation, x: str, y: str,
        train: pd.DataFrame, test: pd.DataFrame,
    ) -> ValidationResult: ...


_REGISTRY: dict[str, type[Validator]] = {}


def register_validator(cls: type[Validator]) -> type[Validator]:
    _REGISTRY[cls.name] = cls
    return cls


def get_validators(names: list[str] | None = None, **kwargs) -> list[Validator]:
    selected = names or list(_REGISTRY)
    unknown = set(selected) - set(_REGISTRY)
    if unknown:
        raise ValueError(f"Unknown validators: {sorted(unknown)}")
    return [_REGISTRY[n](**kwargs) for n in selected]


def available_validators() -> list[dict]:
    return [{"name": c.name, "description": (c.__doc__ or "").strip()}
            for c in _REGISTRY.values()]


@register_validator
class HoldoutReplication(Validator):
    """Re-run the same test on held-out experiments; the effect must replicate."""

    name = "holdout_replication"

    def validate(self, analyzer, discovered, x, y, train, test) -> ValidationResult:
        result = analyzer.evaluate(test, x, y)
        if result is None:
            return ValidationResult(
                self.name, None, "Not enough held-out data to test this relationship."
            )
        metrics = {"test_effect": result.effect_size, "test_p_value": result.p_value,
                   "test_n": result.n}
        same_direction = (not analyzer.signed) or result.direction == discovered.direction
        if not same_direction:
            return ValidationResult(
                self.name, False, "Effect reverses direction on held-out experiments.", metrics
            )
        if result.p_value < self.alpha:
            return ValidationResult(
                self.name, True, f"Replicates on {result.n} held-out rows.", metrics
            )
        return ValidationResult(
            self.name, False, "Same direction, but not significant on held-out data.", metrics
        )


@register_validator
class PermutationTest(Validator):
    """How often does shuffled (meaningless) data produce an effect this strong?"""

    name = "permutation_test"
    n_permutations = 200

    def validate(self, analyzer, discovered, x, y, train, test) -> ValidationResult:
        rng = np.random.default_rng(self.seed)
        data = train[[x, y]].dropna().reset_index(drop=True)
        observed = abs(discovered.effect_size)
        hits = valid = 0
        for _ in range(self.n_permutations):
            shuffled = data.copy()
            shuffled[y] = rng.permutation(shuffled[y].to_numpy())
            res = analyzer.evaluate(shuffled, x, y)
            if res is None:
                continue
            valid += 1
            hits += abs(res.effect_size) >= observed
        if valid == 0:
            return ValidationResult(self.name, None, "Permutation test could not run.")
        p = (hits + 1) / (valid + 1)
        metrics = {"permutation_p_value": p, "permutations": valid}
        if p < self.alpha:
            return ValidationResult(
                self.name, True, f"Stronger than {valid - hits}/{valid} random shuffles.", metrics
            )
        return ValidationResult(
            self.name, False, "Random shuffles often produce an effect this strong.", metrics
        )


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """False-discovery-rate adjusted p-values (q-values)."""
    n = len(p_values)
    if n == 0:
        return []
    order = np.argsort(p_values)
    ranked = np.array(p_values)[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.minimum(q, 1.0)
    return out.tolist()
