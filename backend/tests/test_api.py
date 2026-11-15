def _synthetic(client, n=200):
    res = client.post("/api/datasets/synthetic", json={"n_experiments": n, "seed": 3})
    assert res.status_code == 201
    return res.json()["dataset"]


def test_health_and_meta(client):
    assert client.get("/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert "oxygen" in {v["name"] for v in meta["variables"]}
    assert "csv" in meta["file_types"]
    assert {v["name"] for v in meta["validators"]} == {"holdout_replication",
                                                       "permutation_test"}


def test_upload_csv_standardizes(client):
    csv = b"Test ID,Pressure (atm),O2,extinguished\nE1,1,21,no\nE2,0.5,15,yes\n"
    res = client.post("/api/datasets", files={"file": ("nasa.csv", csv, "text/csv")})
    assert res.status_code == 201
    ds = res.json()["dataset"]
    assert ds["n_rows"] == 2 and ds["synthetic"] is False
    detail = client.get(f"/api/datasets/{ds['dataset_id']}").json()
    assert detail["sources"][0]["filename"] == "nasa.csv"
    pressure = next(c for c in detail["columns"] if c["name"] == "pressure")
    assert round(pressure["max"], 3) == 101.325


def test_upload_rejects_unsupported(client):
    res = client.post("/api/datasets", files={"file": ("x.exe", b"MZ", "application/x")})
    assert res.status_code == 415


def test_upload_media_creates_no_dataset(client):
    res = client.post("/api/datasets", files={"file": ("f.png", b"\x89PNG", "image/png")})
    assert res.status_code == 201
    assert res.json()["dataset"] is None and res.json()["assets"][0]["media_type"] == "image"


def test_query_experiment_and_compare(client):
    ds = _synthetic(client)
    did = ds["dataset_id"]
    res = client.post(f"/api/datasets/{did}/query", json={
        "filters": [{"field": "oxygen", "op": "gt", "value": 30},
                    {"field": "material", "op": "eq", "value": "SYNTH_A"}],
        "limit": 5, "sort": "oxygen",
    }).json()
    assert res["total"] > 0 and len(res["rows"]) <= 5
    assert all(r["oxygen"] > 30 and r["material"] == "SYNTH_A" for r in res["rows"])

    bad = client.post(f"/api/datasets/{did}/query", json={"filters": [{"field": "x;drop"}]})
    assert bad.status_code == 422

    exp = client.get(f"/api/datasets/{did}/experiments/SYN-0001").json()
    assert exp["rows"][0]["experiment_id"] == "SYN-0001"
    assert client.get(f"/api/datasets/{did}/experiments/NOPE").status_code == 404

    cmp = client.post(f"/api/datasets/{did}/compare",
                      json={"experiment_ids": ["SYN-0001", "SYN-0002"]}).json()
    assert {e["experiment_id"] for e in cmp["experiments"]} == {"SYN-0001", "SYN-0002"}


def test_discover_findings_interpret_summary(client):
    did = _synthetic(client, 300)["dataset_id"]
    assert client.get(f"/api/datasets/{did}/summary").status_code == 409

    res = client.post(f"/api/datasets/{did}/discover", json={}).json()
    assert res["tested"] > 0 and res["by_status"]["validated"] > 0

    listed = client.get("/api/findings", params={"dataset_id": did,
                                                 "status": "validated"}).json()
    assert listed and all(f["status"] == "validated" for f in listed)
    fid = listed[0]["finding_id"]

    interpreted = client.post(f"/api/findings/{fid}/interpret").json()
    assert interpreted["interpretation"]["provider"] == "mock"
    assert client.get(f"/api/findings/{fid}").json()["interpretation"] is not None

    summary = client.get(f"/api/datasets/{did}/summary").json()
    assert summary["summary"]


def test_not_found(client):
    assert client.get("/api/datasets/nope").status_code == 404
    assert client.get("/api/findings/nope").status_code == 404
