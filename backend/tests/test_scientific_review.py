import json

from falmex.scientific_review import ARTIFACT_ROOT


def _upload_flex(client):
    raw = ARTIFACT_ROOT.parent.parent / "review_seed" / "PSI-69_Experimental table_FLEX.csv"
    response = client.post(
        "/api/datasets",
        files={"file": (raw.name, raw.read_bytes(), "text/csv")},
    )
    assert response.status_code == 201
    return response.json()["dataset"]


def test_review_is_bound_to_real_source_and_reads_analysis_outputs(client):
    dataset = _upload_flex(client)
    response = client.get(f"/api/datasets/{dataset['dataset_id']}/scientific-review")
    assert response.status_code == 200
    review = response.json()
    assert review["source"]["sha256"] == dataset["report"]["ingestion"][0]["sha256"]
    assert review["pipeline"]["rows_out"] == 274
    assert review["scope"]["partial_gravity_claim_allowed"] is False
    assert review["replication"]["replication_executable"] is False
    assert review["time_series"]["raw_images_recovered"] is False
    assert review["time_series"]["data_assimilation_executed"] is False
    assert review["compositional"]["protocol_verified"] is True
    assert review["finding_total"] == 0

    expected = json.loads(
        (ARTIFACT_ROOT / "compositional/compositional_analysis_summary.json").read_text()
    )
    assert review["compositional"]["primary_models"] == expected["primary_models"]
    assert len(review["time_series"]["fits"]) == 17


def test_review_artifacts_are_whitelisted(client):
    dataset = _upload_flex(client)
    base = f"/api/datasets/{dataset['dataset_id']}/scientific-review/artifacts"
    image = client.get(f"{base}/time_series_plot")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content.startswith(b"\x89PNG")
    assert client.get(f"{base}/../../manifest").status_code == 404
    assert client.get(f"{base}/unknown").status_code == 404


def test_review_is_not_available_for_synthetic_data(client):
    response = client.post("/api/datasets/synthetic", json={"n_experiments": 20})
    dataset = response.json()["dataset"]
    assert client.get(f"/api/datasets/{dataset['dataset_id']}/scientific-review").status_code == 404


def test_seed_uses_real_ingestion_and_preserves_existing_workspace(tmp_path):
    from scripts.seed_review_workspace import seed_review_workspace

    data_dir = tmp_path / "data"
    dataset_id = seed_review_workspace(data_dir)
    assert dataset_id is not None
    assert seed_review_workspace(data_dir) is None

    from falmex.storage import Store

    store = Store(data_dir)
    try:
        dataset = store.get_dataset(dataset_id)
        assert dataset is not None
        assert dataset.n_rows == 274
        assert len(store.list_findings(dataset_id)) == 44
        assert dataset.report["ingestion"][0]["encoding"] == "cp1252"
    finally:
        store.close()
