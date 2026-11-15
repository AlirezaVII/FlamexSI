"""LLM providers. Gemini is the default; `mock` needs no key (tests, CI, offline)."""

import json
import logging
from abc import ABC, abstractmethod

from falmex.settings import Settings

log = logging.getLogger(__name__)


class LLMError(RuntimeError):
    pass


class LLMProvider(ABC):
    name: str = "base"
    model: str = ""

    @abstractmethod
    def generate_json(self, system: str, prompt: str) -> dict:
        """Return the model's answer parsed as a JSON object."""


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str):
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self.model = model

    def generate_json(self, system: str, prompt: str) -> dict:
        from google.genai import types

        try:
            response = self._client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    temperature=0.2,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                ),
            )
            return json.loads(response.text)
        except Exception as exc:  # network, quota, bad JSON ...
            raise LLMError(f"Gemini request failed: {exc}") from exc


class MockProvider(LLMProvider):
    """Deterministic, template-based answers built only from the facts given."""

    name = "mock"
    model = "template"

    def generate_json(self, system: str, prompt: str) -> dict:
        facts = json.loads(prompt.split("FACTS:", 1)[1])
        if "findings" in facts:
            top = facts["findings"][:3]
            return {
                "summary": f"{len(facts['findings'])} relationships ranked; top: "
                + "; ".join(f["headline"] for f in top),
                "caveats": ["Template summary (mock provider), not AI-generated."],
            }
        return {
            "summary": f"In this data: {facts['headline']} (status: {facts['status']}).",
            "interpretation": (
                f"Measured with {facts['effect_metric']} = {facts['effect_size']} over "
                f"{facts['evidence']['n_experiments']} experiments."
            ),
            "safety_relevance": "Open question for expert review before any fire-safety use.",
            "caveats": ["Template interpretation (mock provider), not AI-generated."],
        }


def get_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "gemini":
        if settings.gemini_api_key:
            return GeminiProvider(settings.gemini_api_key, settings.gemini_model)
        log.warning("FALMEX_LLM_PROVIDER=gemini but GEMINI_API_KEY is missing; using mock.")
    return MockProvider()
