"""Chunked uploads: a large file arrives as numbered pieces, each its own small request.

Why: proxies in front of the server cap one request (Cloudflare: 100 MB and 100 s; a slow
link turns a 200 MB video into one very long request). Pieces of CHUNK_BYTES each stay far
under those limits, a failed piece is simply sent again, and the server never holds the
whole file in memory: pieces are written to disk and joined into one file while hashing.

Flow: start(filename, size) -> put(id, index, bytes) for every piece -> assemble(id) gives
the joined file, its SHA-256 and size; the caller stores it, then discard(id). Unfinished
uploads older than STALE_SECONDS are removed when a new upload starts.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

CHUNK_BYTES = 8 * 1024 * 1024
MEDIA_MAX_BYTES = 2 * 1024 ** 3  # videos are streamed from disk, never loaded whole
TABLE_MAX_BYTES = 200 * 1024 * 1024  # tables are parsed in memory
STALE_SECONDS = 24 * 3600
MEDIA_EXT = {".mp4", ".avi", ".mov", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}


@dataclass
class Upload:
    upload_id: str
    filename: str
    size: int
    chunk_bytes: int
    created: float

    @property
    def chunks(self) -> int:
        return max(1, math.ceil(self.size / self.chunk_bytes))

    @property
    def is_media(self) -> bool:
        return Path(self.filename).suffix.lower() in MEDIA_EXT


class Uploads:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir(self, upload_id: str) -> Path:
        try:
            uuid.UUID(hex=upload_id)
        except ValueError as exc:
            raise KeyError(upload_id) from exc
        return self.root / upload_id

    def start(self, filename: str, size: int, supported: set[str]) -> Upload:
        name = Path(filename).name.strip()
        ext = Path(name).suffix.lower()
        if not name or ext.lstrip(".") not in supported:
            raise ValueError(f"Unsupported file type '{ext or name}'.")
        limit = MEDIA_MAX_BYTES if ext in MEDIA_EXT else TABLE_MAX_BYTES
        if size <= 0:
            raise ValueError("The file is empty.")
        if size > limit:
            raise OverflowError(f"{name} is {size / 1e6:.0f} MB; the limit for this kind of "
                                f"file is {limit / 1e6:.0f} MB.")
        self.cleanup()
        up = Upload(uuid.uuid4().hex, name, int(size), CHUNK_BYTES, time.time())
        d = self.root / up.upload_id
        d.mkdir()
        (d / "meta.json").write_text(json.dumps(up.__dict__))
        return up

    def get(self, upload_id: str) -> Upload:
        meta = self._dir(upload_id) / "meta.json"
        if not meta.is_file():
            raise KeyError(upload_id)
        return Upload(**json.loads(meta.read_text()))

    def expected(self, up: Upload, index: int) -> int:
        """Bytes piece `index` must have: full pieces, then whatever is left."""
        if not 0 <= index < up.chunks:
            raise IndexError(index)
        return min(up.chunk_bytes, up.size - index * up.chunk_bytes)

    def put(self, upload_id: str, index: int, data: bytes) -> list[int]:
        up = self.get(upload_id)
        want = self.expected(up, index)
        if len(data) != want:
            raise ValueError(f"piece {index} should be {want} bytes, got {len(data)}")
        d = self._dir(upload_id)
        tmp = d / f"{index:06d}.part.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, d / f"{index:06d}.part")  # a piece is either complete or absent
        return self.received(upload_id)

    def received(self, upload_id: str) -> list[int]:
        return sorted(int(p.name[:6]) for p in self._dir(upload_id).glob("*.part"))

    def assemble(self, upload_id: str) -> tuple[Path, str, int]:
        """Join every piece into one file; returns (path, sha256, size)."""
        up = self.get(upload_id)
        missing = sorted(set(range(up.chunks)) - set(self.received(upload_id)))
        if missing:
            raise ValueError(f"{len(missing)} of {up.chunks} pieces have not arrived yet "
                             f"(first missing: {missing[0]})")
        d = self._dir(upload_id)
        out = d / ("joined" + Path(up.filename).suffix.lower())
        sha, total = hashlib.sha256(), 0
        with out.open("wb") as f:
            for i in range(up.chunks):
                part = d / f"{i:06d}.part"
                with part.open("rb") as src:
                    while block := src.read(1024 * 1024):
                        sha.update(block)
                        f.write(block)
                        total += len(block)
                part.unlink()
        if total != up.size:
            out.unlink()
            raise ValueError(f"joined file is {total} bytes, expected {up.size}")
        return out, sha.hexdigest(), total

    def discard(self, upload_id: str) -> None:
        shutil.rmtree(self._dir(upload_id), ignore_errors=True)

    def cleanup(self) -> None:
        now = time.time()
        for d in self.root.iterdir():
            meta = d / "meta.json"
            try:
                created = json.loads(meta.read_text())["created"] if meta.is_file() else 0
            except (ValueError, KeyError):
                created = 0
            if now - created > STALE_SECONDS:
                shutil.rmtree(d, ignore_errors=True)
