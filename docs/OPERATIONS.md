# Operations: backups, restore, updates, logs

All commands run from the `HABITAT` folder on the server. On Windows without bash, the equivalent `docker compose` command is given where it differs.

## Everyday

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Restart (keeps all data) | `docker compose restart app` |
| Stop / start everything | `docker compose stop` / `docker compose up -d` |
| App logs (live) | `docker compose logs -f app` |
| Health | *Admin › System health*, or `curl -fsS https://www.habitatstudio.co.uk/health/ready` |

Data lives in Docker volumes (`habitat_pgdata`, `habitat_applogs`, Caddy's certificates) and the `backups/` folder. Restarting containers, the server, or `docker compose down` **does not** remove data. Never run `docker compose down -v` or `docker volume rm` — that deletes the database.

## Backups

- **Automatic:** the `backup` service takes a compressed, verified backup every day at `BACKUP_TIME` (UTC) into `backups/`, and one immediately if the newest is over a day old. Backups older than `BACKUP_RETENTION_DAYS` are removed.
- **Manual:** `deploy/scripts/backup.sh`  (Windows: `docker compose exec -T backup /bin/sh /backup-job.sh once`)
- **Status:** *Admin › System health › Backups* (warns if the last one is over 26 hours old or failed).

### Off-site copies (do this)

A backup on the same disk doesn't survive a disk failure, theft or fire. Copy `backups/` somewhere else at least daily, e.g.:

```bash
# to a NAS
rsync -a --delete /opt/habitat/backups/ nas:/volume1/habitat-backups/
# or to cloud storage with rclone (encrypted remote recommended)
rclone sync /opt/habitat/backups remote:habitat-backups
```

Put it in `crontab -e`, e.g. `15 4 * * * rsync -a /opt/habitat/backups/ nas:/volume1/habitat-backups/`. Also keep a copy of `.env` somewhere safe (a password manager): without `SESSION_SECRET`, links in customers' existing emails stop working.

## Restore

```bash
deploy/scripts/restore.sh habitat-20261001-033000.dump
```

It asks you to type `RESTORE`, takes a safety backup of the current data first, stops the app, restores in a single transaction (all-or-nothing), starts the app (which applies any newer migrations to the restored data) and checks health.

Windows / manual equivalent:

```powershell
docker compose exec -T backup /bin/sh /backup-job.sh once          # safety backup
docker compose stop app
Get-Content -AsByteStream backups\habitat-20261001-033000.dump | docker compose exec -T postgres pg_restore -U habitat -d habitat --clean --if-exists --no-owner --single-transaction
docker compose start app
```

### Restoring onto a new machine

Install Docker, copy the `HABITAT` folder (including `.env` and `backups/`), run `deploy/scripts/install.sh` (starts an empty system), then `deploy/scripts/restore.sh <latest backup>`.

## Updating to a new version

```bash
deploy/scripts/update.sh
```

It (1) backs up, (2) pulls the new version, (3) builds it while the current version keeps serving, (4) restarts the app — database migrations apply automatically on start — and (5) verifies health and migration status. Bookings, customers, rooms, equipment, prices, settings and payment history are kept: updates only ever **add** to the database schema.

A normal update never involves deleting or recreating the database. If anyone tells you to, stop and contact ApexBook.

### If an update fails

- **Build failed:** nothing changed; the old version is still running.
- **App won't start after update:** check `docker compose logs app`.
  - If a migration failed, PostgreSQL rolled that migration back. Roll back the code: `HABITAT_VERSION=previous docker compose up -d app` (the image from before the update is tagged `previous`), and contact ApexBook with the logs.
  - Because migrations are additive, the previous version runs fine on a database that has already been migrated.
- **Worst case:** `deploy/scripts/restore.sh <backup made at step 1>`.

### For ApexBook engineers: writing safe migrations

- Add columns as nullable or with a default; add tables freely.
- Never drop/rename a column that holds data in the same release that stops using it — stop using it in release N, drop it in N+2 at the earliest, after confirming backups.
- Constraints Prisma can't express live in migration SQL (see the init migration). Check `prisma migrate diff` stays empty after schema changes.
- Rehearse on a restored copy of a real backup before shipping.

## Logs

| What | Where |
|---|---|
| Application (JSON, daily files, `LOG_RETENTION_DAYS`) | volume `habitat_applogs` → `docker compose exec app ls /app/logs` |
| Container output (rotated 10 × 10 MB) | `docker compose logs app` / `postgres` / `backup` / `proxy` |
| HTTPS access log | volume `habitat_caddylogs` (`/var/log/caddy/access.log` in the proxy) |
| Who did what in the admin | *Admin › Activity log* |

Logs never contain passwords, card details, session tokens or customers' private booking links.

## Changing secrets

- `POSTGRES_PASSWORD`: requires changing it inside Postgres too (`ALTER USER habitat PASSWORD '…'`) — contact ApexBook.
- `SESSION_SECRET`: signs everyone out and invalidates "manage booking" links in emails already sent. Only rotate if it has leaked.
- Stripe keys / SMTP password: edit `.env`, then `docker compose up -d app`.
