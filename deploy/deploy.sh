#!/bin/bash
# Server-side deploy for Falmex. Installed as the *forced command* of the CI deploy key
# (see deploy/README.md), so that key can do nothing on the droplet except this.
#
# stdin: a .tar.gz bundle with web/ (Next.js standalone), backend/ (Python package), run.sh
# Swaps the new release in, restarts Falmex, health-checks it, and rolls back on failure.
# Only touches /home/deploy/falmex — data/ and .env are never modified.

set -euo pipefail
ROOT=/home/deploy/falmex
cd "$ROOT"
exec 8>"$ROOT/deploy.lock"
flock -w 600 8

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
export UV_CACHE_DIR="$ROOT/.uvcache"
UV="$ROOT/uvbin/uv"

stop() {
  for n in web backend; do
    if [ -f "$n.pid" ] && kill -0 "$(cat "$n.pid")" 2>/dev/null; then
      kill "$(cat "$n.pid")" || true
      for _ in $(seq 20); do kill -0 "$(cat "$n.pid")" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$(cat "$n.pid")" 2>/dev/null || true
    fi
    rm -f "$n.pid"
  done
}

healthy() {
  for _ in $(seq 60); do
    if curl -fsS -m 3 http://127.0.0.1:8010/health >/dev/null 2>&1 \
      && curl -fsS -m 3 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

install_backend() { "$UV" pip install -q --python "$ROOT/venv/bin/python" --reinstall-package falmex "$1"; }

start() {
  # hold run.sh's lock while swapping so cron cannot start a half-installed release
  (
    flock 9
    stop
  ) 9>"$ROOT/run.lock"
  "$ROOT/run.sh" 8>&-
}

log "receiving bundle"
rm -rf stage && mkdir stage
tar xzf - -C stage
[ -f stage/web/server.js ] && [ -d stage/backend/falmex ] && [ -f stage/run.sh ] || {
  log "bundle is incomplete"; exit 1; }

log "swapping release"
rm -rf web.prev backend.prev run.sh.prev
mv web web.prev
mv backend backend.prev
cp run.sh run.sh.prev
mv stage/web web
mv stage/backend backend
install -m 755 stage/run.sh run.sh
rm -rf stage

log "installing backend"
if install_backend "$ROOT/backend" && start && healthy; then
  log "OK — new release is live"
  exit 0
fi

log "health check FAILED — rolling back"
tail -n 20 logs/backend.log logs/web.log 2>/dev/null || true
rm -rf web backend
mv web.prev web
mv backend.prev backend
install -m 755 run.sh.prev run.sh
install_backend "$ROOT/backend" || true
start
healthy && log "rolled back to previous release" || log "rollback also unhealthy!"
exit 1
