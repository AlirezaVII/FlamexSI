"""Findings and insights.

A **finding** is a statistical association the engine observed in the data, plus everything
needed to trust or reject it: method, statistics, validation on unseen data, uncertainty,
supporting experiments, source files, limitations and checks for third variables. It is
never a causal claim and never, by itself, an insight.

An **insight** is created only by a person: a validated finding from real (non-synthetic)
data that a researcher reviewed, interpreted scientifically and judged meaningful.

    data -> statistical analysis -> finding -> validation -> evidence -> AI explanation
         -> (deep analysis) -> expert review -> insight
"""

import math
from datetime import datetime
from enum import StrEnum

from pydantic import AliasChoices, BaseModel, Field


class Status(StrEnum):
    VALIDATED = "validated"  # significant in discovery data AND confirmed on unseen data
    CANDIDATE = "candidate"  # significant in discovery data, validation inconclusive
    REJECTED = "rejected"  # an initial signal that failed validation (likely chance)
    NOT_SIGNIFICANT = "not_significant"  # no supported relationship found by this analysis


STATUS_EXPLANATION = {
    Status.VALIDATED: "Observed in the discovery data and confirmed on experiments the engine "
    "never saw, and stronger than random shuffles.",
    Status.CANDIDATE: "Observed in the discovery data, but validation was inconclusive "
    "(for example too few held-out experiments).",
    Status.REJECTED: "An initial signal was observed, but it did not survive validation on "
    "unseen data or against random shuffles. Likely a chance pattern.",
    Status.NOT_SIGNIFICANT: "No supported relationship was found with this analysis and this "
    "data. This does not show the variable has no effect: the relationship could be "
    "non-monotonic, depend on another variable, or need more data or another method.",
}


class Validation(BaseModel):
    method: str
    passed: bool | None
    message: str
    metrics: dict = {}


class SourceRef(BaseModel):
    source_id: str
    filename: str
    sha256: str


class Evidence(BaseModel):
    n_rows: int
    n_experiments: int
    experiment_ids: list[str]  # capped list, see `truncated`
    truncated: bool = False
    sources: list[SourceRef] = []


class Split(BaseModel):
    """How the data was divided. Discovery never sees the held-out part."""

    discovery_rows: int
    discovery_experiments: int
    holdout_rows: int
    holdout_experiments: int
    by: str  # what the split keeps together (e.g. "experiment_id")


class Uncertainty(BaseModel):
    """Bootstrap interval for the effect size on the discovery data."""

    method: str = "bootstrap"
    level: float = 0.95
    low: float
    high: float
    resamples: int
    # share of resamples that kept the finding: same sign (directional effects) or still
    # significant (group differences)
    stable_share: float


class ProbeResult(BaseModel):
    """One deep-analysis question asked about a finding, and what the data said."""

    probe: str
    category: str
    question: str
    params: dict = {}
    verdict: str  # supports | weakens | inconclusive | not_run
    summary: str
    metrics: dict = {}
    rows: list[dict] = []
    ran_at: datetime | None = None


class Interpretation(BaseModel):
    summary: str
    interpretation: str
    safety_relevance: str = Field(
        validation_alias=AliasChoices("safety_relevance", "safety_insight")
    )
    caveats: list[str] = []
    provider: str
    model: str
    generated_at: datetime


class Finding(BaseModel):
    finding_id: str
    dataset_id: str
    created_at: datetime
    synthetic: bool = Field(description="True when derived from synthetic test data")
    goal: str = "Open exploration"  # the discovery goal / question this run answered
    goal_spec: dict = {}  # columns the goal added to the analysis (to reproduce it)

    condition: str
    outcome: str
    analyzer: str
    method: str
    headline: str

    effect_metric: str
    effect_size: float
    direction: str
    p_value: float
    q_value: float
    n_train: int
    details: dict = {}

    split: Split | None = None
    validations: list[Validation] = []
    uncertainty: Uncertainty | None = None
    status: Status
    status_explanation: str = ""
    score: float = 0.0
    score_components: dict = {}
    score_weights: dict = {}

    evidence: Evidence
    limitations: list[str] = []
    deep: list[ProbeResult] = []  # third-variable checks and other deep-analysis results
    interpretation: Interpretation | None = None


class Insight(BaseModel):
    """A finding a researcher reviewed and promoted. Never created automatically."""

    insight_id: str
    finding_id: str
    dataset_id: str
    created_at: datetime
    statement: str
    scientific_interpretation: str
    fire_safety_relevance: str
    reviewer: str
    references: list[str] = []
    finding_snapshot: dict  # the finding exactly as it was when promoted


# ---- ranking ----------------------------------------------------------------------------
#
# A flexible framework, not a fixed formula: each factor is in [0, 1] and the score is the
# weighted geometric mean, so a weight of 0 removes a factor and a higher weight makes it
# matter more. Defaults are neutral; tune them only once the real data is understood.

DEFAULT_WEIGHTS = {
    "strength": 1.0,  # size of the effect
    "data": 1.0,  # amount of supporting data
    "validation": 1.0,  # validation outcome
    "stability": 1.0,  # does the effect keep its size on unseen data?
    "not_chance": 1.0,  # how unlikely the effect is under random shuffling
    "relevance": 1.0,  # relevance of the outcome to the fire-safety question
    "independence": 1.0,  # does it survive holding other measured variables fixed?
}

STATUS_FACTOR = {
    Status.VALIDATED: 1.0,
    Status.CANDIDATE: 0.5,
    Status.REJECTED: 0.1,
    Status.NOT_SIGNIFICANT: 0.0,
}


def rank_score(
    *,
    effect_size: float,
    n: int,
    status: Status,
    test_effect: float | None,
    chance_p: float | None,
    relevance: float,
    independence: float | None = None,
    weights: dict | None = None,
) -> tuple[float, dict, dict]:
    """Return (score, factors, weights). Every factor is stored so the UI can explain it."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    strength = min(abs(effect_size), 1.0)
    stability = 0.5  # unknown until tested on unseen data
    if test_effect is not None and strength > 0:
        same_sign = math.copysign(1, test_effect) == math.copysign(1, effect_size)
        stability = min(1.0, abs(test_effect) / strength) if same_sign else 0.0
    factors = {
        "strength": strength,
        "data": min(1.0, math.log10(max(n, 1)) / 3.0),  # saturates at ~1000 rows
        "validation": STATUS_FACTOR[status],
        "stability": stability,
        "not_chance": 1.0 - chance_p if chance_p is not None else 0.5,
        "relevance": min(max(relevance, 0.0), 1.0),
        # share of the effect left after controlling for the strongest third variable;
        # 1.0 when there was no other measured variable to check against
        "independence": 1.0 if independence is None else min(max(independence, 0.01), 1.0),
    }
    total = sum(w[k] for k in factors)
    if total == 0 or any(factors[k] == 0 and w[k] > 0 for k in factors):
        score = 0.0
    else:
        score = math.exp(sum(w[k] * math.log(factors[k]) for k in factors if w[k] > 0) / total)
    return round(score, 4), {k: round(v, 4) for k, v in factors.items()}, w
