#!/usr/bin/env bash
# Take a database backup now (in addition to the automatic nightly one).
source "$(dirname "$0")/common.sh"
require_docker
step "Backing up the database into ./backups"
docker compose exec -T backup /bin/sh /backup-job.sh once
ls -lh backups/ | tail -n 5
echo "Copy backups off this machine regularly (docs/OPERATIONS.md › Off-site copies)."
