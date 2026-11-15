import numpy as np
import pandas as pd
import pytest

from falmex.analysis import get_analyzers
from falmex.analysis.correlation import RankCorrelation
from falmex.analysis.groups import GroupDifference
from falmex.validation import (
    HoldoutReplication,
    PermutationTest,
    benjamini_hochberg,
    split_by_experiment,
)


def test_rank_correlation_finds_monotonic_signal():
    x = np.linspace(0, 10, 50)
    frame = pd.DataFrame({"oxygen": x, "burning_rate": x**2})
    ev = RankCorrelation().evaluate(frame, "oxygen", "burning_rate")
    assert ev.effect_size == pytest.approx(1.0)
    assert ev.direction == "positive"


def test_rank_correlation_needs_enough_varied_data():
    a = RankCorrelation(min_samples=8)
    assert a.evaluate(pd.DataFrame({"x": [1, 2], "y": [1, 2]}), "x", "y") is None
    assert a.evaluate(pd.DataFrame({"x": [1] * 20, "y": range(20)}), "x", "y") is None


def test_group_difference_numeric_and_boolean():
    rng = np.random.default_rng(0)
    frame = pd.DataFrame({
        "material": ["A"] * 30 + ["B"] * 30,
        "flame_length": np.r_[rng.normal(2, 0.5, 30), rng.normal(6, 0.5, 30)],
        "extinction": pd.array([True] * 25 + [False] * 5 + [False] * 28 + [True] * 2,
                               dtype="boolean"),
    })
    num = GroupDifference().evaluate(frame, "material", "flame_length")
    assert num.p_value < 1e-6 and num.details["highest"] == "B"
    boo = GroupDifference().evaluate(frame, "material", "extinction")
    assert boo.effect_metric == "cramers_v" and boo.details["highest"] == "A"


def test_analyzer_registry():
    names = {a.name for a in get_analyzers()}
    assert {"rank_correlation", "group_difference"} <= names
    with pytest.raises(ValueError):
        get_analyzers(["nope"])


def test_split_keeps_experiments_together():
    frame = pd.DataFrame({"experiment_id": np.repeat([f"E{i}" for i in range(20)], 3),
                          "v": range(60)})
    train, test = split_by_experiment(frame, "experiment_id", 0.3, seed=1)
    assert set(train.experiment_id).isdisjoint(test.experiment_id)
    assert len(train) + len(test) == 60
    assert test.experiment_id.nunique() == 6


def test_benjamini_hochberg():
    q = benjamini_hochberg([0.01, 0.04, 0.03, 0.5])
    assert q[0] == pytest.approx(0.04)
    assert all(qi >= pi for qi, pi in zip(q, [0.01, 0.04, 0.03, 0.5], strict=True))
    assert benjamini_hochberg([]) == []


def _signal(n, seed, noise=False):
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, 1, n)
    y = rng.normal(0, 1, n) if noise else x + rng.normal(0, 0.1, n)
    return pd.DataFrame({"x": x, "y": y})


def test_validators_accept_real_signal():
    a = RankCorrelation()
    train, test = _signal(100, 1), _signal(40, 2)
    found = a.evaluate(train, "x", "y")
    assert HoldoutReplication().validate(a, found, "x", "y", train, test).passed is True
    assert PermutationTest().validate(a, found, "x", "y", train, test).passed is True


def test_holdout_rejects_non_replicating_effect():
    a = RankCorrelation()
    train = _signal(100, 1)
    test = _signal(40, 2, noise=True)
    found = a.evaluate(train, "x", "y")
    assert HoldoutReplication().validate(a, found, "x", "y", train, test).passed is False


def test_permutation_rejects_noise():
    a = RankCorrelation()
    train = _signal(30, 5, noise=True)
    found = a.evaluate(train, "x", "y")
    res = PermutationTest().validate(a, found, "x", "y", train, train)
    assert res.passed is False


def test_holdout_inconclusive_without_data():
    a = RankCorrelation()
    train = _signal(100, 1)
    found = a.evaluate(train, "x", "y")
    res = HoldoutReplication().validate(a, found, "x", "y", train, train.head(3))
    assert res.passed is None
