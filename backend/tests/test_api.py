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
                      json={"experiment_ids": ["SYN-0001", "SYN-0002", "NOPE"]}).json()
    assert cmp["experiments"] == ["SYN-0001", "SYN-0002"] and cmp["missing"] == ["NOPE"]
    oxygen = next(v for v in cmp["variables"] if v["name"] == "oxygen")
    assert oxygen["group"] == "condition" and oxygen["values"]["SYN-0001"]["n"] == 1


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


def test_data_quality_and_append_file(client):
    csv1 = (b"Test ID,Pressure (atm),O2,burn_rate,Camera\n"
            b"E1,1,21,1.2,a\nE2,0.5,15,x,b\nE2,0.5,15,x,b\n")
    res = client.post("/api/datasets", files={"file": ("a.csv", csv1, "text/csv")})
    ds = res.json()["dataset"]
    q = client.get(f"/api/datasets/{ds['dataset_id']}/quality").json()
    assert q["rows_removed"]["exact duplicate row"] == 1
    assert q["unit_conversions"][0] == {"column": "pressure", "raw": "Pressure (atm)",
                                        "from": "atm", "to": "kPa", "values": 2}
    assert q["invalid_values_set_missing"] == 1
    cam = next(v for v in q["variables"] if v["name"] == "camera")
    assert cam["group"] == "unmapped" and not cam["mapped"]  # kept, not dropped

    csv2 = b"Test ID,burn_rate\nE1,1.4\n"
    res = client.post(f"/api/datasets/{ds['dataset_id']}/sources",
                      files={"file": ("b.csv", csv2, "text/csv")})
    assert res.status_code == 201 and len(res.json()["dataset"]["source_ids"]) == 2
    q = client.get(f"/api/datasets/{ds['dataset_id']}/quality").json()
    assert q["sources"] == 2 and q["experiments_with_repeated_measurements"] == 1
    again = client.post(f"/api/datasets/{ds['dataset_id']}/sources",
                        files={"file": ("b.csv", csv2, "text/csv")})
    assert again.status_code == 422


def test_goals_deep_analysis_and_insight_rules(client):
    did = _synthetic(client, 300)["dataset_id"]
    goals = client.get(f"/api/datasets/{did}/goals").json()
    assert any(g["id"] == "column:sample_mass" for g in goals["goals"])
    res = client.post(f"/api/datasets/{did}/discover", json={
        "goal": "Which conditions are associated with changes in burning rate?",
        "outcomes": ["burning_rate"], "extra_conditions": ["sample_mass"]}).json()
    assert {f["outcome"] for f in res["findings"]} == {"burning_rate"}
    f = next(x for x in res["findings"] if x["status"] == "validated")
    assert f["goal"].startswith("Which conditions")

    sugg = client.get(f"/api/findings/{f['finding_id']}/deep").json()["suggestions"]
    sub = next(s for s in sugg if s["probe"] == "subgroup_consistency")
    run = client.post(f"/api/findings/{f['finding_id']}/deep",
                      json={"probe": sub["probe"], "params": sub["params"]})
    assert run.status_code == 200 and run.json()["verdict"] in {"supports", "weakens"}
    stored = client.get(f"/api/findings/{f['finding_id']}").json()
    assert any(p["probe"] == "subgroup_consistency" for p in stored["deep"])

    # synthetic findings can never become insights
    body = {"statement": "x" * 12, "scientific_interpretation": "y" * 12,
            "fire_safety_relevance": "z" * 6, "reviewer": "QA"}
    assert client.post(f"/api/findings/{f['finding_id']}/insight", json=body).status_code == 409
    assert client.get("/api/insights").json() == []


def test_raw_file_is_kept_byte_for_byte(client, settings):
    csv = b"Test ID,Pressure (atm),O2\nE1,1,21\nE1,1,21\nE2,x,15\n"
    res = client.post("/api/datasets", files={"file": ("raw.csv", csv, "text/csv")}).json()
    raw_files = list((settings.data_dir / "raw").iterdir())
    assert len(raw_files) == 1 and raw_files[0].read_bytes() == csv  # untouched original
    # while the processed copy was cleaned, converted and is traceable to that file
    q = client.get(f"/api/datasets/{res['dataset']['dataset_id']}/quality").json()
    assert q["rows_removed"]["exact duplicate row"] == 1
    assert q["unit_conversions"][0]["from"] == "atm" and q["unit_conversions"][0]["to"] == "kPa"
    assert res["source"]["sha256"] in raw_files[0].name


def test_showcase_numbers_come_from_the_engine_and_agree(client):
    s = client.get("/api/showcase").json()
    assert s["synthetic"] and s["explained_by"] == ["oxygen"]
    assert abs(s["controls"]["oxygen"]["effect"]) < 0.5 * abs(s["effect_all_rows"])
    assert abs(s["controls"]["pressure"]["effect"]) > 0.8 * abs(s["effect_all_rows"])
    assert s["shuffles_as_strong"] < s["permutations"] * 0.05
    assert s["split"]["shared_across_split"] == {"experiment_id": 0}
