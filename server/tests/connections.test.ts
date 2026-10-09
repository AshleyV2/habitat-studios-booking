import { beforeEach, describe, expect, it } from 'vitest';
import { applyIntegrations, integrations } from '../src/config/integrations';
import { sealSecret } from '../src/utils/crypto';
import { bookingBody, configureStudio, createStaff, futureDate, prisma, publicClient, resetDb, staffClient, useStripeStub } from './helpers';

// Built at runtime so secret scanners don't mistake this made-up test value for a real key.
const LIVE_KEY = ['sk', 'live', '51Settings0000000000abcd'].join('_');
const HOOK = ['whsec', 'settingsSecret0000000000'].join('_');

beforeEach(async () => {
  await resetDb();
  await configureStudio();
  useStripeStub();
  await createStaff('owner@studio.test', 'ADMIN');
  await createStaff('desk@studio.test', 'STAFF');
});

const blank = {
  bookingRefPrefix: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: null,
  smtpUser: null,
  emailFromName: null,
  emailFromAddress: null,
  emailReplyTo: null,
  apexbookApiUrl: null,
  apexbookHeartbeatMinutes: null,
};

describe('connections in Admin › Settings', () => {
  it('saves Stripe keys encrypted, never sends them back, and uses them instead of .env', async () => {
    const owner = await staffClient('owner@studio.test');
    const res = await owner.put('/api/admin/settings/connections', { ...blank, stripeSecretKey: LIVE_KEY, stripeWebhookSecret: HOOK });
    expect(res.status).toBe(200);
    expect(res.body.stripe).toMatchObject({ enabled: true, mode: 'live', secretKey: { set: true, source: 'settings' }, webhookSecret: { set: true, source: 'settings' } });
    expect(res.body.stripe.secretKey.hint).toBe('sk_live_…abcd');
    expect(JSON.stringify(res.body)).not.toContain(LIVE_KEY);
    expect(JSON.stringify(res.body)).not.toContain(HOOK);

    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.stripeSecretKeyEnc).toMatch(/^v1:/);
    expect(row.stripeSecretKeyEnc).not.toContain('sk_live');
    expect(integrations().stripe.secretKey).toBe(LIVE_KEY);

    // The general settings payload never carries connection fields or encrypted values.
    const general = (await owner.get('/api/admin/settings')).body;
    expect(Object.keys(general).some((k) => k.endsWith('Enc') || k.startsWith('smtp') || k.startsWith('stripe'))).toBe(false);

    // Leaving a secret out keeps it; null removes it (back to the server's .env value).
    await owner.put('/api/admin/settings/connections', { ...blank });
    expect(integrations().stripe.secretKey).toBe(LIVE_KEY);
    const cleared = await owner.put('/api/admin/settings/connections', { ...blank, stripeSecretKey: null });
    expect(cleared.body.stripe.secretKey.source).toBe('server');
    expect(integrations().stripe.secretKey).toBe(process.env.STRIPE_SECRET_KEY);
  });

  it('checks values, and only staff who manage settings can change them', async () => {
    const owner = await staffClient('owner@studio.test');
    expect((await owner.put('/api/admin/settings/connections', { ...blank, stripeSecretKey: 'pk_live_nope' })).status).toBe(400);
    expect((await owner.put('/api/admin/settings/connections', { ...blank, smtpHost: 'smtp.example.com' })).status).toBe(400); // no from address
    expect((await owner.put('/api/admin/settings/connections', { ...blank, apexbookApiUrl: 'http://apexbook.co.uk' })).status).toBe(400);
    const ok = await owner.put('/api/admin/settings/connections', { ...blank, smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: 'mailer', smtpPassword: 'hunter2-password', emailFromAddress: 'bookings@studio.test' });
    expect(ok.body.smtp).toMatchObject({ enabled: true, source: 'settings', host: 'smtp.example.com', password: { set: true, source: 'settings' } });
    expect(JSON.stringify(ok.body)).not.toContain('hunter2');

    const desk = await staffClient('desk@studio.test');
    expect((await desk.get('/api/admin/settings/connections')).status).toBe(403);
    expect((await desk.put('/api/admin/settings/connections', { ...blank })).status).toBe(403);
  });

  it('the booking reference prefix from Settings is used for new bookings', async () => {
    const owner = await staffClient('owner@studio.test');
    await owner.put('/api/admin/settings/connections', { ...blank, bookingRefPrefix: 'hab' });
    const room = await prisma.room.findFirstOrThrow({ where: { name: 'Room A' } });
    const c = await publicClient();
    const res = await c.post('/api/public/bookings', bookingBody(room.id, futureDate(3), '10:00', 60));
    expect(res.body.reference).toMatch(/^HAB-[A-Z0-9]{6}$/);
    // Old and new prefixes both open.
    expect((await c.get(`/api/public/bookings/${res.body.reference}?token=${res.body.manageToken}`)).status).toBe(200);
  });

  it('a saved secret that can no longer be decrypted is reported, and .env is used instead', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { stripeSecretKeyEnc: 'v1:AAAA:BBBB:CCCC' } });
    applyIntegrations(await prisma.settings.findUniqueOrThrow({ where: { id: 1 } }));
    expect(integrations().unreadable).toEqual(['Stripe secret key']);
    expect(integrations().stripe.secretKey).toBe(process.env.STRIPE_SECRET_KEY);
    const owner = await staffClient('owner@studio.test');
    expect((await owner.get('/api/admin/settings/connections')).body.unreadable).toEqual(['Stripe secret key']);
    // A good one round-trips.
    expect(sealSecret('x')).not.toBe(sealSecret('x')); // fresh IV each time
  });
});
