# Architecture

## Two systems, clearly separated

| | **ApexBook platform** (operated by ApexBook) | **Habitat installation** (this folder, on Habitat's premises) |
|---|---|---|
| Purpose | Running ApexBook as a business | Running Habitat Studios as a business |
| Holds | Customers of ApexBook, installed systems, maintenance subscriptions, ApexBook's Stripe billing, support tickets | Rooms, opening hours, prices, equipment, Habitat's customers, bookings, Habitat's Stripe payments, emails, settings |
| Runs | ApexBook's cloud | Habitat's server/PC (Docker Compose) |
| Database | ApexBook's PostgreSQL | Habitat's **local** PostgreSQL |
| Stripe account | ApexBook's | **Habitat's own** — the two never mix |
| Needed for bookings? | **No** | Yes |

The only link between them is optional: the installation sends a heartbeat (version, uptime, component health — **no customer or booking data**) to ApexBook's `POST /api/agent/heartbeat` over HTTPS, authenticated with a per-installation token. If ApexBook is unreachable, the heartbeat fails quietly, is shown on *System health*, and nothing else changes.

## What needs the internet

| Needs the internet | Works entirely on site |
|---|---|
| Stripe (taking online payments, refunds) | Admin interface (dashboard, calendar, bookings) |
| Stripe webhooks reaching the server | Availability and double-booking checks |
| SMTP email delivery | Rooms, prices, equipment, opening hours, closures |
| Public website / DNS / HTTPS certificates | Customer records and booking history |
| Optional ApexBook heartbeat | Manual bookings, cash/terminal payments |
| | Backups, logs, health checks |

Failure behaviour:

- **Stripe down** — the customer is told online payment is temporarily unavailable; the slot is released immediately; nothing is charged. Staff can still book by hand and record payments. A server-side reconciliation job asks Stripe about any unpaid holds every 5 minutes once it's back.
- **SMTP down** — emails stay in the outbox (database) and are retried with back-off for ~2 days; staff see failures on *Email* and the dashboard. Bookings are unaffected.
- **Internet down entirely** — online booking can't take payment; the local admin keeps working on the studio LAN (see NETWORK.md › LAN access).

## Components

```
./
├── server/     Express 5 + TypeScript (same layering as the ApexBook platform)
│   └── src/
│       ├── config/       validated environment
│       ├── auth/         Argon2id passwords, DB sessions (HMAC-hashed tokens), single-use tokens
│       ├── middleware/   authentication, permissions, CSRF, rate limits, errors
│       ├── services/
│       │   ├── availability.service.ts   opening hours, conflicts, equipment peak usage, lock
│       │   ├── pricing.service.ts        server-side prices + snapshot
│       │   ├── booking.service.ts        online/staff bookings, moves, cancellations
│       │   ├── payment.service.ts        Stripe Checkout, webhook application, refunds, reconciliation
│       │   ├── email/                    SMTP transport, database outbox, templates, .ics
│       │   ├── health.service.ts         system health checks
│       │   └── apexbook-agent.service.ts optional heartbeat
│       ├── stripe/       Stripe client + webhook verification/idempotency
│       ├── jobs/         background jobs (outbox, hold expiry, reconciliation, heartbeat)
│       └── controllers/, routes/
├── client/     React + Vite: public booking site (/) and admin (/admin)
├── shared/     Zod schemas, enums, permissions, API types
├── prisma/     schema + migrations (incl. SQL constraints Prisma can't express)
├── deploy/     Caddy/nginx/Apache configs, backup job, install/backup/restore/update scripts
└── docs/
```

## How double-booking is prevented

Three layers, the last of which cannot be bypassed by any application bug:

1. The booking page only offers start times computed from the live database.
2. Every booking write (create, move, payment confirmation) runs in a transaction that takes a PostgreSQL advisory lock, re-checks room conflicts, closures and equipment, then writes.
3. A PostgreSQL **exclusion constraint** (`booking_no_room_overlap`, btree_gist) rejects any two active bookings for the same room with overlapping time ranges. Cancelled and expired bookings are excluded from it, so history is kept without blocking.

### Equipment quantities

Availability of an item for a period = owned quantity − the **peak number of units in use at any moment** of that period by other active bookings. So with 4 microphones and 3 booked from 10:00–12:00, a request for 11:00–13:00 sees 1 free; two back-to-back bookings of 3 each (10–12, 12–14) still leave 1 free for 11–13, because never more than 3 are out at once.

## Payments

1. Customer chooses room/time/equipment; the server validates and prices it.
2. The server creates a `PENDING_PAYMENT` booking that holds the slot (default 30 minutes) and a Stripe Checkout session for exactly the server-computed lines.
3. The customer pays on Stripe's hosted page — the installation never sees card details.
4. Stripe calls `/api/stripe/webhook`; the signature is verified; the event is recorded in a ledger in the same transaction as its effects (duplicates are no-ops).
5. The booking becomes `CONFIRMED`, the payment is recorded, and confirmation + staff notification emails are queued atomically.
6. The return page only *displays* the status and polls; arriving there confirms nothing.

If a payment arrives after the hold lapsed, the booking is reinstated if the slot is still free, otherwise refunded automatically and the customer emailed.

## Booking states

`PENDING_PAYMENT` → `CONFIRMED` → `COMPLETED` / `NO_SHOW`, or `CANCELLED`; unpaid holds become `EXPIRED`. Nothing is deleted. Each booking stores a **pricing snapshot** (the exact lines charged), so later price changes never alter history.

## Security summary

Same model as the ApexBook platform: server-side sessions (HTTP-only, SameSite=Lax, Secure + `__Host-`/`__Secure-` prefixes in production, idle and absolute expiry), CSRF double-submit + Origin checks, Argon2id, per-route permissions (ADMIN / STAFF), Zod validation on every input, Prisma parameterised queries, Helmet CSP, strict CORS, rate limits, audit log, no secrets in the client or in Git. Customers have no accounts: their private booking link carries an HMAC-derived token that is never stored. PostgreSQL is on an internal Docker network with no published port.
