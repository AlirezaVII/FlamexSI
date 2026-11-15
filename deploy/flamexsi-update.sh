#!/bin/bash
# FlamexSI on flamexsi.com (a shared host: VPN, bots, other containers). Root cron, every
# 5 minutes: if the `tested` branch moved (CI moves it only after every check on main
# passed), rebuild the image and swap the container. The new
# container must answer /health within 3 minutes, otherwise the previous image is restarted.
# Everything FlamexSI creates is named flamexsi*; nothing else on the host is touched.
#   */5 * * * * root /usr/local/bin/flamexsi-update.sh   (in /etc/cron.d/flamexsi)
# First install: FORCE=1 /usr/local/bin/flamexsi-update.sh

set -u
APP_USER=asd
SRC=/home/asd/flamexsi
DATA=/home/asd/flamexsi-data
ENVF=/home/asd/flamexsi.env
LOG=/home/asd/flamexsi-update.log
exec 9>/run/flamexsi-update.lock; flock -n 9 || exit 0
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
[ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ] && tail -c 500000 "$LOG" > "$LOG.1" && : > "$LOG"

git_() { sudo -u "$APP_USER" -H git -C "$SRC" "$@"; }
BRANCH=tested
git_ fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>>"$LOG" \
  || { log "fetch failed"; exit 1; }
new=$(git_ rev-parse "origin/$BRANCH"); cur=$(git_ rev-parse HEAD)
running=$(docker inspect -f '{{index .Config.Labels "flamexsi.commit"}}' flamexsi 2>/dev/null || true)
[ "$new" = "$cur" ] && [ "$running" = "$cur" ] && [ -z "${FORCE:-}" ] && exit 0

log "deploying ${new:0:7} (running: ${running:0:7})"
git_ reset -q --hard "origin/$BRANCH"
if ! nice -n 15 env DOCKER_BUILDKIT=0 docker build -q --cpu-quota 70000 --memory 2g \
     --memory-swap 4g --label flamexsi.commit="$new" -t flamexsi:candidate "$SRC" >>"$LOG" 2>&1; then
  log "build failed; the running site is unchanged"; exit 1
fi

start() {  # $1 = image
  docker rm -f flamexsi >/dev/null 2>&1
  docker run -d --name flamexsi --restart unless-stopped \
    -p 127.0.0.1:3080:3000 -v "$DATA:/data" --env-file "$ENVF" \
    --memory 1500m --memory-swap 2500m --cpus 0.8 --oom-score-adj 500 \
    --log-opt max-size=20m --log-opt max-file=3 "$1" >/dev/null
}
healthy() {
  for _ in $(seq 1 36); do
    curl -fs -m 5 -o /dev/null http://127.0.0.1:3080/health && \
      curl -fs -m 10 -o /dev/null http://127.0.0.1:3080/ && return 0
    sleep 5
  done
  return 1
}

docker image inspect flamexsi:latest >/dev/null 2>&1 && docker tag flamexsi:latest flamexsi:previous
start flamexsi:candidate
if healthy; then
  docker tag flamexsi:candidate flamexsi:latest
  log "OK ${new:0:7} is live"
  docker image prune -f --filter "label=flamexsi.commit" >/dev/null 2>&1
else
  log "FAILED: ${new:0:7} did not become healthy; rolling back"
  docker logs --tail 40 flamexsi >>"$LOG" 2>&1
  if docker image inspect flamexsi:previous >/dev/null 2>&1; then
    start flamexsi:previous && healthy && log "rolled back to the previous image"
  fi
  exit 1
fi
