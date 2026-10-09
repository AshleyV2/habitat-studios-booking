# Network, HTTPS and firewall

## Recommended layout

```
Internet ──► Habitat router ──(80, 443)──► Habitat server
                                            └─ Docker: proxy (Caddy) ─► app ─► postgres (internal only)
Studio LAN (office PC, tablets) ──────────────► same server, same https:// address
```

## Ports

| Port | Where | Why | Open to the internet? |
|---|---|---|---|
| 443/tcp (+443/udp) | proxy | HTTPS for customers, staff and Stripe webhooks | **Yes** (router port-forward) |
| 80/tcp | proxy | Let's Encrypt certificate issuance + redirect to HTTPS | **Yes** |
| 8080/tcp | app | Only on `127.0.0.1` for a host-level nginx/Apache | No |
| 5432/tcp | postgres | Not published at all (internal Docker network) | **Never** |

Outbound the server needs: 443 to `api.stripe.com`, your SMTP port (587/465) to your mail provider, 443 to ApexBook (optional), and DNS.

Firewall (Ubuntu example):

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Docker publishes ports itself; the only published ports in `docker-compose.yml` are 80/443 (Caddy) and 127.0.0.1:8080.

## Domain and HTTPS

1. At the DNS provider for habitatstudio.co.uk, point **both** `www` and the bare domain (`@`) at Habitat's public IP with A records (use a static IP, or a DDNS name with a CNAME for `www` if the IP changes). Lower the TTL a day before switching so the move from the old website is quick. Keep the domain's **MX records unchanged** so email is unaffected.
2. On the router, forward TCP 80 and 443 (and UDP 443) to the server's LAN IP. Give the server a fixed LAN IP (DHCP reservation).
3. In `.env`: `PUBLIC_URL=https://www.habitatstudio.co.uk`, `HABITAT_DOMAIN=www.habitatstudio.co.uk`, `COMPOSE_PROFILES=caddy`, `TRUST_PROXY=1`.
4. To redirect the bare domain to `www`, uncomment the `habitatstudio.co.uk` block in `deploy/caddy/Caddyfile`.
5. `docker compose up -d` — Caddy gets and renews the certificates automatically.

### Under a path of another website instead

If a separate website should keep the domain and host the booking system under a path, e.g. `https://www.example-main-site.co.uk/book`:

- `.env`: `PUBLIC_URL=https://www.example-main-site.co.uk/book`, `COMPOSE_PROFILES=` (empty, no Caddy), `TRUST_PROXY=1`.
- On the web server, proxy `/book/` to this server's port 8080 **without stripping the prefix** (examples in `deploy/nginx/habitat.conf` and `deploy/apache/habitat.conf`). If the web server is a different machine, publish the app on the LAN with `APP_BIND=0.0.0.0` and firewall port 8080 to that machine only.

No rebuild is needed — the app reads the path from `PUBLIC_URL`.

### No port forwarding possible (strict firewall / CGNAT): Cloudflare Tunnel

1. In Cloudflare Zero Trust › Networks › Tunnels, create a tunnel and a public hostname `www.habitatstudio.co.uk` → service `http://app:8080`.
2. `.env`: `COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN=…`, `TRUST_PROXY=1`.
3. `docker compose up -d`. No inbound ports are opened; Cloudflare provides HTTPS.

### Behind the Cloudflare proxy (orange cloud) with Caddy

Use SSL mode **Full (strict)**. Set `TRUST_PROXY=2` only if Cloudflare is the only thing that can reach port 443 (restrict the firewall to Cloudflare's IP ranges); otherwise keep 1.

## Stripe webhooks

Stripe must reach `https://<PUBLIC_URL>/api/stripe/webhook` from the internet over HTTPS (port 443, valid certificate). With any of the setups above this works as-is. The endpoint:

- needs no login, but **every request is signature-verified** with `STRIPE_WEBHOOK_SECRET`; unsigned or altered requests are rejected;
- is idempotent — Stripe's retries are safe.

If the internet connection drops, Stripe retries webhooks for up to 3 days, and the app's reconciliation job asks Stripe directly about unpaid holds every 5 minutes once it's back, so paid bookings are confirmed either way.

Do **not** expose the webhook through a separate unauthenticated port or tunnel just for Stripe.

## LAN access for staff

Staff should use the same `https://www.habitatstudio.co.uk/admin` address on the studio network. Two ways to make that work locally:

- **Router hairpin NAT** — many routers route the public address back inside automatically. Try it first.
- **Local DNS override** — if not, point `www.habitatstudio.co.uk` at the server's LAN IP in the router's DNS (or the Pi-hole/local DNS server). Certificates stay valid because the name is the same.

Plain `http://192.168.x.x` does **not** work in production: sign-in cookies are Secure-only by design.

For a LAN-only name (e.g. `habitat.lan`), enable the commented `tls internal` block in `deploy/caddy/Caddyfile`, install Caddy's root certificate on each device, and add `https://habitat.lan` to `ADDITIONAL_ORIGINS`.

Only the *public* booking page needs to be reachable from outside; `/admin` is protected by staff sign-in, rate limits and CSRF protection.

## SMTP connectivity

Use an authenticated submission service (Microsoft 365, Google Workspace, Fastmail, Postmark, SendGrid, Mailgun, your web host…):

| Provider type | SMTP_PORT | SMTP_SECURITY |
|---|---|---|
| Most (submission) | 587 | starttls |
| Implicit TLS | 465 | tls |
| LAN relay without auth | 25 or 2525 | none (LAN only) |

Some ISPs block outbound 25; 587/465 are rarely blocked. Set SPF/DKIM for the sending domain at the provider so confirmations don't land in spam. Test from *Admin › Email*.
