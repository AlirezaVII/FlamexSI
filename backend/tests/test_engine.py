from falmex import synthetic
from falmex.engine import DiscoveryConfig, run_discovery
from falmex.findings import Status, rank_score


def _run(frame, schema, **cfg):
    return run_discovery(frame, schema, dataset_id="d1", synthetic=True,
                         config=DiscoveryConfig(**cfg))


def test_engine_recovers_planted_relationships(synthetic_frame, schema):
    findings = _run(synthetic_frame, schema)
    validated = {(f.condition, f.outcome) for f in findings if f.status == Status.VALIDATED}
    assert synthetic.PLANTED <= validated, synthetic.PLANTED - validated


def test_engine_does_not_validate_noise(synthetic_frame, schema):
    findings = _run(synthetic_frame, schema)
    for f in findings:
        if f.condition in synthetic.NOISE_CONDITIONS:
            assert f.status != Status.VALIDATED, f.headline


def test_findings_are_ranked_and_carry_evidence(synthetic_frame, schema):
    findings = _run(synthetic_frame, schema)
    scores = [f.score for f in findings]
    assert scores == sorted(scores, reverse=True)
    top = findings[0]
    assert top.status == Status.VALIDATED
    assert top.synthetic is True
    assert top.evidence.n_experiments > 100
    assert all(e.startswith("SYN-") for e in top.evidence.experiment_ids)
    assert {v.method for v in top.validations} == {"holdout_replication", "permutation_test"}
    assert set(top.score_components) == {"strength", "data", "validation", "stability",
                                         "not_chance", "relevance", "independence"}


def test_outcome_filter(synthetic_frame, schema):
    findings = _run(synthetic_frame, schema, outcomes=["extinction"])
    assert findings and {f.outcome for f in findings} == {"extinction"}


def _score(status, **kw):
    args = {"effect_size": 0.5, "n": 100, "status": status, "test_effect": 0.45,
            "chance_p": 0.01, "relevance": 1.0, **kw}
    return rank_score(**args)[0]


def test_rank_score_orders_by_validation():
    assert _score(Status.VALIDATED) > _score(Status.REJECTED) > _score(Status.NOT_SIGNIFICANT)
    assert _score(Status.NOT_SIGNIFICANT) == 0


def test_rank_score_rewards_stability_and_weights_are_flexible():
    stable = _score(Status.VALIDATED, test_effect=0.5)
    shrunk = _score(Status.VALIDATED, test_effect=0.1)
    assert stable > shrunk
    # a weight of 0 removes a factor entirely
    assert _score(Status.VALIDATED, test_effect=0.1, weights={"stability": 0}) == \
        _score(Status.VALIDATED, test_effect=0.5, weights={"stability": 0})
