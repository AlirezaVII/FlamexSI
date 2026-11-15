"""Analyzer plugin interface.

An analyzer proposes (condition, outcome) pairs it knows how to test and
evaluates one pair on a given slice of data. The engine uses the same
`evaluate` for discovery (train split) and for validation (test split,
permutations), so any new method automatically gets validated too.

The built-in analyzers are deliberately simple, general-purpose defaults.
The real method is chosen after seeing NASA's data: add a new module,
decorate it with @register_analyzer, done.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from falmex.schema import Schema

# A condition can be a combination of columns (e.g. a two-way interaction), named
# "oxygen × flow_rate". Everything that needs the underlying columns goes through
# `condition_columns`, so single-column conditions keep working unchanged.
COMBINE = " × "


def condition_columns(condition: str) -> list[str]:
    return condition.split(COMBINE)


@dataclass
class Evaluation:
    effect_size: float  # normalised to [-1, 1] or [0, 1]
    effect_metric: str
    p_value: float
    n: int
    direction: str  # "positive" | "negative" | "differs"
    details: dict = field(default_factory=dict)


class Analyzer(ABC):
    name: str = "base"
    description: str = ""
    signed: bool = True  # does the effect have a direction that must replicate?
    # what one permutation shuffles, in words (see `permute`)
    permutation_of: str = "random shuffles of the outcome"

    def __init__(self, min_samples: int = 8):
        self.min_samples = min_samples

    @abstractmethod
    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        """(condition, outcome) column pairs this analyzer can test on `frame`."""

    @abstractmethod
    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        """Test one pair. Return None when there is not enough usable data."""

    def permute(self, data: pd.DataFrame, x: str, y: str,
                rng: np.random.Generator) -> pd.DataFrame:
        """One draw under the null hypothesis, for the permutation test.

        Default: shuffle the outcome, which destroys any link between condition and
        outcome. Analyzers testing an effect *beyond* other terms override this.
        """
        out = data.copy()
        out[y] = rng.permutation(out[y].to_numpy())
        return out


_REGISTRY: dict[str, type[Analyzer]] = {}


def register_analyzer(cls: type[Analyzer]) -> type[Analyzer]:
    _REGISTRY[cls.name] = cls
    return cls


def get_analyzers(names: list[str] | None = None, **kwargs) -> list[Analyzer]:
    selected = names or list(_REGISTRY)
    unknown = set(selected) - set(_REGISTRY)
    if unknown:
        raise ValueError(f"Unknown analyzers: {sorted(unknown)}")
    return [_REGISTRY[n](**kwargs) for n in selected]


def available_analyzers() -> list[dict]:
    return [{"name": c.name, "description": c.description} for c in _REGISTRY.values()]
