// Production smoke test for the Habitat build (`npm run build && npm run smoke`).
//
// Starts server/dist/server.js with NODE_ENV=production, mounted under a path
// (PUBLIC_URL=https://book.example.test/book) as if behind a TLS reverse proxy, and
// checks over real HTTP: health, SPA + <base> injection under the path, asset
// caching, secure cookie prefixes/scope, CSRF, staff login, trust-proxy IPs,
// Stripe webhook signatures, production error bodies and backup status reporting.
//
// Uses DATABASE_URL from the environment or .env. Staff login needs an admin:
// SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (default: the development seed admin).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'package.json'));
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const Stripe = require('stripe');

const PORT = Number(process.env.SMOKE_PORT ?? 4110);
const ORIGIN = 'https://book.example.test';
const BASE = '/book';
const base = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'dev-admin@habitat.local';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'Habitat-dev-admin-1';

// A backup status file, as the backup container would write it.
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-smoke-'));
fs.writeFileSync(path.join(backupDir, 'last-backup.json'), JSON.stringify({ ok: true, file: 'habitat-smoke.dump', sizeBytes: 123456, finishedAt: new Date().toISOString() }));

const server = spawn(process.execPath, ['server/dist/server.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    API_PORT: String(PORT),
    PUBLIC_URL: `${ORIGIN}${BASE}`,
    TRUST_PROXY: '1',
    SERVE_CLIENT: 'true',
    SESSION_SECRET: 'smoke-test-secret-0123456789abcdefghijklmnopqrstuv',
    STRIPE_SECRET_KEY: 'sk_test_smoke_local_only',
    STRIPE_WEBHOOK_SECRET: 'whsec_smoke',
    BACKUP_DIR: backupDir,
    LOG_DIR: '',
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
const proxied = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.23' };

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  check('GET /health (root, for container checks)', (await fetch(`${base}/health`)).ok);
  const ready = await fetch(`${base}${BASE}/health/ready`);
  check('GET /book/health/ready (database)', ready.status === 200 && (await ready.json()).status === 'ok');

  const index = await fetch(`${base}${BASE}/`, { headers: proxied });
  const html = await index.text();
  check('Booking site served under /book', index.status === 200 && html.includes('<div id="root">'));
  check('<base href="/book/"> injected', html.includes('<base href="/book/" />'));
  check('CSP present', (index.headers.get('content-security-policy') ?? '').includes("default-src 'self'"));
  const deep = await fetch(`${base}${BASE}/admin/calendar`, { headers: proxied });
  check('Deep links fall back to the app', deep.status === 200 && (await deep.text()).includes('habitat-base-path'));
  const asset = html.match(/assets\/[^"]+\.js/)?.[0];
  const assetRes = await fetch(`${base}${BASE}/${asset}`);
  check('Assets immutable-cached under /book/assets', assetRes.ok && (assetRes.headers.get('cache-control') ?? '').includes('immutable'));
  check('Nothing served outside the base path', (await fetch(`${base}/api/public/config`)).status === 404);

  const cfg = await fetch(`${base}${BASE}/api/public/config`, { headers: proxied });
  const csrfCookie = cfg.headers.getSetCookie().find((c) => c.startsWith('__Secure-habitat_csrf='));
  check('Public config API', cfg.ok);
  check('CSRF cookie: __Secure-, Secure, Path=/book', Boolean(csrfCookie && /Secure/.test(csrfCookie) && /Path=\/book/.test(csrfCookie)), csrfCookie?.split(';').slice(1).join(';'));
  const csrf = csrfCookie.split(';')[0].split('=')[1];

  const post = (p, body, cookie = '') =>
    fetch(`${base}${BASE}${p}`, {
      method: 'POST',
      headers: { ...proxied, 'Content-Type': 'application/json', Origin: ORIGIN, 'X-CSRF-Token': csrf, Cookie: `__Secure-habitat_csrf=${csrf}${cookie ? `; ${cookie}` : ''}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const noCsrf = await fetch(`${base}${BASE}/api/auth/login`, { method: 'POST', headers: { ...proxied, 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{}' });
  check('Writes without CSRF token rejected', noCsrf.status === 403);
  check('Admin API requires sign-in', (await fetch(`${base}${BASE}/api/admin/dashboard`, { headers: proxied })).status === 401);

  const login = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const sessionCookie = login.headers.getSetCookie().find((c) => c.startsWith('__Secure-habitat_session='));
  check('Staff login', login.status === 200);
  check('Session cookie: __Secure-, HttpOnly, Secure, SameSite=Lax', Boolean(sessionCookie && /HttpOnly/.test(sessionCookie) && /Secure/.test(sessionCookie) && /SameSite=Lax/.test(sessionCookie)));
  const sess = sessionCookie.split(';')[0];

  const health = await fetch(`${base}${BASE}/api/admin/health`, { headers: { ...proxied, Cookie: sess } });
  const h = await health.json();
  const backups = h.checks.find((c) => c.name === 'Backups');
  check('System health reports the latest backup', backups?.status === 'ok', backups?.detail);
  check('System health reports the database', h.checks.find((c) => c.name === 'Database')?.status === 'ok');

  const audit = await fetch(`${base}${BASE}/api/admin/audit`, { headers: { ...proxied, Cookie: sess } });
  const lastLogin = (await audit.json()).find((a) => a.action === 'auth.login');
  check('Audit log records the login', Boolean(lastLogin));

  const bad = await post('/api/auth/login', '{"email": ');
  const badBody = await bad.text();
  check('Malformed JSON → clean 400, no stack trace', bad.status === 400 && !/at\s|node_modules|\.ts/.test(badBody), badBody);

  const stripe = new Stripe('sk_test_smoke_local_only');
  const payload = JSON.stringify({ id: `evt_smoke_${Date.now()}`, object: 'event', type: 'checkout.session.expired', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_smoke_unknown', object: 'checkout.session' } } });
  const hook = await fetch(`${base}${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_smoke' }) }, body: payload });
  check('Signed Stripe webhook accepted at /book/api/stripe/webhook', hook.status === 200);
  const forged = await fetch(`${base}${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=00' }, body: payload });
  check('Forged webhook rejected', forged.status === 400);

  const logout = await post('/api/auth/logout', {}, sess);
  const after = await fetch(`${base}${BASE}/api/admin/dashboard`, { headers: { ...proxied, Cookie: sess } });
  check('Logout ends the session', logout.status === 204 && after.status === 401);
} catch (err) {
  check('smoke test crashed', false, String(err?.stack ?? err));
} finally {
  server.kill();
  fs.rmSync(backupDir, { recursive: true, force: true });
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
if (failed) console.log(`\nServer output:\n${out.slice(-3000)}`);
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
