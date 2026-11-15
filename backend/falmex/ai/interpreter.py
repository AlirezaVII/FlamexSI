"""Grounded interpretation: the AI explains findings, it never creates them.

The model only receives facts the engine computed (statistics, validation,
evidence). It is told to use nothing else and to state uncertainty.
"""

import json
from datetime import UTC, datetime

from falmex.ai.providers import LLMProvider
from falmex.findings import Finding, Interpretation

SYSTEM = """You explain results from a statistical analysis engine over microgravity
combustion experiments to NASA combustion researchers. The engine already did the analysis;
you only explain what it computed. Rules:
- Use ONLY the facts provided. Never add numbers, experiments, variables or sources.
- Describe associations observed in this data ("in these experiments, higher X was associated
  with lower Y"). Never say or imply that one variable causes, controls, drives or affects
  another.
- Do NOT explain physical or chemical mechanisms, and do not cite outside knowledge. A
  scientific explanation is a later, human step.
- Respect the status: "validated" = observed in the discovery data AND confirmed on held-out
  experiments and against random shuffles; "candidate" = not yet confirmed; "rejected" = an
  initial signal that failed validation (likely chance); "not_significant" = no supported
  relationship was found by this analysis, which does NOT show there is no effect.
- Mention how the validation went (discovery vs unseen-data effect, shuffles) and the most
  important limitations or third-variable checks when they are given.
- If "synthetic" is true, say clearly that this is synthetic test data, not NASA data.
- Be concise and plain; every sentence must be checkable against the facts.
Answer as a JSON object."""

FINDING_TASK = """Explain this finding. Return JSON with keys:
"summary" (1 sentence: what association was observed, in non-causal words),
"interpretation" (2-4 sentences: what the statistics and validation results mean and how
strong the evidence is), "safety_relevance" (1 sentence phrased as an open question an expert
could investigate for spacecraft fire safety; no claims, no mechanisms), "caveats" (list of
short strings: limitations, possible third variables, data issues)."""

SUMMARY_TASK = """Summarize these ranked findings for a researcher in 3-5 sentences: which
associations were observed and how well they held up on unseen data. Non-causal wording, no
mechanisms. Return JSON with keys "summary" (string) and "caveats" (list of short strings)."""


def _facts(finding: Finding) -> dict:
    data = finding.model_dump(mode="json", exclude={"interpretation", "method"})
    data["evidence"].pop("experiment_ids", None)
    data["evidence"]["example_experiment_ids"] = finding.evidence.experiment_ids[:10]
    return data


def interpret_finding(finding: Finding, provider: LLMProvider) -> Interpretation:
    prompt = f"{FINDING_TASK}\n\nFACTS:{json.dumps(_facts(finding))}"
    out = provider.generate_json(SYSTEM, prompt)
    caveats = list(out.get("caveats") or [])
    if finding.synthetic and not any("synthetic" in c.lower() or "fake" in c.lower()
                                     for c in caveats):
        caveats.insert(
            0, "Synthetic test data — not NASA laboratory data; not a scientific result."
        )
    return Interpretation(
        summary=str(out.get("summary", "")),
        interpretation=str(out.get("interpretation", "")),
        safety_relevance=str(out.get("safety_relevance") or out.get("safety_insight") or ""),
        caveats=[str(c) for c in caveats],
        provider=provider.name,
        model=provider.model,
        generated_at=datetime.now(UTC),
    )


def summarize_findings(findings: list[Finding], provider: LLMProvider, top_k: int = 10) -> dict:
    top = [
        {k: f.model_dump(mode="json")[k] for k in
         ("headline", "status", "effect_metric", "effect_size", "q_value", "score", "synthetic")}
        for f in findings[:top_k]
    ]
    out = provider.generate_json(SYSTEM, f"{SUMMARY_TASK}\n\nFACTS:{json.dumps({'findings': top})}")
    return {
        "summary": str(out.get("summary", "")),
        "caveats": [str(c) for c in out.get("caveats") or []],
        "provider": provider.name,
        "model": provider.model,
    }
