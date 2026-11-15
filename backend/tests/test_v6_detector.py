"""Pouya's v6 detector runs as a separate web service (services/v6). These tests stand in a
local fake of that service (same protocol) and check the main server's side: when v6 is
offered, how frames and the reference are sent, how masks come back, and what happens when
the service is missing, refuses or is down."""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import pytest

from falmex import vision

KEY = "test-key-" + "x" * 40


class FakeV6(BaseHTTPRequestHandler):
    seen: list = []
    status = 200

    def log_message(self, *args):
        pass

    def do_POST(self):  # noqa: N802
        n = int(self.headers["Content-Length"])
        split = int(self.headers["X-Frame-Bytes"])
        data = self.rfile.read(n)
        frame = cv2.imdecode(np.frombuffer(data[:split], np.uint8), cv2.IMREAD_COLOR)
        ref = cv2.imdecode(np.frombuffer(data[split:], np.uint8), cv2.IMREAD_COLOR)
        FakeV6.seen.append({"key": self.headers.get("X-Flamex-Key"), "frame": frame.shape,
                            "ref": ref.shape,
                            "type": self.headers.get("Content-Type")})
        if FakeV6.status != 200 or self.headers.get("X-Flamex-Key") != KEY:
            self.send_response(FakeV6.status if FakeV6.status != 200 else 401)
            self.end_headers()
            return
        # the fake "model": pixels clearly brighter than the reference
        diff = np.abs(frame.astype(int) - ref.astype(int)).max(axis=2)
        mask = ((diff > 60) & (frame.max(axis=2) > 120)).astype(np.uint8)
        body = json.dumps({"mask": base64.b64encode(cv2.imencode(".png", mask * 255)[1]).decode(),
                           "area_px": int(mask.sum())}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def v6(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeV6)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeV6.seen, FakeV6.status = [], 200
    monkeypatch.setenv("FALMEX_V6_URL", f"http://127.0.0.1:{server.server_address[1]}/api/predict")
    monkeypatch.setenv("FALMEX_V6_KEY", KEY)
    yield server
    server.shutdown()


def test_v6_is_offered_only_when_its_service_is_configured(client, monkeypatch):
    monkeypatch.delenv("FALMEX_V6_URL", raising=False)
    monkeypatch.delenv("FALMEX_V6_KEY", raising=False)
    ids = [d["id"] for d in client.get("/api/meta").json()["footage_detectors"]]
    assert ids == ["opencv", "classic"]
    sid = client.post("/api/media/synthetic").json()["source"]["source_id"]
    res = client.post(f"/api/media/{sid}/analyze", json={"detector": "v6"})
    assert res.status_code == 422 and "not set up" in res.json()["detail"]
    monkeypatch.setenv("FALMEX_V6_URL", "https://example.invalid/api/predict")
    assert "v6" not in vision.detectors(), "a URL without a key is not enough"
    monkeypatch.setenv("FALMEX_V6_KEY", KEY)
    meta = {d["id"]: d for d in client.get("/api/meta").json()["footage_detectors"]}
    assert list(meta) == ["opencv", "classic", "v6"] and meta["v6"]["video_only"] is True


def test_v6_measures_sampled_frames_from_the_service(client, v6):
    sid = client.post("/api/media/synthetic").json()["source"]["source_id"]
    res = client.post(f"/api/media/{sid}/analyze", json={"detector": "v6"})
    assert res.status_code == 200, res.text
    a = res.json()
    assert a["detector"] == "v6" and a["frames_analyzed"] == vision.V6_FRAMES
    s = a["summary"]
    assert s["flame_frames"] >= 18, s  # the synthetic flame burns through most of the clip
    assert s["extinguished_in_clip"] and 30 <= s["growth_rate"] <= 55, s  # true growth 40 px/s
    assert len(FakeV6.seen) == vision.V6_FRAMES
    assert all(c["key"] == KEY and c["frame"] == c["ref"] for c in FakeV6.seen)
    assert all(c["type"] == "application/octet-stream" for c in FakeV6.seen)
    idx = [f["index"] for f in a["frames"]]
    assert idx == sorted(idx) and idx[0] == 0 and idx[-1] == 71, "spread over the whole clip"
    # it was saved like any other analysis, with its overlay frames
    assert client.get(f"/api/media/{sid}/analysis").json()["detector"] == "v6"


def test_v6_reference_is_the_median_of_the_first_30_frames(tmp_path):
    path = tmp_path / "clip.avi"
    vision.synthetic_clip(path, frames=40)
    cap = cv2.VideoCapture(str(path))
    first = [cap.read()[1] for _ in range(30)]
    expected = np.median(np.stack(first), axis=0).astype(np.uint8)
    assert np.array_equal(vision._reference(path), expected)


def test_v6_wide_footage_is_downscaled_and_masks_scaled_back(tmp_path, v6):
    path = tmp_path / "wide.avi"
    vision.synthetic_clip(path, frames=36, size=1200)
    r = vision.analyze(path, tmp_path / "o", detector="v6")
    assert {c["frame"][1] for c in FakeV6.seen} == {vision.V6_MAX_WIDTH}
    assert r["frame_size"] == [1200, 1200] and r["summary"]["flame_frames"] > 0
    lit = [f for f in r["frames"] if f.get("present")]
    assert max(f["bbox"][0] + f["bbox"][2] for f in lit) > vision.V6_MAX_WIDTH * 0.5


def test_v6_needs_a_video(client, v6, tmp_path):
    img = np.zeros((200, 200, 3), np.uint8)
    cv2.circle(img, (100, 100), 30, (255, 255, 255), -1)
    with pytest.raises(ValueError, match="needs a video"):
        cv2.imwrite(str(tmp_path / "f.png"), img)
        vision.analyze(tmp_path / "f.png", tmp_path / "o", detector="v6")
    assert FakeV6.seen == [], "nothing is sent for an image"


def test_v6_failures_are_reported_and_do_not_sink_a_comparison(client, v6):
    sid = client.post("/api/media/synthetic").json()["source"]["source_id"]
    FakeV6.status = 401
    res = client.post(f"/api/media/{sid}/analyze", json={"detector": "v6"})
    assert res.status_code == 422 and "HTTP 401" in res.json()["detail"]
    cmp = client.post(f"/api/media/{sid}/compare", json={}).json()
    assert set(cmp["detectors"]) == {"opencv", "classic"} and "HTTP 401" in cmp["skipped"]["v6"]
    FakeV6.status = 200
    cmp = client.post(f"/api/media/{sid}/compare", json={}).json()
    assert set(cmp["detectors"]) == {"opencv", "classic", "v6"} and cmp["skipped"] == {}
    assert len(cmp["detectors"]["v6"]["radius"]) == vision.V6_FRAMES
    v6.shutdown()
    v6.server_close()
    res = client.post(f"/api/media/{sid}/analyze", json={"detector": "v6"})
    assert res.status_code == 422 and "did not answer" in res.json()["detail"]
