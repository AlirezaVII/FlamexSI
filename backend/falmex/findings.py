"""The Finding: the unit everything in Falmex revolves around.

A finding is a *claim about the data* plus everything needed to trust or
reject it: method, statistics, validation results, supporting experiments,
source files, and (optionally) an AI-written interpretation grounded in those.
"""

import math
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Status(StrEnum):
    VALIDATED = "validated"  # significant on train AND passed every validator
    CANDIDATE = "candidate"  # significant on train, validation inconclusive
    REJECTED = "rejected"  # significant on train, failed validation
    NOT_SIGNIFICANT = "not_significant"  # no evidence of a relationship


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


class Interpretation(BaseModel):
    summary: str
    interpretation: str
    safety_insight: str
    caveats: list[str] = []
    provider: str
    model: str
    generated_at: datetime


class Finding(BaseModel):
    finding_id: str
    dataset_id: str
    created_at: datetime
    synthetic: bool = Field(description="True when derived from fake/test data")

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

    validations: list[Validation] = []
    status: Status
    score: float = 0.0
    score_components: dict = {}

    evidence: Evidence
    interpretation: Interpretation | None = None


STATUS_WEIGHT = {
    Status.VALIDATED: 1.0,
    Status.CANDIDATE: 0.5,
    Status.REJECTED: 0.1,
    Status.NOT_SIGNIFICANT: 0.0,
}


def rank_score(
    effect_size: float, n: int, status: Status, safety_weight: float
) -> tuple[float, dict]:
    """Transparent ranking: every factor is stored so the UI can explain the rank."""
    strength = min(abs(effect_size), 1.0)
    support = min(1.0, math.log10(max(n, 1)) / 3.0)  # saturates at ~1000 rows
    reliability = STATUS_WEIGHT[status]
    components = {
        "strength": round(strength, 4),
        "support": round(support, 4),
        "reliability": reliability,
        "safety_relevance": safety_weight,
    }
    score = strength * support * reliability * safety_weight
    return round(score, 4), components
