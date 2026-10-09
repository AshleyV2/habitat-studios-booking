import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { createStaff, prisma, publicClient, resetDb } from './helpers';

const TOKEN = 'setup-token-0123456789abcdef';
const setEnvToken = (v: string | undefined) => ((env as { SETUP_TOKEN?: string }).SETUP_TOKEN = v);
const body = (over: object = {}) => ({
  token: TOKEN,
  businessName: 'Riffs Rehearsal Rooms',
  timezone: 'Europe/London',
  contactEmail: '',
  contactPhone: '0161 000 0000',
  adminName: 'Robin Riff',
  adminEmail: 'Robin@Riffs.test',
  password: 'a long enough password',
  ...over,
});

beforeEach(async () => {
  await resetDb();
  setEnvToken(TOKEN);
});
afterEach(() => setEnvToken(undefined));

describe('first-run setup', () => {
  it('is required on a fresh install, creates the admin and business, signs them in, then closes', async () => {
    const c = await publicClient();
    expect((await c.get('/api/auth/setup')).body).toMatchObject({ required: true, timezone: 'Europe/London' });
    expect((await c.post('/api/auth/setup', body({ token: 'wrong-token-0123456789abc' }))).status).toBe(403);

    const res = await c.post('/api/auth/setup', body());
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'robin@riffs.test', role: 'ADMIN' });
    expect((await c.get('/api/me')).status).toBe(200);
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings).toMatchObject({ businessName: 'Riffs Rehearsal Rooms', contactEmail: 'robin@riffs.test', contactPhone: '0161 000 0000', adminNotifyEmail: 'robin@riffs.test' });

    // Done for good: the same link can't create another admin.
    expect((await c.get('/api/auth/setup')).body).toEqual({ required: false });
    const again = await (await publicClient()).post('/api/auth/setup', body({ adminEmail: 'mallory@x.test' }));
    expect(again.status).toBe(409);
    expect(await prisma.staffUser.count()).toBe(1);
  });

  it('is never offered without a setup token, or once an admin exists', async () => {
    setEnvToken(undefined);
    const c = await publicClient();
    expect((await c.get('/api/auth/setup')).body).toEqual({ required: false });
    expect((await c.post('/api/auth/setup', body())).status).toBe(403);
    setEnvToken(TOKEN);
    await createStaff('ada@studio.test');
    expect((await c.get('/api/auth/setup')).body).toEqual({ required: false });
  });

  it('validates the details', async () => {
    const c = await publicClient();
    const res = await c.post('/api/auth/setup', body({ password: 'short', timezone: 'Mars/Base' }));
    expect(res.status).toBe(400);
    expect(await prisma.staffUser.count()).toBe(0);
  });
});
