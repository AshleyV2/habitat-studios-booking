#!/usr/bin/env bash
# Restore the database from a backup file in ./backups.
#   deploy/scripts/restore.sh habitat-20261001-033000.dump
# A safety backup of the CURRENT database is taken first, so a restore can be undone.
source "$(dirname "$0")/common.sh"
require_docker
file="${1:-}"
[ -n "$file" ] || { echo "Usage: $0 <backup file name in ./backups>"; ls -1t backups/*.dump 2>/dev/null | head -n 10; exit 2; }
file="$(basename "$file")"
[ -f "backups/$file" ] || die "backups/$file not found"

echo "This replaces ALL current bookings, customers, rooms, prices and settings with the contents of:"
echo "  backups/$file"
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || die "Cancelled — nothing was changed."

step "Safety backup of the current database"
docker compose exec -T backup /bin/sh /backup-job.sh once

step "Stopping the app (the website shows an error for a minute)"
docker compose stop app

step "Restoring (all-or-nothing, in one transaction)"
if ! docker compose exec -T postgres pg_restore -U habitat -d habitat --clean --if-exists --no-owner --single-transaction < "backups/$file"; then
  docker compose start app
  die "Restore failed and was rolled back; the database is unchanged."
fi

step "Starting the app (applies any newer migrations to the restored data)"
docker compose start app
wait_healthy
echo "Restore complete."
