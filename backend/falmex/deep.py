"""Deep analysis: what else is worth asking about a finding?

A finding says "x and y are associated in this data". Deep analysis asks the next
questions: could a third variable explain it? does it hold within every group? across the
whole range? in independent source files?

Nothing here is a fixed question list. Each probe is a *category* of investigation that
looks at the finding (its analyzer, variables) and at the columns that actually exist in
the dataset, and generates the concrete questions that make sense for that pair of
finding + data. New categories plug in with @register_probe. Which suggested questions are
worth running stays a human choice; the engine only proposes and computes.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import pandas as pd
from scipy import stats

from falmex.analysis import get_analyzers
from falmex.analysis.base import Analyzer
from falmex.findings import Finding, ProbeResult
from falmex.pipeline import SOURCE_COL
from falmex.schema import Role, Schema, VarType


@dataclass
class ProbeSpec:
    """A concrete question a probe can answer for one finding."""

    probe: str
    category: str
    question: str
    params: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.probe}:{'|'.join(f'{k}={v}' for k, v in sorted(self.params.items()))}"


class Probe(ABC):
    name = "base"
    category = ""
    description = ""

    @abstractmethod
    def suggest(self, finding: Finding, frame: pd.DataFrame, schema: Schema) -> list[ProbeSpec]:
        """Questions this probe can answer for this finding on this data (may be empty)."""

    @abstractmethod
    def run(
        self, finding: Finding, frame: pd.DataFrame, schema: Schema, analyzer: Analyzer,
        params: dict,
    ) -> ProbeResult: ...

    def result(self, spec_question: str, params: dict, verdict: str, summary: str,
               metrics: dict | None = None, rows: list[dict] | None = None) -> ProbeResult:
        return ProbeResult(
            probe=self.name, category=self.category, question=spec_question, params=params,
            verdict=verdict, summary=summary, metrics=metrics or {}, rows=rows or [],
            ran_at=datetime.now(UTC),
        )


_REGISTRY: dict[str, Probe] = {}


def register_probe(cls: type[Probe]) -> type[Probe]:
    _REGISTRY[cls.name] = cls()
    return cls


def available_probes() -> list[dict]:
    return [{"name": p.name, "category": p.category, "description": p.description}
            for p in _REGISTRY.values()]


def _label(name: str) -> str:
    return name.replace("_", " ")


def _analyzer_for(finding: Finding, min_samples: int) -> Analyzer:
    return get_analyzers([finding.analyzer], min_samples=min_samples)[0]


def suggest(finding: Finding, frame: pd.DataFrame, schema: Schema) -> list[ProbeSpec]:
    specs = []
    for probe in _REGISTRY.values():
        specs.extend(probe.suggest(finding, frame, schema))
    return specs


def run_probe(
    finding: Finding, frame: pd.DataFrame, schema: Schema, probe: str, params: dict,
    min_samples: int = 8,
) -> ProbeResult:
    if probe not in _REGISTRY:
        raise ValueError(f"Unknown probe '{probe}'")
    p = _REGISTRY[probe]
    allowed = {s.key for s in p.suggest(finding, frame, schema)}
    spec = ProbeSpec(probe, p.category, "", params)
    if spec.key not in allowed:
        raise ValueError(f"Probe '{probe}' does not apply to this finding with {params}")
    return p.run(finding, frame, schema, _analyzer_for(finding, min_samples), params)


def _conditions(schema: Schema, frame: pd.DataFrame, kind: VarType, exclude: set[str]) -> list[str]:
    return [v.name for v in schema.by_role(Role.CONDITION)
            if v.type == kind and v.name in frame and v.name not in exclude
            and frame[v.name].notna().sum() > 0]


# ---- probes ----------------------------------------------------------------------------


@register_probe
class ThirdVariable(Probe):
    """Partial rank correlation: does the association survive holding another variable fixed?"""

    name = "third_variable"
    category = "Could another variable explain it?"
    description = ("Controls for each other measured condition with partial rank correlation. "
                   "A large drop means the association may be carried by that variable.")

    def suggest(self, finding, frame, schema):
        if finding.analyzer != "rank_correlation":
            return []
        others = _conditions(schema, frame, VarType.NUMERIC, {finding.condition, finding.outcome})
        return [ProbeSpec(self.name, self.category,
                          f"Could {_label(z)} explain the association between "
                          f"{_label(finding.condition)} and {_label(finding.outcome)}?",
                          {"control": z}) for z in others]

    @staticmethod
    def partial_spearman(data: pd.DataFrame, x: str, y: str, z: str) -> tuple[float, float, int]:
        r = data[[x, y, z]].astype(float).rank()
        rx = r[x] - np.polyval(np.polyfit(r[z], r[x], 1), r[z])
        ry = r[y] - np.polyval(np.polyfit(r[z], r[y], 1), r[z])
        rho, p = stats.pearsonr(rx, ry)
        return float(rho), float(p), len(r)

    def run(self, finding, frame, schema, analyzer, params):
        z = params["control"]
        x, y = finding.condition, finding.outcome
        data = frame[[x, y, z]].dropna()
        question = (f"Could {_label(z)} explain the association between {_label(x)} and "
                    f"{_label(y)}?")
        if len(data) < analyzer.min_samples or data[z].nunique() < 3:
            return self.result(question, params, "inconclusive", "Not enough data to test.")
        raw = analyzer.evaluate(data, x, y)
        partial, p, n = self.partial_spearman(data, x, y, z)
        rz = float(stats.spearmanr(data[x].astype(float), data[z].astype(float))[0])
        base = raw.effect_size if raw else finding.effect_size
        retained = abs(partial) / abs(base) if base else 0.0
        metrics = {"effect_without_control": round(base, 4),
                   "effect_with_control": round(partial, 4),
                   "retained_share": round(retained, 3), "p_value_with_control": p,
                   f"correlation_{x}_{z}": round(rz, 4), "n": n}
        if retained < 0.5:
            return self.result(question, params, "weakens",
                               f"Holding {_label(z)} fixed, the association drops from "
                               f"{base:.2f} to {partial:.2f}: it may be largely explained by "
                               f"{_label(z)}.", metrics)
        return self.result(question, params, "supports",
                           f"Holding {_label(z)} fixed, the association stays at {partial:.2f} "
                           f"(was {base:.2f}): {_label(z)} does not explain it.", metrics)


@register_probe
class SubgroupConsistency(Probe):
    name = "subgroup_consistency"
    category = "Does it hold within groups?"
    description = "Re-runs the same test inside each group of a categorical condition."

    def suggest(self, finding, frame, schema):
        exclude = {finding.condition, finding.outcome}
        groups = _conditions(schema, frame, VarType.CATEGORICAL, exclude)
        return [ProbeSpec(self.name, self.category,
                          f"Does the {_label(finding.condition)}–{_label(finding.outcome)} "
                          f"association hold within each {_label(g)} group?", {"group_by": g})
                for g in groups if 2 <= frame[g].nunique() <= 12]

    def run(self, finding, frame, schema, analyzer, params):
        g = params["group_by"]
        x, y = finding.condition, finding.outcome
        question = (f"Does the {_label(x)}–{_label(y)} association hold within each "
                    f"{_label(g)} group?")
        rows = []
        for level, part in frame.groupby(g):
            ev = analyzer.evaluate(part, x, y)
            rows.append({"group": str(level), "n": int(part[[x, y]].dropna().shape[0]),
                         "effect": None if ev is None else round(ev.effect_size, 4),
                         "p_value": None if ev is None else ev.p_value,
                         "direction": None if ev is None else ev.direction})
        tested = [r for r in rows if r["effect"] is not None]
        if len(tested) < 2:
            return self.result(question, params, "inconclusive",
                               "Too few groups with enough data to compare.", rows=rows)
        same = [r for r in tested if (not analyzer.signed) or r["direction"] == finding.direction]
        sig = [r for r in same if r["p_value"] < 0.05]
        metrics = {"groups_tested": len(tested), "same_direction": len(same),
                   "significant_same_direction": len(sig)}
        if len(same) == len(tested) and len(sig) >= len(tested) / 2:
            return self.result(question, params, "supports",
                               f"Same direction in all {len(tested)} {_label(g)} groups "
                               f"({len(sig)} significant on their own).", metrics, rows)
        return self.result(question, params, "weakens",
                           f"Not consistent across {_label(g)} groups: same direction in "
                           f"{len(same)} of {len(tested)}, significant in {len(sig)}.",
                           metrics, rows)


@register_probe
class RangeDependence(Probe):
    name = "range_dependence"
    category = "Does it hold across the whole range?"
    description = "Splits the condition at its median and re-tests each half."

    def suggest(self, finding, frame, schema):
        if finding.analyzer != "rank_correlation":
            return []
        return [ProbeSpec(self.name, self.category,
                          "Is the association present across the whole "
                          f"{_label(finding.condition)} range, or only in part of it?", {})]

    def run(self, finding, frame, schema, analyzer, params):
        x, y = finding.condition, finding.outcome
        question = (f"Is the association present across the whole {_label(x)} range, or only "
                    f"in part of it?")
        data = frame[[x, y]].dropna()
        cut = float(data[x].median())
        rows = []
        halves = (("lower half", data[data[x] <= cut]), ("upper half", data[data[x] > cut]))
        for name, part in halves:
            ev = analyzer.evaluate(part, x, y)
            rows.append({"range": f"{name} ({_label(x)} {'≤' if name == 'lower half' else '>'} "
                                  f"{cut:.3g})", "n": len(part),
                         "effect": None if ev is None else round(ev.effect_size, 4),
                         "p_value": None if ev is None else ev.p_value})
        tested = [r for r in rows if r["effect"] is not None]
        if len(tested) < 2:
            return self.result(question, params, "inconclusive", "Not enough data in each half.",
                               rows=rows)
        same = all(np.sign(r["effect"]) == np.sign(finding.effect_size) for r in tested)
        sig = [r for r in tested if r["p_value"] < 0.05]
        verdict = "supports" if same and len(sig) == 2 else "weakens"
        summary = ("Present in both halves of the range." if verdict == "supports" else
                   "Mostly carried by one part of the range: " +
                   ", ".join(f"{r['range']}: {r['effect']:.2f}" for r in tested) + ".")
        return self.result(question, params, verdict, summary, {"split_at": cut}, rows)


@register_probe
class SourceReplication(Probe):
    name = "source_replication"
    category = "Does it replicate in independent sources?"
    description = "Re-tests the association separately in each source file of the dataset."

    def suggest(self, finding, frame, schema):
        if SOURCE_COL not in frame or frame[SOURCE_COL].nunique() < 2:
            return []
        return [ProbeSpec(self.name, self.category,
                          f"Does the {_label(finding.condition)}–{_label(finding.outcome)} "
                          f"association replicate in each source file independently?", {})]

    def run(self, finding, frame, schema, analyzer, params):
        x, y = finding.condition, finding.outcome
        question = (f"Does the {_label(x)}–{_label(y)} association replicate in each source "
                    f"file independently?")
        rows = []
        for src, part in frame.groupby(SOURCE_COL):
            ev = analyzer.evaluate(part, x, y)
            rows.append({"source": str(src), "n": len(part),
                         "effect": None if ev is None else round(ev.effect_size, 4),
                         "p_value": None if ev is None else ev.p_value})
        tested = [r for r in rows if r["effect"] is not None]
        ok = [r for r in tested if r["p_value"] < 0.05
              and (not analyzer.signed or np.sign(r["effect"]) == np.sign(finding.effect_size))]
        if len(tested) < 2:
            return self.result(question, params, "inconclusive",
                               "Too few source files with enough data.", rows=rows)
        verdict = "supports" if len(ok) == len(tested) else "weakens"
        return self.result(question, params, verdict,
                           f"Replicated in {len(ok)} of {len(tested)} source files.",
                           {"sources_tested": len(tested), "replicated": len(ok)}, rows)
