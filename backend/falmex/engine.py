"""Discovery engine: data -> statistical analysis -> findings -> validation -> evidence.

    goal (which outcomes / conditions to examine)
      -> split by experiment: discovery part + held-out part the analysis never sees
      -> every analyzer tests its (condition, outcome) pairs on the discovery part only
      -> false-discovery-rate correction across all tests
      -> significant ones: every validator (held-out replication, permutation, ...),
         bootstrap uncertainty, third-variable checks
      -> status + evidence + limitations + transparent rank score

The AI layer never runs here: it only explains findings after they exist.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from falmex import deep
from falmex.analysis import Analyzer, Evaluation, condition_columns, get_analyzers
from falmex.findings import (
    STATUS_EXPLANATION,
    Evidence,
    Finding,
    SourceRef,
    Split,
    Status,
    Uncertainty,
    Validation,
    rank_score,
)
from falmex.pipeline import SOURCE_COL
from falmex.schema import Schema
from falmex.validation import (
    Validator,
    benjamini_hochberg,
    get_validators,
    leakage,
    split_by_experiment,
)

MAX_EVIDENCE_IDS = 200
BOOTSTRAP_RESAMPLES = 200


@dataclass
class DiscoveryConfig:
    analyzers: list[str] | None = None
    validators: list[str] | None = None
    outcomes: list[str] | None = None  # restrict to these outcomes
    conditions: list[str] | None = None  # restrict to these conditions
    goal: str = "Open exploration"
    weights: dict | None = None  # ranking weights, see findings.DEFAULT_WEIGHTS
    split_by: str | None = None  # column kept together when splitting (default: experiment)
    test_fraction: float = 0.3
    alpha: float = 0.05
    min_samples: int = 8
    seed: int = 42
    extra: dict = field(default_factory=dict)


def _headline(condition: str, outcome: str, direction: str, details: dict) -> str:
    """One neutral sentence. Says what was observed, never what causes what."""
    if "headline" in details:  # analyzers with their own wording (interaction, curvature)
        return details["headline"]
    c, o = condition.replace("_", " "), outcome.replace("_", " ")
    if direction == "positive":
        return f"Higher {c} is associated with higher {o}"
    if direction == "negative":
        return f"Higher {c} is associated with lower {o}"
    if "highest" in details:
        return f"{o.capitalize()} differs across {c} groups (highest: {details['highest']})"
    return f"{o.capitalize()} differs across {c} groups"


def _bootstrap(analyzer: Analyzer, found: Evaluation, data: pd.DataFrame, x: str, y: str,
               alpha: float, seed: int) -> Uncertainty | None:
    rng = np.random.default_rng(seed)
    pair = data[[*condition_columns(x), y]].dropna().reset_index(drop=True)
    effects, kept = [], 0
    for _ in range(BOOTSTRAP_RESAMPLES):
        # resampling with replacement repeats row labels; analyzers filter by label, so
        # give every resample a fresh index
        sample = pair.iloc[rng.integers(0, len(pair), len(pair))].reset_index(drop=True)
        ev = analyzer.evaluate(sample, x, y)
        if ev is None:
            continue
        effects.append(ev.effect_size)
        if analyzer.signed:
            kept += np.sign(ev.effect_size) == np.sign(found.effect_size)
        else:
            kept += ev.p_value < alpha
    if len(effects) < BOOTSTRAP_RESAMPLES // 2:
        return None
    low, high = np.percentile(effects, [2.5, 97.5])
    return Uncertainty(low=round(float(low), 4), high=round(float(high), 4),
                       resamples=len(effects), stable_share=round(kept / len(effects), 3))


def _limitations(f: Finding, frame: pd.DataFrame) -> list[str]:
    x, y = f.condition, f.outcome
    out = ["A statistical association in this data, not evidence of cause and effect."]
    if f.synthetic:
        out.append("Synthetic test data — not NASA laboratory data. Not a scientific result.")
    if f.analyzer == "rank_correlation":
        lo, hi = f.details.get("x_range", [None, None])
        if lo is not None:
            out.append(f"Only observed for {x.replace('_', ' ')} between {lo:.3g} and {hi:.3g}; "
                       "behaviour outside this range is unknown.")
        out.append("Rank correlation detects monotonic patterns; a non-monotonic relationship "
                   "(e.g. rising then falling) could be missed or understated.")
    elif f.analyzer == "interaction":
        for col, (lo, hi) in f.details.get("x_ranges", {}).items():
            out.append(f"Only observed for {col.replace('_', ' ')} between {lo:.3g} and "
                       f"{hi:.3g}; behaviour outside this range is unknown.")
        out.append("Tests one form of interplay (a product term in a linear model, with both "
                   "main effects included); other forms could be missed. Correlated conditions "
                   "make an interaction harder to separate from curvature.")
    elif f.analyzer == "curvature":
        lo, hi = f.details.get("x_range", [None, None])
        if lo is not None:
            out.append(f"Only observed for {x.replace('_', ' ')} between {lo:.3g} and {hi:.3g}; "
                       "the curve says nothing about behaviour outside this range.")
        out.append("A quadratic term detects a bend; saturation or a few extreme points can also "
                   "produce one. Check the chart and its smoothed trend line.")
    else:
        out.append("Shows that groups differ overall, not which specific groups differ; groups "
                   "with fewer than 2 experiments were left out.")
    if f.evidence.n_experiments and f.evidence.n_experiments < 30:
        out.append(f"Based on only {f.evidence.n_experiments} experiments.")
    total = len(frame)
    if total and f.evidence.n_rows < 0.8 * total:
        out.append(f"{x.replace('_', ' ')} or {y.replace('_', ' ')} is missing for "
                   f"{100 * (1 - f.evidence.n_rows / total):.0f}% of rows.")
    for probe in f.deep:
        if probe.probe == "third_variable" and probe.verdict == "weakens":
            out.append(f"May be largely explained by {probe.params['control'].replace('_', ' ')} "
                       "(see the third-variable check).")
    if f.status == Status.CANDIDATE:
        out.append("Validation was inconclusive; treat as a lead, not a validated finding.")
    return out


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
    used = frame.dropna(subset=[*condition_columns(x), y])
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

    group_col = cfg.split_by or id_col
    if cfg.split_by and cfg.split_by not in frame:
        raise ValueError(f"Cannot split by unknown column '{cfg.split_by}'")
    train, test = split_by_experiment(frame, group_col, cfg.test_fraction, cfg.seed)
    check = [c for c in dict.fromkeys([id_col, group_col]) if c]
    shared = leakage(train, test, check)
    if any(shared.values()):  # never true for a group split; a guard against future changes
        raise RuntimeError(f"Leakage between discovery and held-out data: {shared}")
    split = Split(
        discovery_rows=len(train), holdout_rows=len(test),
        discovery_experiments=int(train[id_col].nunique()) if id_col in train else len(train),
        holdout_experiments=int(test[id_col].nunique()) if id_col in test else len(test),
        by=group_col if group_col in frame else "row",
        groups_discovery=int(train[group_col].nunique()) if group_col in train else None,
        groups_holdout=int(test[group_col].nunique()) if group_col in test else None,
        shared_across_split=shared,
        test_fraction=cfg.test_fraction,
        seed=cfg.seed,
    )

    tested = []
    for analyzer in analyzers:
        for x, y in analyzer.pairs(frame, schema):
            if cfg.outcomes and y not in cfg.outcomes:
                continue
            if cfg.conditions and not set(condition_columns(x)).issubset(cfg.conditions):
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
        metrics = {k: v for val in validations for k, v in val.metrics.items()}
        outcome_var = schema.get(y)
        score, factors, weights = rank_score(
            effect_size=result.effect_size, n=result.n, status=status,
            test_effect=metrics.get("test_effect"),
            chance_p=metrics.get("permutation_p_value", q if significant else None),
            relevance=outcome_var.relevance if outcome_var else 1.0,
            weights=cfg.weights,
        )
        finding = Finding(
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
            goal=cfg.goal,
            goal_spec=cfg.extra,
            split=split,
            validations=validations,
            uncertainty=(_bootstrap(analyzer, result, train, x, y, cfg.alpha, cfg.seed)
                         if significant else None),
            status=status,
            status_explanation=STATUS_EXPLANATION[status],
            score=score,
            score_components=factors,
            score_weights=weights,
            evidence=_evidence(frame, x, y, id_col, sources),
        )
        if significant:
            # third-variable checks always run: whether another variable explains the
            # association belongs in the evidence, not in an optional extra
            finding.deep = [
                deep.run_probe(finding, frame, schema, spec.probe, spec.params, cfg.min_samples)
                for spec in deep.suggest(finding, frame, schema) if spec.probe == "third_variable"
            ]
            retained = [p.metrics.get("retained_share") for p in finding.deep
                        if p.probe == "third_variable" and p.verdict != "inconclusive"]
            if retained:
                # re-rank: an association carried by another variable should not top the list
                finding.score, finding.score_components, finding.score_weights = rank_score(
                    effect_size=result.effect_size, n=result.n, status=status,
                    test_effect=metrics.get("test_effect"),
                    chance_p=metrics.get("permutation_p_value", q),
                    relevance=outcome_var.relevance if outcome_var else 1.0,
                    independence=min(retained), weights=cfg.weights,
                )
        finding.limitations = _limitations(finding, frame)
        findings.append(finding)

    findings.sort(key=lambda f: f.score, reverse=True)
    return findings
