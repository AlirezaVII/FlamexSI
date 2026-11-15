"""Chunked uploads (large files in pieces) and background jobs (slow footage work)."""

import hashlib
import time

import pytest

from falmex import services, uploads, vision


def send(client, filename: str, data: bytes, order=None, **complete):
    start = client.post("/api/uploads", json={"filename": filename, "size": len(data)})
    assert start.status_code == 201, start.text
    up = start.json()
    step = up["chunk_bytes"]
    pieces = [data[i:i + step] for i in range(0, len(data), step)]
    assert len(pieces) == up["chunks"]
    for i in order or range(len(pieces)):
        r = client.put(f"/api/uploads/{up['upload_id']}/{i}", content=pieces[i],
                       headers={"content-type": "application/octet-stream"})
        assert r.status_code == 200, r.text
    return up, client.post(f"/api/uploads/{up['upload_id']}/complete", json=complete)


@pytest.fixture
def small_pieces(monkeypatch):
    monkeypatch.setattr(uploads, "CHUNK_BYTES", 64 * 1024)  # many pieces from a small file


@pytest.fixture
def clip(tmp_path) -> bytes:
    path = tmp_path / "clip.avi"
    vision.synthetic_clip(path, frames=48)
    return path.read_bytes()


def test_video_arrives_in_pieces_and_is_stored_unchanged(client, small_pieces, clip,
                                                         monkeypatch):
    def never(*a, **k):
        raise AssertionError("a video must not be read into memory by the table reader")

    monkeypatch.setattr(services, "ingest_upload", never)
    up, res = send(client, "burn.avi", clip, order=None)
    assert up["chunks"] > 3
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["dataset"] is None and body["assets"][0]["media_type"] == "video"
    src = body["source"]
    assert src["sha256"] == hashlib.sha256(clip).hexdigest() and src["size_bytes"] == len(clip)
    media = client.get("/api/media").json()
    assert [m["source"]["source_id"] for m in media] == [src["source_id"]]
    # the stored file can be analysed like any upload
    a = client.post(f"/api/media/{src['source_id']}/analyze", json={"detector": "opencv"})
    assert a.status_code == 200 and a.json()["summary"]["flame_frames"] > 30


def test_pieces_may_arrive_in_any_order_and_be_sent_twice(client, small_pieces, clip):
    start = client.post("/api/uploads", json={"filename": "b.avi", "size": len(clip)}).json()
    uid, step, n = start["upload_id"], start["chunk_bytes"], start["chunks"]
    pieces = [clip[i:i + step] for i in range(0, len(clip), step)]
    for i in [n - 1, 0, *range(1, n - 1), 0]:  # last first, then a repeat
        assert client.put(f"/api/uploads/{uid}/{i}", content=pieces[i]).status_code == 200
    status = client.get(f"/api/uploads/{uid}").json()
    assert status["received"] == list(range(n))
    res = client.post(f"/api/uploads/{uid}/complete", json={})
    assert res.json()["source"]["sha256"] == hashlib.sha256(clip).hexdigest()
    assert client.get(f"/api/uploads/{uid}").status_code == 404, "pieces are removed after"


def test_bad_pieces_and_requests_are_refused(client, small_pieces, clip):
    assert client.post("/api/uploads", json={"filename": "x.exe", "size": 10}).status_code == 415
    assert client.post("/api/uploads", json={"filename": "x.csv", "size": 0}).status_code == 422
    big = uploads.TABLE_MAX_BYTES + 1
    assert client.post("/api/uploads", json={"filename": "x.csv", "size": big}).status_code == 413
    ok_video = client.post("/api/uploads", json={"filename": "x.mp4", "size": big})
    assert ok_video.status_code == 201, "videos may be far larger than tables"
    huge = client.post("/api/uploads", json={"filename": "x.mp4",
                                             "size": uploads.MEDIA_MAX_BYTES + 1})
    assert huge.status_code == 413

    start = client.post("/api/uploads", json={"filename": "c.avi", "size": len(clip)}).json()
    uid, step = start["upload_id"], start["chunk_bytes"]
    assert client.put(f"/api/uploads/{uid}/0", content=clip[:step - 1]).status_code == 422
    assert client.put(f"/api/uploads/{uid}/999", content=b"x").status_code == 422
    assert client.put(f"/api/uploads/{uid}/0", content=clip[:step] + b"!").status_code == 413
    client.put(f"/api/uploads/{uid}/0", content=clip[:step])
    early = client.post(f"/api/uploads/{uid}/complete", json={})
    assert early.status_code == 422 and "have not arrived" in early.json()["detail"]
    assert client.put("/api/uploads/not-an-id/0", content=b"x").status_code == 404
    assert client.get(f"/api/uploads/{'0' * 32}").status_code == 404
    assert client.delete(f"/api/uploads/{uid}").status_code == 204
    assert client.get(f"/api/uploads/{uid}").status_code == 404


def test_a_table_in_pieces_becomes_a_dataset_and_can_join_one(client, small_pieces):
    rows = "experiment_id,oxygen_mole_fraction,pressure_atm\n" + "".join(
        f"E{i},{0.15 + i % 10 / 100:.2f},1.0\n" for i in range(9000))
    data = rows.encode()
    _, res = send(client, "tests.csv", data, name="Chunked table")
    assert res.status_code == 201, res.text
    ds = res.json()["dataset"]
    assert ds["name"] == "Chunked table" and ds["n_rows"] == 9000
    extra = b"experiment_id,initial_droplet_diameter_mm\nE1,2.1\nE2,3.0\n"
    _, res2 = send(client, "extra.csv", extra, dataset_id=ds["dataset_id"])
    assert res2.status_code == 201, res2.text
    assert len(res2.json()["dataset"]["source_ids"]) == 2
    _, bad = send(client, "more.csv", extra, dataset_id="nope")
    assert bad.status_code == 404


def test_the_same_file_twice_is_kept_once(client, small_pieces, clip):
    _, a = send(client, "one.avi", clip)
    _, b = send(client, "again.avi", clip)
    assert a.json()["source"]["source_id"] == b.json()["source"]["source_id"]
    assert len(client.get("/api/media").json()) == 1


def test_forgotten_uploads_are_cleaned_up(client, small_pieces, clip):
    store = client.app.state.uploads
    old = client.post("/api/uploads", json={"filename": "o.avi", "size": len(clip)}).json()
    meta = store.root / old["upload_id"] / "meta.json"
    import json
    m = json.loads(meta.read_text())
    m["created"] = time.time() - uploads.STALE_SECONDS - 1
    meta.write_text(json.dumps(m))
    client.post("/api/uploads", json={"filename": "n.avi", "size": len(clip)})
    assert client.get(f"/api/uploads/{old['upload_id']}").status_code == 404


def wait(client, job_id: str, timeout: float = 120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_analysis_and_comparison_run_as_background_jobs(client):
    sid = client.post("/api/media/synthetic").json()["source"]["source_id"]
    start = client.post(f"/api/media/{sid}/analyze/start", json={"detector": "opencv"})
    assert start.status_code == 202
    job = wait(client, start.json()["job_id"])
    assert job["status"] == "done" and job["kind"] == "analyze", job
    assert job["result"]["detector"] == "opencv" and job["result"]["summary"]["flame_frames"] > 50
    assert client.get(f"/api/media/{sid}/analysis").json()["detector"] == "opencv", "saved"
    cmp = wait(client, client.post(f"/api/media/{sid}/compare/start", json={}).json()["job_id"])
    assert cmp["status"] == "done" and set(cmp["result"]["detectors"]) == {"opencv", "classic"}


def test_job_errors_and_unknown_jobs_are_reported(client, monkeypatch):
    monkeypatch.delenv("FALMEX_V6_URL", raising=False)
    sid = client.post("/api/media/synthetic").json()["source"]["source_id"]
    job = wait(client, client.post(f"/api/media/{sid}/analyze/start",
                                   json={"detector": "v6"}).json()["job_id"])
    assert job["status"] == "error" and job["code"] == 422 and "not set up" in job["error"]
    assert client.post("/api/media/nope/analyze/start", json={}).status_code == 404
    assert client.get(f"/api/jobs/{'0' * 32}").status_code == 404
