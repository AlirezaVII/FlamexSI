"""The engine must find real signal, reject noise, and expose why it trusts a finding."""

import numpy as np
import pandas as pd
import pytest

from falmex import deep, questions, synthetic
from falmex.engine import DiscoveryConfig, run_discovery
from falmex.findings import Status
from falmex.pipeline import standardize


@pytest.fixture(scope="module")
def frame(schema):
    out, _ = standardize(synthetic.generate(400, seed=2), schema, "synthetic000000")
    return out


def _run(frame, schema, **cfg):
    extra_c = cfg.pop("extra_conditions", [])
    extra_o = cfg.pop("extra_outcomes", [])
    run_schema = schema.extended(frame, extra_o, extra_c)
    return run_discovery(frame, run_schema, dataset_id="d", synthetic=True,
                         config=DiscoveryConfig(**cfg,
                                                extra={"extra_conditions": extra_c,
                                                       "extra_outcomes": extra_o}))


def test_pure_noise_produces_no_validated_findings(schema):
    rng = np.random.default_rng(5)
    n = 300
    noise = pd.DataFrame({
        "experiment_id": [f"N{i}" for i in range(n)],
        "oxygen": rng.uniform(15, 40, n), "pressure": rng.uniform(30, 110, n),
        "temperature": rng.uniform(280, 310, n), "flow_rate": rng.uniform(0, 20, n),
        "burning_rate": rng.normal(1, 0.3, n), "flame_length": rng.normal(5, 1, n),
        "extinction": rng.random(n) < 0.4,
    })
    frame, _ = standardize(noise, schema, "noise0000000000")
    findings = run_discovery(frame, schema, dataset_id="n", synthetic=True)
    assert findings
    assert not [f for f in findings if f.status == Status.VALIDATED]


def test_validation_uses_data_discovery_never_saw(frame, schema):
    f = next(f for f in _run(frame, schema) if f.status == Status.VALIDATED)
    assert f.split.discovery_rows + f.split.holdout_rows == len(frame)
    assert f.split.holdout_experiments > 0
    assert f.n_train <= f.split.discovery_rows  # the effect was measured on discovery only
    holdout = next(v for v in f.validations if v.method == "holdout_replication")
    assert holdout.metrics["test_n"] <= f.split.holdout_rows
    assert {"discovery_effect", "test_effect", "effect_change", "retained_share"} <= set(
        holdout.metrics)
    assert f.uncertainty.low <= f.effect_size <= f.uncertainty.high
    assert f.limitations and "not evidence of cause and effect" in f.limitations[0]


def test_unmapped_columns_join_a_goal_and_noise_is_not_validated(frame, schema):
    findings = _run(frame, schema, extra_conditions=["lab_humidity"])
    humidity = [f for f in findings if f.condition == "lab_humidity"]
    assert humidity, "the extra column was not analysed"
    assert all(f.status != Status.VALIDATED for f in humidity)


def test_third_variable_check_exposes_a_spurious_association(frame, schema):
    findings = _run(frame, schema, outcomes=["burning_rate"],
                    extra_conditions=["sample_mass"])
    spurious = next(f for f in findings if f.condition == "sample_mass")
    real = next(f for f in findings if f.condition == "oxygen")
    # the spurious variable does look associated...
    assert spurious.status in (Status.VALIDATED, Status.CANDIDATE)
    # ...but holding oxygen fixed makes it collapse, and the finding says so
    check = next(p for p in spurious.deep if p.params["control"] == "oxygen")
    assert check.verdict == "weakens"
    assert any("explained by oxygen" in lim for lim in spurious.limitations)
    # while the real association survives controlling for the spurious one
    reverse = next(p for p in real.deep if p.params["control"] == "sample_mass")
    assert reverse.verdict == "supports"
    # and the ranking puts the real association above the spurious one
    assert real.score > spurious.score
    assert spurious.score_components["independence"] < 0.5


def test_deep_analysis_questions_come_from_the_data(frame, schema):
    f = next(f for f in _run(frame, schema) if f.condition == "oxygen"
             and f.outcome == "burning_rate")
    specs = deep.suggest(f, frame, schema)
    probes = {s.probe for s in specs}
    assert {"third_variable", "subgroup_consistency", "range_dependence"} <= probes
    assert any("material" in s.question for s in specs if s.probe == "subgroup_consistency")
    # a dataset without categorical conditions generates no subgroup questions
    no_cat = frame.drop(columns=["material"])
    assert "subgroup_consistency" not in {s.probe for s in deep.suggest(f, no_cat, schema)}
    sub = next(s for s in specs if s.probe == "subgroup_consistency")
    result = deep.run_probe(f, frame, schema, sub.probe, sub.params)
    assert result.verdict == "supports" and len(result.rows) == 3
    with pytest.raises(ValueError):
        deep.run_probe(f, frame, schema, "subgroup_consistency", {"group_by": "nope"})


def test_discovery_goals_follow_the_columns(frame, schema):
    goals = questions.discovery_goals(frame, schema)
    ids = {g["id"] for g in goals}
    assert "open" in ids and "outcome:burning_rate" in ids
    assert "column:lab_humidity" in ids  # unmapped columns are offered too
    assert all("caus" not in g["question"].lower() and "affect" not in g["question"].lower()
               for g in goals)
    fewer = questions.discovery_goals(frame.drop(columns=["extinction"]), schema)
    assert "outcome:extinction" not in {g["id"] for g in fewer}
