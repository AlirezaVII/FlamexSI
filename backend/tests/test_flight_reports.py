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
