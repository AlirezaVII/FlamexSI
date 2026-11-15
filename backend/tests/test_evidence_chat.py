import json
from pathlib import Path

from falmex.evidence_chat import ChatRequest, evidence


def test_packaged_replay_matches_display():
    root = Path(__file__).resolve().parents[2]
    display = json.loads((root / "frontend/src/lib/flight/frames.json").read_text())
    for name, a, b, iou, pa, pb in display:
        facts = evidence(ChatRequest(frame=name, question="What did the masks identify?"))
        assert facts["optical"] == dict(frame=name, reference_A_pixels=a, reference_B_pixels=b,
                                        reference_pair_IoU=iou, predicted_A_pixels=pa,
                                        predicted_B_pixels=pb)


def test_local_counts_and_history(client, monkeypatch):
    class Provider:
        name = "gemini"

        def generate_json(self, system, prompt):
            data = json.loads(prompt)
            assert data["EVIDENCE"]["optical"]["predicted_mask_IoU"] == 0.25
            assert data["EVIDENCE"]["FLEX_adjusted_associations"]
            assert data["conversation"][0]["answer"] == "Previous reply"
            return {"answer": "A quarter of the union overlaps.", "sources": ["optical"]}

    monkeypatch.setattr(client.app.state, "provider", Provider())
    body = dict(question="How much overlap?", counts=dict(a=3, b=2, shared=1),
                history=[dict(question="First?", answer="Previous reply")])
    result = client.post("/api/flight-evidence/chat", json=body)
    assert result.status_code == 200
    assert result.json()["sources"][0]["url"] is None
    body["counts"]["shared"] = 4
    assert client.post("/api/flight-evidence/chat", json=body).status_code == 422
