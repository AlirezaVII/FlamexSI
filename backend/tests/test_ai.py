import json

import pytest

from falmex.ai import get_provider, interpret_finding, summarize_findings
from falmex.ai.providers import LLMProvider, MockProvider
from falmex.engine import run_discovery
from falmex.settings import Settings


class RecordingProvider(LLMProvider):
    name, model = "recording", "test"

    def __init__(self):
        self.calls = []

    def generate_json(self, system, prompt):
        self.calls.append((system, prompt))
        return {"summary": "s", "interpretation": "i", "safety_insight": "x", "caveats": []}


@pytest.fixture(scope="module")
def findings(synthetic_frame, schema):
    return run_discovery(synthetic_frame, schema, dataset_id="d", synthetic=True)


def test_interpretation_is_grounded_in_computed_facts(findings):
    provider = RecordingProvider()
    result = interpret_finding(findings[0], provider)
    system, prompt = provider.calls[0]
    facts = json.loads(prompt.split("FACTS:", 1)[1])
    assert facts["headline"] == findings[0].headline
    assert facts["status"] == findings[0].status
    assert "Use ONLY the facts provided" in system
    # synthetic data is always flagged, even if the model forgets
    assert any("synthetic" in c.lower() for c in result.caveats)
    assert result.provider == "recording"


def test_mock_provider_interprets_and_summarizes(findings):
    result = interpret_finding(findings[0], MockProvider())
    assert findings[0].headline in result.summary
    summary = summarize_findings(findings, MockProvider())
    assert summary["provider"] == "mock" and summary["summary"]


def test_provider_selection_falls_back_to_mock_without_key():
    assert isinstance(get_provider(Settings(llm_provider="gemini", gemini_api_key=None)),
                      MockProvider)
    assert isinstance(get_provider(Settings(llm_provider="mock")), MockProvider)


def test_gemini_provider_selected_with_key():
    provider = get_provider(Settings(llm_provider="gemini", gemini_api_key="test-key",
                                     gemini_model="gemini-test"))
    assert provider.name == "gemini" and provider.model == "gemini-test"
