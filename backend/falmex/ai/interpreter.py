"""Grounded interpretation: the AI explains findings, it never creates them.

The model only receives facts the engine computed (statistics, validation,
evidence). It is told to use nothing else and to state uncertainty.
"""

import json
from datetime import UTC, datetime

from falmex.ai.providers import LLMProvider
from falmex.findings import Finding, Interpretation

SYSTEM = """You help NASA combustion researchers understand results from an analysis engine
over microgravity combustion experiments. Rules:
- Use ONLY the facts provided. Never add numbers, experiments or mechanisms that are not there.
- A correlation is not a cause. Say "is associated with", not "causes".
- Respect the status: "validated" = replicated on held-out data; "candidate" = not yet
  confirmed; "rejected" = failed validation (say it is likely a chance pattern);
  "not_significant" = no evidence.
- If "synthetic" is true, say clearly that the data is fake test data.
- Be concise and plain. Researchers must be able to check every sentence against the facts.
Answer as a JSON object."""

FINDING_TASK = """Explain this finding. Return JSON with keys:
"summary" (1 sentence), "interpretation" (2-4 sentences: what the statistics mean and how
strong the evidence is), "safety_insight" (1-2 sentences on possible relevance for spacecraft
fire safety, phrased as a hypothesis to review), "caveats" (list of short strings)."""

SUMMARY_TASK = """Summarize these ranked findings for a researcher in 3-5 sentences.
Return JSON with keys "summary" (string) and "caveats" (list of short strings)."""


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
        caveats.insert(0, "Based on synthetic test data — not a scientific result.")
    return Interpretation(
        summary=str(out.get("summary", "")),
        interpretation=str(out.get("interpretation", "")),
        safety_insight=str(out.get("safety_insight", "")),
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
