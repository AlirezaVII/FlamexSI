#!/usr/bin/env bash
set -euo pipefail

python /app/backend/scripts/seed_review_workspace.py
uvicorn falmex.api:app --host 127.0.0.1 --port 8000 &
backend_pid=$!
frontend_pid=""

shutdown() {
  trap - TERM INT
  [[ -n "$frontend_pid" ]] && kill "$frontend_pid" 2>/dev/null || true
  kill "$backend_pid" 2>/dev/null || true
}
trap shutdown TERM INT

export FALMEX_BACKEND_PID="$backend_pid"
python - <<'PY'
import os
import time
from urllib.request import urlopen

for attempt in range(60):
    try:
        with urlopen("http://127.0.0.1:8000/health", timeout=1) as response:
            if response.status == 200:
                break
    except Exception:
        pass
    try:
        os.kill(int(os.environ["FALMEX_BACKEND_PID"]), 0)
    except OSError as error:
        raise SystemExit("The FlamexSI API stopped during startup") from error
    time.sleep(0.5)
else:
    raise SystemExit("The FlamexSI API did not become ready within 30 seconds")
PY

node /app/frontend/server.js &
frontend_pid=$!
set +e
wait -n "$backend_pid" "$frontend_pid"
status=$?
set -e
shutdown
wait "$backend_pid" 2>/dev/null || true
[[ -n "$frontend_pid" ]] && wait "$frontend_pid" 2>/dev/null || true
exit "$status"
