#!/bin/bash
# FlamexSI watchdog for a shared droplet (no root needed). Run from cron every minute:
# starts the backend (127.0.0.1:8010) and the web app (0.0.0.0:3000) if they are not running.
#
# Both processes set oom_score_adj=1000 and run with low CPU priority, so if the droplet
# runs out of memory the kernel kills FlamexSI first, never the other services on the host.

ROOT=/home/deploy/falmex
cd "$ROOT" || exit 1
exec 9>"$ROOT/run.lock"
flock -n 9 || exit 0

running() { [ -f "$ROOT/$1.pid" ] && kill -0 "$(cat "$ROOT/$1.pid")" 2>/dev/null; }

for log in logs/backend.log logs/web.log; do
  [ "$(stat -c%s "$log" 2>/dev/null || echo 0)" -gt 10000000 ] && tail -c 2000000 "$log" > "$log.1" && : > "$log"
done

if ! running backend; then
  (
    exec 8>&- 9>&-  # never let the long-running process inherit the lock files
    echo 1000 > /proc/self/oom_score_adj
    set -a; . "$ROOT/.env"; set +a
    exec nice -n 10 "$ROOT/venv/bin/uvicorn" falmex.api:app --host 127.0.0.1 --port 8010
  ) >> logs/backend.log 2>&1 < /dev/null &
  echo $! > backend.pid
fi

if ! running web; then
  (
    exec 8>&- 9>&-  # never let the long-running process inherit the lock files
    echo 1000 > /proc/self/oom_score_adj
    cd "$ROOT/web"
    PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production \
      exec nice -n 10 "$ROOT/node/bin/node" --max-old-space-size=128 server.js
  ) >> logs/web.log 2>&1 < /dev/null &
  echo $! > web.pid
fi
