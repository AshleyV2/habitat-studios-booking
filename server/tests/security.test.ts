import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { redactTokens } from '../src/app';
import { sanitise } from '../src/services/audit.service';
import { app, Client, configureStudio, createStaff, PASSWORD, prisma, publicClient, resetDb, staffClient } from './helpers';

beforeEach(async () => {
  await resetDb();
  await configureStudio();
  await createStaff('admin@studio.test');
});

describe('staff authentication', () => {
  it('uses Argon2id, HTTP-only cookies and hashed session tokens', async () => {
    const c = await publicClient();
    const res = await c.post('/api/auth/login', { email: 'admin@studio.test', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('habitat_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const raw = /habitat_session=([^;]+)/.exec(cookie)![1]!;
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@studio.test' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(raw);
  });

  it('gives the same error for a wrong password and an unknown account', async () => {
    const c = await publicClient();
    const a = await c.post('/api/auth/login', { email: 'admin@studio.test', password: 'wrong password!!' });
    const b = await c.post('/api/auth/login', { email: 'nobody@studio.test', password: 'wrong password!!' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('logout ends the session on the server', async () => {
    const c = await staffClient('admin@studio.test');
    expect((await c.get('/api/admin/dashboard')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/admin/dashboard')).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('disabled staff are locked out immediately', async () => {
    const c = await staffClient('admin@studio.test');
    await prisma.staffUser.update({ where: { email: 'admin@studio.test' }, data: { disabledAt: new Date() } });
    expect((await c.get('/api/admin/dashboard')).status).toBe(401);
  });
});

describe('CSRF and origins', () => {
  it('rejects writes without the CSRF token', async () => {
    const res = await supertest(app).post('/api/auth/login').set('Origin', 'https://book.example-studio.test').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects foreign origins but accepts the configured LAN origin', async () => {
    const c = await new Client().init();
    const foreign = await c.agent.post('/api/auth/login').set('Origin', 'https://evil.test').set('X-CSRF-Token', c.csrf).send({ email: 'admin@studio.test', password: PASSWORD });
    expect(foreign.status).toBe(403);
    const lan = await c.agent.post('/api/auth/login').set('Origin', 'https://studio.lan').set('X-CSRF-Token', c.csrf).send({ email: 'admin@studio.test', password: PASSWORD });
    expect(lan.status).toBe(200);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and serves health without detail', async () => {
    const res = await supertest(app).get('/health');
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect((await supertest(app).get('/health/ready')).body).toEqual({ status: 'ok' });
  });

  it('never returns hashes or salts', async () => {
    const c = await staffClient('admin@studio.test');
    const staff = await c.get('/api/admin/staff');
    expect(JSON.stringify(staff.body)).not.toMatch(/argon2|passwordHash/);
    const bookings = await c.get('/api/admin/bookings');
    expect(JSON.stringify(bookings.body)).not.toMatch(/manageSalt/);
  });

  it('redacts tokens from logged URLs and secrets from audit metadata', () => {
    expect(redactTokens('/booking/HAB-ABC123?token=secret&x=1')).toBe('/booking/HAB-ABC123?token=[redacted]&x=1');
    expect(redactTokens('/booking/HAB-ABC123?session_id=cs_1')).toBe('/booking/HAB-ABC123?session_id=[redacted]');
    expect(sanitise({ password: 'x', nested: { manageSalt: 'y', ok: 1 } })).toEqual({ nested: { ok: 1 } });
  });

  it('rejects malformed input cleanly', async () => {
    const c = await publicClient();
    const res = await c.get('/api/public/availability?roomId=x&date=not-a-date');
    expect(res.status).toBe(400);
    const sql = await c.get(`/api/public/availability?roomId=${encodeURIComponent("' OR 1=1 --")}&date=2026-10-01`);
    expect(sql.status).toBe(404);
  });
});
