"""LLM providers. Gemini is the default; `mock` needs no key (tests, CI, offline)."""

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Iterator

from falmex.settings import Settings

log = logging.getLogger(__name__)


class LLMError(RuntimeError):
    pass


class LLMProvider(ABC):
    name: str = "base"
    model: str = ""

    @abstractmethod
    def generate_json(self, system: str, prompt: str, model: str | None = None) -> dict:
        """Return the model's answer parsed as a JSON object (optionally from another,
        e.g. faster, model of the same provider)."""

    def stream_text(self, system: str, prompt: str) -> Iterator[str]:
        """Yield the answer as it is written. Default: one piece, not streamed."""
        out = self.generate_json(system, prompt)
        yield str(out.get("answer", "")) if isinstance(out, dict) else ""


class GeminiProvider(LLMProvider):
    """Gemini with key rotation: when a key runs out of quota (HTTP 429 /
    RESOURCE_EXHAUSTED) the next configured key is tried, and becomes the active one."""

    name = "gemini"

    def __init__(self, api_key: str | list[str], model: str):
        from google import genai
        from google.genai import types

        keys = [api_key] if isinstance(api_key, str) else list(api_key)
        keys = [k for i, k in enumerate(keys) if k and k not in keys[:i]]
        if not keys:
            raise ValueError("at least one Gemini API key is required")
        # v1beta explicitly: google-genai 3.x defaults to v1, where the "-latest" model
        # aliases this app uses (gemini-flash-latest, gemini-flash-lite-latest) do not exist
        http = types.HttpOptions(api_version="v1beta")
        self._clients = [genai.Client(api_key=k, http_options=http) for k in keys]
        self._active = 0
        self.model = model

    @property
    def key_count(self) -> int:
        return len(self._clients)

    @staticmethod
    def _is_quota(exc: Exception) -> bool:
        text = str(exc).lower()
        code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        return code == 429 or "resource_exhausted" in text or "quota" in text or "429" in text

    def generate_json(self, system: str, prompt: str, model: str | None = None) -> dict:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        last: Exception | None = None
        for step in range(len(self._clients)):
            index = (self._active + step) % len(self._clients)
            try:
                response = self._clients[index].models.generate_content(
                    model=model or self.model, contents=prompt, config=config
                )
                self._active = index
                return json.loads(response.text)
            except Exception as exc:  # network, quota, bad JSON ...
                last = exc
                if not self._is_quota(exc):
                    break
                log.warning("Gemini key %d of %d hit its quota; trying the next key.",
                            index + 1, len(self._clients))
        raise LLMError(f"Gemini request failed: {last}") from last

    def stream_text(self, system: str, prompt: str) -> Iterator[str]:
        """Stream plain text. A key that is out of quota before the first piece arrives is
        skipped; a failure after text has started is raised (nothing is silently retried)."""
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system, temperature=0.25,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        last: Exception | None = None
        for step in range(len(self._clients)):
            index = (self._active + step) % len(self._clients)
            started = False
            try:
                for chunk in self._clients[index].models.generate_content_stream(
                    model=self.model, contents=prompt, config=config
                ):
                    text = getattr(chunk, "text", None)
                    if text:
                        started = True
                        yield text
                self._active = index
                return
            except Exception as exc:
                if started:
                    raise LLMError(f"Gemini stopped mid-answer: {exc}") from exc
                last = exc
                if not self._is_quota(exc):
                    break
        raise LLMError(f"Gemini request failed: {last}") from last


class MockProvider(LLMProvider):
    """Deterministic, template-based answers built only from the facts given."""

    name = "mock"
    model = "template"

    def stream_text(self, system: str, prompt: str) -> Iterator[str]:
        """Template answer that cites the first evidence card (tests, offline)."""
        yield from ["Template answer (mock provider) ", "built only from the evidence ",
                    "cards [S1]."]

    def generate_json(self, system: str, prompt: str, model: str | None = None) -> dict:
        facts = json.loads(prompt.split("FACTS:", 1)[1])
        if facts.get("task") == "search":
            base = f"{facts['condition']} {facts['outcome']}".replace("_", " ")
            return {"queries": [f"{base} microgravity flame",
                                f"{base} microgravity combustion experiment",
                                f"{base} spacecraft fire safety"]}
        if facts.get("task") == "innovation":
            return {"suggestions": [{
                "title": "Template suggestion (mock provider)",
                "kind": "other",
                "enables": "A placeholder direction; set GEMINI_API_KEY for real suggestions.",
                "rationale": f"Based on: {facts['statement']}",
            }]}
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
    if settings.llm_provider in {"auto", "gemini"}:
        keys = [settings.gemini_api_key or ""] + [
            k.strip() for k in (settings.gemini_fallback_keys or "").split(",")
        ]
        keys = [k for k in keys if k]
        if keys:
            return GeminiProvider(keys, settings.gemini_model)
        if settings.llm_provider == "gemini":
            log.warning("FALMEX_LLM_PROVIDER=gemini but GEMINI_API_KEY is missing; using mock.")
    return MockProvider()
