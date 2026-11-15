"""Steps after a finding: prior knowledge (step 8), insight (9-10) and innovation (part 2)."""

import io

from falmex import synthetic


def _validated_finding(client, *, real: bool) -> dict:
    """A validated finding. `real=True` uploads generated rows as a non-synthetic file:
    only a stand-in for NASA data inside tests, to reach the steps synthetic data may not."""
    if real:
        buf = io.BytesIO()
        synthetic.generate(300, seed=3).to_csv(buf, index=False)
        res = client.post("/api/datasets",
                          files={"file": ("lab.csv", buf.getvalue(), "text/csv")})
    else:
        res = client.post("/api/datasets/synthetic", json={"n_experiments": 300, "seed": 3})
    did = res.json()["dataset"]["dataset_id"]
    found = client.post(f"/api/datasets/{did}/discover", json={}).json()["findings"]
    return next(f for f in found if f["status"] == "validated")


PK = {"novelty": "partly_known", "summary": "Trend known; this range is new.",
      "reviewer": "QA",
      "references": [{"title": "NASA flammability report", "kind": "nasa_primary"}]}

INSIGHT = {"statement": "x" * 12, "scientific_interpretation": "y" * 12,
           "fire_safety_relevance": "z" * 6, "reviewer": "QA",
           "limitations": "Only one material.", "safety_areas": ["risk_assessment"]}


def test_search_plan_gives_nasa_links_first_and_no_references(client):
    f = _validated_finding(client, real=False)
    plan = client.post(f"/api/findings/{f['finding_id']}/prior-knowledge/search").json()
    assert plan["queries"] and plan["nasa_psi"].startswith("https://psi.nasa.gov")
    first = plan["queries"][0]
    assert first["links"][0]["url"].startswith("https://ntrs.nasa.gov/search?q=")
    assert "references" not in plan  # the AI never supplies sources


def test_prior_knowledge_rules(client):
    synth = _validated_finding(client, real=False)
    url = f"/api/findings/{synth['finding_id']}/prior-knowledge"
    assert client.put(url, json=PK).status_code == 409

    real = _validated_finding(client, real=True)
    res = client.put(f"/api/findings/{real['finding_id']}/prior-knowledge", json=PK)
    assert res.status_code == 200
    pk = client.get(f"/api/findings/{real['finding_id']}").json()["prior_knowledge"]
    assert pk["novelty"] == "partly_known" and pk["references"][0]["kind"] == "nasa_primary"
    bad = {**PK, "novelty": "groundbreaking"}
    assert client.put(f"/api/findings/{real['finding_id']}/prior-knowledge",
                      json=bad).status_code == 422


def test_insight_fields_and_related_findings(client):
    real = _validated_finding(client, real=True)
    synth = _validated_finding(client, real=False)
    url = f"/api/findings/{real['finding_id']}/insight"
    assert client.post(url, json={**INSIGHT, "related_finding_ids": [synth["finding_id"]]}
                       ).status_code == 409
    assert client.post(url, json={**INSIGHT, "related_finding_ids": ["nope"]}
                       ).status_code == 422
    ins = client.post(url, json=INSIGHT).json()
    assert ins["safety_areas"] == ["risk_assessment"] and ins["limitations"]


def test_innovation_comes_from_an_insight_and_the_team_decides(client):
    real = _validated_finding(client, real=True)
    ins = client.post(f"/api/findings/{real['finding_id']}/insight", json=INSIGHT).json()

    sugg = client.post(f"/api/insights/{ins['insight_id']}/innovation-suggestions").json()
    assert sugg["suggestions"] and client.get("/api/innovations").json() == []  # not saved

    body = {"title": "Risk index", "kind": "indicator", "enables": "Rank cabin materials.",
            "insight_ids": [ins["insight_id"]], "proposed_by": "QA"}
    assert client.post("/api/innovations", json={**body, "insight_ids": []}
                       ).status_code == 422
    assert client.post("/api/innovations", json={**body, "insight_ids": ["nope"]}
                       ).status_code == 404
    created = client.post("/api/innovations", json=body).json()
    assert created["stage"] == "idea"

    upd = client.patch(f"/api/innovations/{created['innovation_id']}",
                       json={"stage": "prototype", "decision_note": "Worth a demo."}).json()
    assert upd["stage"] == "prototype" and upd["title"] == "Risk index"
    assert [i["stage"] for i in client.get("/api/innovations").json()] == ["prototype"]
    assert client.patch("/api/innovations/nope", json={"stage": "demo"}).status_code == 404
