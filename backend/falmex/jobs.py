"""Background jobs for slow footage work (analysis, method comparison).

A long video can take minutes to analyse on a one-CPU server, longer than any proxy keeps a
request open (Cloudflare 100 s, Vercel 120 s). The page starts a job, gets its id at once,
and asks for its status every few seconds. Two workers: v6 mostly waits on its remote
service, so it can run beside a local method; more would only slow every job down.
Jobs live in memory: after a server restart an old id is unknown and the page says so.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import HTTPException

KEEP = 100  # finished jobs kept for their result


class Jobs:
    def __init__(self, workers: int = 2):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="falmex-job")
        self._jobs: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[], Any]) -> str:
        job_id = uuid.uuid4().hex
        job = {"job_id": job_id, "kind": kind, "status": "queued", "created": time.time(),
               "started": None, "finished": None, "result": None, "error": None}
        with self._lock:
            self._jobs[job_id] = job
            while len(self._jobs) > KEEP:
                old_id, old = next(iter(self._jobs.items()))
                if old["status"] in ("queued", "running"):
                    break
                self._jobs.pop(old_id)
        self._pool.submit(self._run, job, fn)
        return job_id

    def _run(self, job: dict, fn: Callable[[], Any]) -> None:
        job.update(status="running", started=time.time())
        try:
            job["result"] = fn()
            job["status"] = "done"
        except HTTPException as exc:
            job.update(status="error", error=str(exc.detail), code=exc.status_code)
        except Exception as exc:  # report, never crash the worker
            job.update(status="error", error=f"Unexpected error ({type(exc).__name__}).",
                       code=500)
        job["finished"] = time.time()

    def get(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        now = time.time()
        out = {k: job[k] for k in ("job_id", "kind", "status", "error")}
        out["code"] = job.get("code")
        out["elapsed_s"] = round((job["finished"] or now) - (job["started"] or now), 1)
        if job["status"] == "done":
            out["result"] = job["result"]
        return out
