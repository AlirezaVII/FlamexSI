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

import pandas as pd

from falmex.schema import Schema


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

    def __init__(self, min_samples: int = 8):
        self.min_samples = min_samples

    @abstractmethod
    def pairs(self, frame: pd.DataFrame, schema: Schema) -> list[tuple[str, str]]:
        """(condition, outcome) column pairs this analyzer can test on `frame`."""

    @abstractmethod
    def evaluate(self, frame: pd.DataFrame, x: str, y: str) -> Evaluation | None:
        """Test one pair. Return None when there is not enough usable data."""


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
