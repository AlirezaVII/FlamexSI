"""Findings and insights.

A **finding** is a statistical association the engine observed in the data, plus everything
needed to trust or reject it: method, statistics, validation on unseen data, uncertainty,
supporting experiments, source files, limitations and checks for third variables. It is
never a causal claim and never, by itself, an insight.

An **insight** is created only by a person: a validated finding from real (non-synthetic)
data that a researcher reviewed, interpreted scientifically and judged meaningful.

    data -> statistical analysis -> finding -> validation -> evidence -> AI explanation
         -> (deep analysis) -> prior-knowledge check -> expert review -> insight
         -> innovation (see innovation.py)
"""

import math
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, computed_field


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
    by: str  # what the split keeps together (e.g. "experiment_id", "_source_id", a campaign)
    groups_discovery: int | None = None
    groups_holdout: int | None = None
    # values found on both sides after splitting; all zero = no leakage between the parts
    shared_across_split: dict[str, int] = {}
    # enough to rebuild exactly the same split (e.g. to show which points were unseen)
    test_fraction: float | None = None
    seed: int | None = None


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


class Novelty(StrEnum):
    """How a finding relates to what NASA and other researchers already know."""

    UNREVIEWED = "unreviewed"
    KNOWN = "known"  # already described in NASA reports or the literature
    PARTLY_KNOWN = "partly_known"  # part of it is known, part is not
    NEW_CONDITIONS = "new_conditions"  # known relationship, new conditions or combination
    POSSIBLY_NEW = "possibly_new"  # no prior description found; needs expert confirmation


class Reference(BaseModel):
    title: str = Field(min_length=3)
    url: str = Field("", pattern=r"^(https?://\S+)?$")  # only web links; never javascript:
    # NASA's own sources and the challenge material come first; papers only when needed
    kind: Literal["nasa_primary", "challenge", "paper", "other"] = "nasa_primary"
    note: str = ""  # what this source says about the finding


class PriorKnowledge(BaseModel):
    """Step 8: a person's check of whether the finding was already known. Only for
    findings worth it, not for every finding."""

    novelty: Novelty
    summary: str = Field(min_length=5)  # how the finding relates to prior work
    references: list[Reference] = []
    reviewer: str = Field(min_length=2)
    reviewed_at: datetime


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
    prior_knowledge: PriorKnowledge | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def readiness(self) -> dict:
        """Evidence readiness level (0-7): how far this finding has been proven."""
        return evidence_readiness(self)


class SafetyArea(StrEnum):
    """Where an insight could help spacecraft fire safety."""

    FIRE_BEHAVIOR = "fire_behavior"  # understanding how fire behaves
    RISK_ASSESSMENT = "risk_assessment"
    EXPERIMENT_DESIGN = "experiment_design"
    SAFETY_DECISIONS = "safety_decisions"
    COMBUSTION_MANAGEMENT = "combustion_management"


class Insight(BaseModel):
    """A finding a researcher reviewed and promoted. Never created automatically.

    A finding is a statistical result; an insight is the deeper understanding built from
    findings, data analysis and scientific interpretation."""

    insight_id: str
    finding_id: str
    dataset_id: str
    created_at: datetime
    statement: str
    scientific_interpretation: str
    fire_safety_relevance: str
    reviewer: str
    references: list[str] = []
    limitations: str = ""  # what the interpretation does not show
    safety_areas: list[SafetyArea] = []
    related_finding_ids: list[str] = []  # other findings this insight also rests on
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


READINESS_LEVELS = [
    (0, "No supported relationship"),
    (1, "Signal in the discovery data"),
    (2, "Not chance: random shuffles are weaker"),
    (3, "Replicated on unseen experiments"),
    (4, "Survives the third-variable checks"),
    (5, "Uncertainty bounded: stable bootstrap interval"),
    (6, "Compared with published knowledge"),
    (7, "Signed off by a domain expert"),
]
READINESS_NEXT = {
    0: "Collect data where this condition varies more, or drop the question.",
    1: "Test against random shuffles of the data.",
    2: "Re-test on experiments the engine has not seen.",
    3: "Run the third-variable checks (Deep analysis on the finding page).",
    4: "Needs a tighter, stable bootstrap interval: more experiments.",
    5: "Record what NASA reports and papers say (prior-knowledge check).",
    6: "A combustion expert reviews and signs off. FlamexSI cannot do this step itself.",
    7: "Independent replication in another investigation or flight.",
}


def evidence_readiness(f: "Finding") -> dict:
    """Cumulative: each level needs all the levels below it. Level 7 is never automatic."""
    val = {v.method: v.passed for v in f.validations}
    tv = [p for p in f.deep if p.probe == "third_variable" and p.verdict != "not_run"]
    u = f.uncertainty
    directional = f.direction in ("positive", "negative", "increase", "decrease")
    steps = [
        f.status in (Status.VALIDATED, Status.CANDIDATE, Status.REJECTED),
        val.get("permutation_test") is True,
        val.get("holdout_replication") is True and f.status == Status.VALIDATED,
        bool(tv) and all(p.verdict != "weakens" for p in tv),
        u is not None and u.stable_share >= 0.9
        and (not directional or u.low > 0 or u.high < 0),
        f.prior_knowledge is not None,
    ]
    level = 0
    for ok in steps:
        if not ok:
            break
        level += 1
    return {"level": level, "of": 7, "label": READINESS_LEVELS[level][1],
            "next": READINESS_NEXT[level]}
