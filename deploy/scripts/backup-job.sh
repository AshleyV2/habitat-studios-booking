#!/bin/sh
# Habitat database backups. Runs inside the `backup` container (postgres image).
#
#   backup-job.sh once     take one backup now
#   backup-job.sh daemon   take a backup every day at BACKUP_TIME (UTC, HH:MM)
#
# Each backup is a compressed pg_dump (custom format) that is verified with
# pg_restore --list before it is kept. Status is written to last-backup.json, which
# the admin "System health" page reads. Old backups beyond BACKUP_RETENTION_DAYS are
# deleted — copy them off-site as well (docs/OPERATIONS.md).
set -eu

DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
AT="${BACKUP_TIME:-03:30}"
mkdir -p "$DIR"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

write_status() {
  printf '%s\n' "$1" > "$DIR/.last-backup.json.tmp"
  mv "$DIR/.last-backup.json.tmp" "$DIR/last-backup.json"
}

run_backup() {
  ts=$(date -u +%Y%m%d-%H%M%S)
  file="habitat-$ts.dump"
  tmp="$DIR/.$file.partial"
  started=$(now_iso)
  if pg_dump --format=custom --no-owner --file="$tmp" && pg_restore --list "$tmp" > /dev/null; then
    mv "$tmp" "$DIR/$file"
    size=$(wc -c < "$DIR/$file" | tr -d ' ')
    write_status "{\"ok\":true,\"file\":\"$file\",\"sizeBytes\":$size,\"startedAt\":\"$started\",\"finishedAt\":\"$(now_iso)\"}"
    # Retention: delete dumps older than N days (never the one just written).
    find "$DIR" -maxdepth 1 -name 'habitat-*.dump' -type f -mtime +"$RETENTION" ! -name "$file" -exec rm -f {} \;
    echo "$(now_iso) backup ok: $file ($size bytes)"
  else
    rm -f "$tmp"
    write_status "{\"ok\":false,\"error\":\"pg_dump failed — check the backup container logs\",\"file\":\"\",\"sizeBytes\":0,\"startedAt\":\"$started\",\"finishedAt\":\"$(now_iso)\"}"
    echo "$(now_iso) BACKUP FAILED" >&2
    return 1
  fi
}

case "${1:-once}" in
  once)
    run_backup
    ;;
  daemon)
    echo "$(now_iso) nightly backups at $AT UTC into $DIR, keeping $RETENTION days"
    # If the newest backup is more than a day old (or there is none), take one now.
    if [ -z "$(find "$DIR" -maxdepth 1 -name 'habitat-*.dump' -mmin -1440 2>/dev/null | head -n 1)" ]; then
      run_backup || true
    fi
    while true; do
      if [ "$(date -u +%H:%M)" = "$AT" ]; then
        run_backup || true
        sleep 61
      fi
      sleep 20
    done
    ;;
  *)
    echo "usage: $0 once|daemon" >&2
    exit 2
    ;;
esac
