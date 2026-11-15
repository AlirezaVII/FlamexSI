"""Discovery engine: data -> candidate relationships -> validation -> ranked findings.

    split (by experiment)
      -> every analyzer tests its (condition, outcome) pairs on TRAIN only
      -> false-discovery-rate correction across all tests
      -> significant ones go through every validator (holdout, permutation, ...)
      -> status + evidence + transparent rank score
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pandas as pd

from falmex.analysis import Analyzer, get_analyzers
from falmex.findings import Evidence, Finding, SourceRef, Status, Validation, rank_score
from falmex.pipeline import SOURCE_COL
from falmex.schema import Schema
from falmex.validation import Validator, benjamini_hochberg, get_validators, split_by_experiment

MAX_EVIDENCE_IDS = 200


@dataclass
class DiscoveryConfig:
    analyzers: list[str] | None = None
    validators: list[str] | None = None
    outcomes: list[str] | None = None  # restrict to these outcomes
    test_fraction: float = 0.3
    alpha: float = 0.05
    min_samples: int = 8
    seed: int = 42
    extra: dict = field(default_factory=dict)


def _headline(condition: str, outcome: str, direction: str, details: dict) -> str:
    c, o = condition.replace("_", " "), outcome.replace("_", " ")
    if direction == "positive":
        return f"Higher {c} is associated with higher {o}"
    if direction == "negative":
        return f"Higher {c} is associated with lower {o}"
    if "highest" in details:
        return f"{o.capitalize()} differs by {c} (highest: {details['highest']})"
    return f"{o.capitalize()} differs by {c}"


def _status(significant: bool, validations: list[Validation]) -> Status:
    if not significant:
        return Status.NOT_SIGNIFICANT
    if any(v.passed is False for v in validations):
        return Status.REJECTED
    if validations and all(v.passed is True for v in validations):
        return Status.VALIDATED
    return Status.CANDIDATE


def _evidence(frame: pd.DataFrame, x: str, y: str, id_col: str | None,
              sources: dict[str, SourceRef]) -> Evidence:
    used = frame.dropna(subset=[x, y])
    ids = sorted(map(str, used[id_col].dropna().unique())) if id_col in used else []
    src_ids = used[SOURCE_COL].dropna().unique() if SOURCE_COL in used else []
    return Evidence(
        n_rows=len(used),
        n_experiments=len(ids),
        experiment_ids=ids[:MAX_EVIDENCE_IDS],
        truncated=len(ids) > MAX_EVIDENCE_IDS,
        sources=[sources[s] for s in src_ids if s in sources],
    )


def run_discovery(
    frame: pd.DataFrame,
    schema: Schema,
    *,
    dataset_id: str,
    synthetic: bool,
    sources: dict[str, SourceRef] | None = None,
    config: DiscoveryConfig | None = None,
    analyzers: list[Analyzer] | None = None,
    validators: list[Validator] | None = None,
) -> list[Finding]:
    cfg = config or DiscoveryConfig()
    sources = sources or {}
    analyzers = analyzers or get_analyzers(cfg.analyzers, min_samples=cfg.min_samples)
    validators = validators or get_validators(cfg.validators, alpha=cfg.alpha, seed=cfg.seed)
    id_col = schema.id_column

    train, test = split_by_experiment(frame, id_col, cfg.test_fraction, cfg.seed)

    tested = []
    for analyzer in analyzers:
        for x, y in analyzer.pairs(frame, schema):
            if cfg.outcomes and y not in cfg.outcomes:
                continue
            result = analyzer.evaluate(train, x, y)
            if result is not None:
                tested.append((analyzer, x, y, result))

    q_values = benjamini_hochberg([r.p_value for *_, r in tested])
    now = datetime.now(UTC)
    findings = []
    for (analyzer, x, y, result), q in zip(tested, q_values, strict=True):
        significant = q < cfg.alpha
        validations = []
        if significant:
            validations = [
                Validation(**v.validate(analyzer, result, x, y, train, test).__dict__)
                for v in validators
            ]
        status = _status(significant, validations)
        outcome_var = schema.get(y)
        score, components = rank_score(
            result.effect_size, result.n, status,
            outcome_var.safety_weight if outcome_var else 0.5,
        )
        findings.append(Finding(
            finding_id=uuid.uuid4().hex[:12],
            dataset_id=dataset_id,
            created_at=now,
            synthetic=synthetic,
            condition=x,
            outcome=y,
            analyzer=analyzer.name,
            method=analyzer.description,
            headline=_headline(x, y, result.direction, result.details),
            effect_metric=result.effect_metric,
            effect_size=round(result.effect_size, 4),
            direction=result.direction,
            p_value=result.p_value,
            q_value=q,
            n_train=result.n,
            details=result.details,
            validations=validations,
            status=status,
            score=score,
            score_components=components,
            evidence=_evidence(frame, x, y, id_col, sources),
        ))

    findings.sort(key=lambda f: f.score, reverse=True)
    return findings
