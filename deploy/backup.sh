#!/bin/bash
# FlamexSI data backup (no root needed). Cron, every 30 minutes:
#   */30 * * * * /home/deploy/falmex-backups/backup.sh # falmex-backup
# Paths default to the droplet; another host sets them in the cron line, e.g. flamexsi.com:
#   FALMEX_BACKUP_DATA=/home/asd/flamexsi-data FALMEX_BACKUP_DEST=/home/asd/flamexsi-backups
#   FALMEX_BACKUP_PY=/home/asd/flamexsi-backups/venv/bin/python
#
# 1. Copies the data folder (DuckDB + parquet + raw files) to a temp folder and packs it.
# 2. Verifies the archive: it unpacks, the database opens, every table is readable, and
#    every dataset's parquet and every source's raw file is inside.
# 3. Only when the new backup is verified, older backups are deleted, keeping the newest
#    three (the new one + two before it). If the new backup holds FEWER datasets than the
#    previous one (data was deleted?), nothing is pruned, so the last good copy survives.
# Low CPU/IO priority and oom_score_adj=1000: the bots on this host always win.

set -u
DATA=${FALMEX_BACKUP_DATA:-/home/deploy/falmex/data}
DEST=${FALMEX_BACKUP_DEST:-/home/deploy/falmex-backups}
PY=${FALMEX_BACKUP_PY:-/home/deploy/falmex/venv/bin/python}
KEEP=3
mkdir -p "$DEST/archives"
LOG=$DEST/backup.log
exec 9>"$DEST/backup.lock"; flock -n 9 || exit 0
echo 1000 > /proc/self/oom_score_adj 2>/dev/null
renice -n 15 $$ >/dev/null 2>&1; ionice -c3 -p $$ >/dev/null 2>&1
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
[ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ] && tail -c 500000 "$LOG" > "$LOG.1" && : > "$LOG"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d "$DEST/tmp.XXXX")
trap 'rm -rf "$TMP"' EXIT

snapshot() {
  rm -rf "$TMP/data" && cp -a "$DATA" "$TMP/data"
}
verify() {  # prints "<datasets> <findings> <insights>" or fails
  "$PY" - "$1" <<'EOF'
import json, sys
from pathlib import Path
import duckdb
d = Path(sys.argv[1])
con = duckdb.connect(str(d / "falmex.duckdb"), read_only=True)
n = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
     for t in ["sources", "datasets", "findings", "insights", "innovations",
               "media_analyses", "reference_limits"]}
for (did,) in con.execute("SELECT dataset_id FROM datasets").fetchall():
    assert (d / "processed" / f"{did}.parquet").is_file(), f"missing parquet {did}"
for (sha,) in con.execute("SELECT sha256 FROM sources").fetchall():
    assert any((d / "raw").glob(sha + "*")), f"missing raw file {sha[:12]}"
for t in ["findings", "insights"]:
    for (p,) in con.execute(f"SELECT payload FROM {t} LIMIT 50").fetchall():
        json.loads(p)
print(n["datasets"], n["findings"], n["insights"])
EOF
}

ok=""
for attempt in 1 2 3; do  # the live database may be mid-write: retry a fresh copy
  snapshot && counts=$(verify "$TMP/data" 2>>"$LOG") && ok=1 && break
  log "attempt $attempt: snapshot did not verify, retrying"; sleep 20
done
[ -z "$ok" ] && { log "FAILED: no verified snapshot; old backups kept"; exit 1; }

ARCHIVE="$DEST/archives/falmex-data-$STAMP.tar.zst"
tar -C "$TMP" -cf - data | zstd -q -10 -o "$ARCHIVE" || { log "FAILED: pack"; rm -f "$ARCHIVE"; exit 1; }
# the archive itself must unpack to a database that verifies
CHECK="$TMP/check"; mkdir -p "$CHECK"
zstd -dc "$ARCHIVE" | tar -C "$CHECK" -xf - && again=$(verify "$CHECK/data" 2>>"$LOG")
if [ "${again:-}" != "$counts" ]; then log "FAILED: archive does not verify"; rm -f "$ARCHIVE"; exit 1; fi
echo "$counts" > "$ARCHIVE.counts"
log "OK $ARCHIVE datasets/findings/insights=$counts size=$(du -h "$ARCHIVE" | cut -f1)"

prev=$(ls -1 "$DEST"/archives/*.tar.zst 2>/dev/null | sort | tail -n 2 | head -n 1)
if [ -n "$prev" ] && [ "$prev" != "$ARCHIVE" ] && [ -f "$prev.counts" ]; then
  was=$(cut -d' ' -f1 "$prev.counts"); now=$(echo "$counts" | cut -d' ' -f1)
  if [ "$now" -lt "$was" ]; then
    log "WARNING: datasets dropped $was -> $now; keeping every older backup"; exit 0
  fi
fi
ls -1 "$DEST"/archives/*.tar.zst | sort | head -n -$KEEP | while read -r old; do
  rm -f "$old" "$old.counts" && log "pruned $(basename "$old")"
done
