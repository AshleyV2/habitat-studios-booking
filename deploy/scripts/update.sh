#!/usr/bin/env bash
# Install a new ApexBook release of the Habitat booking system without losing data.
#   1. backup   2. fetch new code   3. build   4. restart (migrations apply)   5. verify
# Never deletes the database. If anything fails, see docs/OPERATIONS.md › Rolling back.
source "$(dirname "$0")/common.sh"
require_docker

step "1/5 Backup before updating"
docker compose exec -T backup /bin/sh /backup-job.sh once

step "2/5 Fetching the new version"
if [ -d .git ]; then
  git pull --ff-only
else
  echo "Not a git checkout — make sure the new release files have already been copied over this folder"
  echo "(keep your .env and backups/). Press Enter to continue or Ctrl+C to stop."
  read -r _
fi

step "3/5 Building the new image (the current version keeps running meanwhile)"
if docker image inspect habitat-booking:local >/dev/null 2>&1; then
  docker image tag habitat-booking:local habitat-booking:previous
fi
docker compose build app

step "4/5 Restarting with the new version (database migrations apply automatically)"
docker compose up -d app backup

step "5/5 Verifying"
wait_healthy
docker compose exec -T app npx prisma migrate status || true
echo "Update complete. Version: $(docker compose exec -T app node -p "require('./package.json').version")"
