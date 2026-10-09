# First installation at Habitat Studios

Allow about two hours. You need: the server (below), access to the router, the DNS for habitatstudio.co.uk, Habitat's Stripe account, and an SMTP mailbox.

**Server:** a **Raspberry Pi 5 (or 4) with 8 GB RAM** (4 GB works) running 64-bit Raspberry Pi OS Lite, booting from a **USB/NVMe SSD** rather than a microSD card (the database writes constantly and wears SD cards out), with the official power supply, wired network and a case with a fan. See [Raspberry Pi notes](#raspberry-pi-notes) below.

Any other small always-on PC or mini-server also works: — 2+ CPU cores, 4 GB RAM, 40 GB SSD, wired network, on a UPS if possible. Ubuntu Server 24.04 LTS is recommended. (Windows 11 with Docker Desktop also works; run the scripts from Git Bash or WSL, or use the plain `docker compose` commands shown.)

---

## 1. Install Docker

Raspberry Pi OS (64-bit) or Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in afterwards
docker compose version          # must print v2.x
```

Windows: install Docker Desktop, enable "Start Docker Desktop when you sign in", and in *Settings › Resources* give it at least 2 GB RAM.

## 2. Get the Habitat deployment

```bash
sudo mkdir -p /opt/habitat && sudo chown $USER /opt/habitat
cd /opt/habitat
git clone https://github.com/AshleyV2/habitat-studios-booking.git .
```

All further commands run from `/opt/habitat`. (`sudo apt install -y git` first if git is missing.)

## 3. Configure `.env`

```bash
deploy/scripts/install.sh      # first run: creates .env with fresh secrets, then stops
nano .env
```

Set at least:

| Variable | Value |
|---|---|
| `PUBLIC_URL` | `https://www.habitatstudio.co.uk` |
| `HABITAT_DOMAIN` | `www.habitatstudio.co.uk` (when using the bundled Caddy) |
| `COMPOSE_PROFILES` | `caddy` (default), `tunnel`, or empty — see NETWORK.md |
| `TRUST_PROXY` | `1` |
| `BUSINESS_NAME` | `Habitat Studios` |

Leave Stripe and SMTP empty for now if you don't have them yet — steps 8 and 9. `SESSION_SECRET` and `POSTGRES_PASSWORD` are already generated; don't share them. The file is created with `chmod 600`.

## 4. Start the services

```bash
deploy/scripts/install.sh
```

This builds the image, starts `postgres`, `app`, `backup` (and `proxy`), and waits until the health check passes. Check anytime with `docker compose ps`.

## 5. Database migrations

Migrations run automatically every time the app container starts (`prisma migrate deploy`). To see the state:

```bash
docker compose exec app npx prisma migrate status
```

## 6. Create the first administrator

```bash
docker compose exec -it app node server/dist/create-admin.js --email owner@habitatstudio.co.uk --name "Owner Name"
```

You'll be asked for a password (12+ characters). Sign in at `https://www.habitatstudio.co.uk/admin`.

Then, in the admin:

1. **Business & booking settings** — contact details, address, website, notification email, booking rules, cancellation policy, terms.
2. **Opening hours & closures** — weekly hours (customers see no times until a day is open), plus holidays.
3. **Rooms & pricing** — each room with its hourly rate; add evening/weekend price rules if used.
4. **Equipment** — each item, price (per booking or per hour) and the quantity owned.
5. **Staff accounts** — invite the team (Staff = bookings/customers/payments; Admin = everything).

## 7. Domain and reverse proxy

Follow NETWORK.md: DNS A record, router port forwards (80/443), then `docker compose up -d`. Caddy obtains the certificate within a minute; `https://www.habitatstudio.co.uk` should load with a padlock. This system replaces the old website: once DNS points here, the home page, rooms, prices and online booking are all served from this server.

## 8. Configure Stripe (Habitat's own account)

1. Stripe Dashboard → start in **Test mode**.
2. *Developers › API keys* → copy the secret key into `STRIPE_SECRET_KEY`.
3. *Developers › Webhooks › Add endpoint*
   - URL: `https://www.habitatstudio.co.uk/api/stripe/webhook` (your `PUBLIC_URL` + `/api/stripe/webhook`)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. *Settings › Public details / Branding*: business name and statement descriptor as customers should see them.
5. Apply: `docker compose up -d app`. *System health › Stripe payments* shows "TEST MODE".

## 9. Configure SMTP

Fill `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` (see NETWORK.md › SMTP), then `docker compose up -d app`.

## 10. Test a booking

On a phone (mobile data, to test from outside): open the booking page, choose a room, date, time and equipment, enter real contact details, and continue to payment.

## 11. Test a Stripe payment

Still in Stripe **test mode**, pay with card `4242 4242 4242 4242`, any future expiry, any CVC. Then check:

- the return page switches to "You're booked in" within a few seconds (that's the webhook arriving);
- *Admin › Bookings* shows it **Confirmed** and **Paid**; it's on the *Calendar*;
- *Stripe › Webhooks* shows a `200` response;
- try booking the same slot again — it's not offered; try more equipment than you own — it's refused.

Cancel it from the admin with a full refund and confirm the refund appears in Stripe.

When everything works, switch Stripe to **Live mode**, replace both keys (live secret key + live webhook endpoint's secret), restart the app, and make one small real booking to confirm, then refund it.

## 12. Test email delivery

*Admin › Email* → *Check SMTP connection* → *Send test* to your own address. The test booking in step 11 should also have produced a confirmation (with calendar invite) and a staff notification.

## 13. Test backups

```bash
deploy/scripts/backup.sh
ls -lh backups/
```

*Admin › System health › Backups* shows the file. Then rehearse a restore **before** go-live (it's safe now: there's no real data yet):

```bash
deploy/scripts/restore.sh <the file you just made>
```

Set up off-site copies (OPERATIONS.md) and you're live.

---

## Optional: connect to ApexBook

In ApexBook admin › Systems › Habitat's system › *Monitoring agent* → **Issue agent token**. Put the two lines it shows into `.env` (`APEXBOOK_API_URL`, `APEXBOOK_AGENT_TOKEN`) and `docker compose up -d app`. Within 5 minutes ApexBook shows the system as reporting. Bookings never depend on this.

## Development (ApexBook engineers only)

```bash
npm install
cp .env.example .env    # set DATABASE_URL / TEST_DATABASE_URL to a local Postgres, NODE_ENV=development,
                        # PUBLIC_URL=http://localhost:5174, API_PORT=4010
npm run db:migrate
npm run db:seed-dev     # DEV-labelled rooms/equipment + dev-admin@habitat.local / Habitat-dev-admin-1 — never in production
npm run dev             # site on http://localhost:5174, admin on /admin
npm test
npm run build && npm run smoke
```

---

## Raspberry Pi notes

1. **Flash the OS:** in Raspberry Pi Imager choose *Raspberry Pi OS Lite (64-bit)*, and in its settings set the hostname (e.g. `habitat`), a user and password, and enable SSH. Write it to the SSD.
2. **Boot from the SSD:** on a Pi 5 it boots from USB/NVMe out of the box. On a Pi 4, update the bootloader once (`sudo rpi-eeprom-update -a`, then reboot) if it doesn't.
3. **Give it a fixed address:** reserve its IP in the router's DHCP settings so port forwarding (NETWORK.md) keeps pointing at it.
4. **Update and install Docker:** `sudo apt update && sudo apt full-upgrade -y`, then step 1 above.
5. **The first build takes a while:** 10–20 minutes on a Pi for `install.sh` (it compiles the app). Later updates are quicker.
6. **Power cuts:** the services restart by themselves when the Pi boots. A small UPS avoids unclean shutdowns; backups run nightly either way (OPERATIONS.md), and copying them off the Pi is strongly recommended.

## Updating later

```bash
cd /opt/habitat
git pull
deploy/scripts/update.sh      # backup → new version → migrate → verify
```
