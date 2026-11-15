"""FlamexSI v6 flame finder: Pouya Latifiyan's frozen LightGBM model (bass-cv/vision-v6) as a
small web service, because its 74 per-pixel features need more memory than the main server.

POST /api/predict
  headers: X-Flamex-Key: <shared secret>, X-Frame-Bytes: <length of the first PNG>
  body:    frame PNG followed by reference PNG (BGR, same size; the reference is the median
           of the clip's first 30 frames, as in the frozen pipeline)
  returns: {"mask": <PNG, base64, 0/255>, "area_px", "camera_guard_active", "ms", "model_sha256"}
GET /api/predict -> health: model hash and library versions (no secret needed, no data).

The model code in _v6/ is Pouya's, copied unchanged; the model file is checked against the
hash recorded in bass-cv/vision-v6/model-freeze.json before anything is predicted.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent / "_v6"
sys.path.insert(0, str(HERE))

# LightGBM needs the GNU OpenMP runtime, which Vercel's Python image does not ship. A copy
# from conda-forge (libgomp 12.2.0, glibc >= 2.17) is loaded globally first, so LightGBM's
# own `libgomp.so.1` dependency resolves to it by name.
if sys.platform.startswith("linux"):
    import ctypes

    ctypes.CDLL(str(HERE / "lib" / "libgomp.so.1"), mode=ctypes.RTLD_GLOBAL)

import cv2  # noqa: E402
import joblib  # noqa: E402
import lightgbm  # noqa: E402
import numpy as np  # noqa: E402
import sklearn  # noqa: E402

import falmex_vision_v6 as v6  # noqa: E402

MODEL_FILE = HERE / "falmex-vision-v6.joblib"
MODEL_SHA256 = "00a0609dd119f7c14db31453587efe1b8d18353c70dd908c211494a90b88566f"
MAX_PIXELS = 1280 * 720  # the caller downscales larger footage; 74 float features per pixel
MAX_BODY = 4_400_000  # Vercel's request limit is 4.5 MB

_bundle = None


def bundle():
    global _bundle
    if _bundle is None:
        digest = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
        if digest != MODEL_SHA256:
            raise RuntimeError("frozen v6 model hash mismatch")
        b = joblib.load(MODEL_FILE)
        if b["config"] != v6.CONFIG or b["feature_names"] != v6.FEATURE_NAMES:
            raise RuntimeError("inference code differs from the frozen v6 model")
        _bundle = b
    return _bundle


def decode(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not a readable PNG")
    return img


def predict(frame_png: bytes, reference_png: bytes) -> dict:
    frame, reference = decode(frame_png), decode(reference_png)
    if frame.shape != reference.shape:
        raise ValueError("frame and reference differ in size")
    h, w = frame.shape[:2]
    if h * w > MAX_PIXELS:
        raise ValueError(f"frame too large ({w}x{h}); downscale to at most {MAX_PIXELS} pixels")
    t0 = time.perf_counter()
    b = bundle()
    mask = v6.predict_mask(b, frame, reference).astype(np.uint8)
    guard = b["domain_guard"] != "no_guard" and v6.camera_information_guard(frame, b["domain_guard"])
    ok, png = cv2.imencode(".png", mask * 255)
    return {
        "mask": base64.b64encode(png.tobytes()).decode(),
        "area_px": int(mask.sum()),
        "camera_guard_active": bool(guard),
        "size": [w, h],
        "ms": round((time.perf_counter() - t0) * 1000),
        "model_sha256": MODEL_SHA256,
    }


class handler(BaseHTTPRequestHandler):  # noqa: N801 (Vercel's Python entry point name)
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        self._send(200, {
            "ok": True, "model": "falmex-vision-v6", "model_sha256": MODEL_SHA256,
            "versions": {"numpy": np.__version__, "opencv": cv2.__version__,
                         "scikit-learn": sklearn.__version__, "joblib": joblib.__version__,
                         "lightgbm": lightgbm.__version__},
        })

    def do_POST(self):  # noqa: N802
        secret = os.environ.get("FLAMEX_V6_KEY", "")
        if not secret:
            return self._send(503, {"error": "service has no key configured"})
        if not hmac.compare_digest(self.headers.get("X-Flamex-Key", ""), secret):
            return self._send(401, {"error": "wrong key"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            split = int(self.headers.get("X-Frame-Bytes", "0"))
        except ValueError:
            return self._send(400, {"error": "bad length headers"})
        if not 0 < length <= MAX_BODY or not 0 < split < length:
            return self._send(400, {"error": "body must be frame PNG + reference PNG, under 4.4 MB"})
        data = self.rfile.read(length)
        try:
            return self._send(200, predict(data[:split], data[split:]))
        except ValueError as exc:
            return self._send(422, {"error": str(exc)})
