# Habitat Studios booking system

The first production **ApexBook installation**: Habitat Studios' own booking website and admin, installed and running on Habitat's premises.

- It replaces Habitat's old website at `https://www.habitatstudio.co.uk`: a home page (rooms, prices, equipment, hours, contact) and online booking with real availability, paid through **Habitat's own Stripe account**.
- Staff run the day from `/admin`: dashboard, calendar, bookings, customers, payments, rooms and pricing, equipment, opening hours and closures, settings, email status, system health, staff accounts and activity log.
- Everything runs locally (PostgreSQL, app, backups, logs). Only Stripe, email delivery, the public domain and the optional ApexBook heartbeat use the internet. **Bookings never depend on ApexBook being online.**

## Install on the studio's server (Raspberry Pi)

```bash
sudo mkdir -p /opt/habitat && sudo chown $USER /opt/habitat
git clone https://github.com/AshleyV2/habitat-studios-booking.git /opt/habitat
cd /opt/habitat
deploy/scripts/install.sh      # first run creates .env with fresh secrets; check it, then run again to start
```

The full walkthrough (domain, HTTPS, Stripe, email, first admin, test booking) is in [docs/INSTALL.md](docs/INSTALL.md), including [Raspberry Pi notes](docs/INSTALL.md#raspberry-pi-notes). No secrets are in this repository: each install generates its own in `.env`, which is never committed.

| Guide | For |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | First installation, step by step (Docker → domain → Stripe → SMTP → test booking/payment/email/backup) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Backups, off-site copies, restore, updates, rollback, logs |
| [docs/NETWORK.md](docs/NETWORK.md) | Ports, firewall, HTTPS, reverse proxies (Caddy/nginx/Apache/Cloudflare), LAN access, Stripe webhooks, SMTP |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | ApexBook vs installation, what's local, double-booking prevention, payments, security |

## Quick reference

```bash
deploy/scripts/install.sh      # first install (creates .env, starts services)
docker compose exec -it app node server/dist/create-admin.js --email you@habitatstudio.co.uk --name "Your Name"
deploy/scripts/backup.sh       # backup now (automatic nightly as well)
deploy/scripts/restore.sh <file>
deploy/scripts/update.sh       # backup → new version → migrate → verify
```

Health: `GET /health` (process) and `GET /health/ready` (database).

## Development

```bash
npm install
npm run db:migrate && npm run db:seed-dev   # dev-only sample config; refuses to run in production
npm run dev                                  # http://localhost:5174 (admin: /admin)
npm run typecheck && npm test                # integration tests against PostgreSQL
npm run build && npm run smoke               # production build + HTTP smoke test (mounted under /book)
```

Stack and conventions match the ApexBook platform (Express 5, Prisma, PostgreSQL, React + Vite, Zod, Argon2id sessions, same admin design system).
