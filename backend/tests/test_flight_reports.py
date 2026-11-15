from fastapi.testclient import TestClient

from falmex.ai.providers import MockProvider
from falmex.api import create_app


def test_packaged_report_without_workspace_data(settings):
    class FixtureGemini(MockProvider):
        name = "gemini"

    with TestClient(create_app(settings, provider=FixtureGemini())) as client:
        assert client.get("/api/datasets").json() == []
        response = client.post("/api/flight-evidence/9b3b08af88bf/interpret")
        assert response.status_code == 200
        assert response.json()["interpretation"]["summary"]
        assert client.post("/api/flight-evidence/unknown/interpret").status_code == 404


def test_packaged_report_discloses_offline_provider(client):
    assert client.post("/api/flight-evidence/9b3b08af88bf/interpret").status_code == 503


def test_flight_report_is_cached_and_rate_limited(settings):
    calls = []

    class CountingGemini(MockProvider):
        name = "gemini"

        def generate_json(self, system, prompt):
            calls.append(1)
            return super().generate_json(system, prompt)

    with TestClient(create_app(settings, provider=CountingGemini())) as client:
        first = client.post("/api/flight-evidence/9b3b08af88bf/interpret").json()
        again = client.post("/api/flight-evidence/9b3b08af88bf/interpret").json()
        assert first["cached"] is False and again["cached"] is True
        assert len(calls) == 1  # the second click costs no quota


def test_gemini_rotates_to_the_next_key_on_quota(monkeypatch):
    from falmex.ai import providers

    class Quota(Exception):
        code = 429

    class FakeModels:
        def __init__(self, key):
            self.key = key

        def generate_content(self, **_):
            if self.key == "spent":
                raise Quota("RESOURCE_EXHAUSTED")
            return type("R", (), {"text": '{"ok": "' + self.key + '"}'})()

    class FakeClient:
        def __init__(self, api_key, http_options=None):
            assert http_options is not None and http_options.api_version == "v1beta"
            self.models = FakeModels(api_key)

    import google.genai as genai

    monkeypatch.setattr(genai, "Client", FakeClient)
    gem = providers.GeminiProvider(["spent", "spare", "spent"], "m")
    assert gem.key_count == 2  # duplicates dropped
    assert gem.generate_json("s", "p") == {"ok": "spare"}
    assert gem.generate_json("s", "p") == {"ok": "spare"}  # the spare stays active
