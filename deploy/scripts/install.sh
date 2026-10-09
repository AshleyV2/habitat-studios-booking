#!/usr/bin/env bash
# First installation on Habitat's server. Safe to re-run: it never deletes data.
source "$(dirname "$0")/common.sh"
require_docker

if [ ! -f .env ]; then
  step "Creating .env with fresh secrets"
  cp .env.example .env
  secret() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48; }
  sed -i.bak -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(secret)|" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" .env && rm -f .env.bak
  chmod 600 .env
  echo "Created .env. Now edit it (PUBLIC_URL, HABITAT_DOMAIN, Stripe, SMTP) — see docs/INSTALL.md step 3 —"
  echo "then run this script again."
  exit 0
fi

step "Checking configuration"
for v in PUBLIC_URL SESSION_SECRET POSTGRES_PASSWORD; do
  [ -n "$(env_value "$v")" ] || die "$v is empty in .env"
done
case "$(env_value COMPOSE_PROFILES)" in *caddy*) [ -n "$(env_value HABITAT_DOMAIN)" ] || die "HABITAT_DOMAIN is required when using the bundled Caddy proxy";; esac
[ -n "$(env_value STRIPE_SECRET_KEY)" ] || echo "  note: Stripe not configured yet — online booking will show as unavailable until it is."
[ -n "$(env_value SMTP_HOST)" ] || echo "  note: SMTP not configured yet — emails will queue until it is."

mkdir -p backups
chmod 700 backups

step "Building and starting services (this can take a few minutes the first time)"
docker compose up -d --build

wait_healthy

step "Done"
cat <<MSG
The booking system is running.

Next: create the first administrator (you'll be asked for a password):

  docker compose exec -it app node server/dist/create-admin.js --email you@habitatstudio.co.uk --name "Your Name"

Then sign in at $(env_value PUBLIC_URL)/admin and follow docs/INSTALL.md from step 6.
MSG
