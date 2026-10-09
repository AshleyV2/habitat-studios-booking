import { beforeEach, describe, expect, it } from 'vitest';
import { sealSecret } from '../src/utils/crypto';
import { bookingBody, configureStudio, createStaff, futureDate, prisma, publicClient, resetDb, staffClient, useStripeStub, type Client } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const ORIGIN = 'https://book.example-studio.test';

async function uploadPhoto(c: Client, url: string, body: Buffer, name = 'logo.png') {
  return c.agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', c.csrf).set('Content-Type', 'image/png').set('X-Filename', name).send(body);
}

/** Build a studio with a bit of everything, and export it. */
async function exportedSetup() {
  const studio = await configureStudio();
  await createStaff('owner@studio.test', 'ADMIN');
  const owner = await staffClient('owner@studio.test');
  await owner.post(`/api/admin/rooms/${studio.roomA.id}/price-rules`, { label: 'Evenings', daysOfWeek: [1, 2, 3], startTime: '18:00', endTime: '23:00', hourlyRatePence: 2000 });
  await owner.post('/api/admin/promo-codes', { code: 'roomaonly', kind: 'PERCENT', value: 10, roomIds: [studio.roomA.id] });
  await owner.post('/api/admin/blocks', { roomId: null, startDate: futureDate(10), startTime: '09:00', endDate: futureDate(10), endTime: '23:00', reason: 'Christmas party' });
  const photo = (await uploadPhoto(owner, '/api/admin/site/assets', PNG)).body.id as string;
  const draft = (await owner.get('/api/admin/site/draft')).body;
  draft.doc.pages[0].title = 'Welcome to Test Studio';
  await owner.put('/api/admin/site/draft', { doc: draft.doc, revision: draft.revision });
  expect((await owner.post('/api/admin/site/publish', { note: 'first' })).status).toBe(200);
  // Secrets that must never leave the installation.
  await prisma.settings.update({ where: { id: 1 }, data: { bookingRefPrefix: 'TST', smtpHost: 'smtp.studio.test', smtpUser: 'mailer', emailFromAddress: 'book@studio.test', smtpPasswordEnc: sealSecret('mail-password-123'), stripeSecretKeyEnc: sealSecret('sk_test_secretsecretsecret') } });

  const res = await owner.get('/api/admin/settings/transfer/export');
  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toMatch(/attachment; filename="test-studio-setup-\d{4}-\d{2}-\d{2}\.json"/);
  return { file: res.body, studio, photo };
}

beforeEach(async () => {
  await resetDb();
  useStripeStub();
});

describe('setup transfer (export from one installation, import into another)', () => {
  it('exports the whole setup, but no secrets, bookings or logins', async () => {
    const { file, studio, photo } = await exportedSetup();
    expect(file).toMatchObject({ format: 'apexbook-booking-setup', version: 1, currency: 'gbp', bookingRefPrefix: 'TST' });
    expect(file.settings.businessName).toBe('Test Studio');
    expect(file.email).toMatchObject({ smtpHost: 'smtp.studio.test', smtpUser: 'mailer', emailFromAddress: 'book@studio.test' });
    expect(file.rooms.map((r: { name: string }) => r.name)).toEqual(['Room A', 'Room B']);
    expect(file.rooms[0].priceRules).toEqual([{ label: 'Evenings', daysOfWeek: [1, 2, 3], startTime: '18:00', endTime: '23:00', hourlyRatePence: 2000 }]);
    expect(file.promoCodes[0]).toMatchObject({ code: 'ROOMAONLY', roomIds: [studio.roomA.id] });
    expect(file.closures[0]).toMatchObject({ reason: 'Christmas party', roomId: null });
    expect(file.website.assets[0]).toMatchObject({ id: photo, mime: 'image/png', data: PNG.toString('base64') });
    expect(file.website.builderLive).toBe(true);

    const text = JSON.stringify(file);
    for (const secret of ['mail-password-123', 'sk_test_secret', 'Enc"', 'passwordHash', 'Ada Admin']) expect(text).not.toContain(secret);
  });

  it('imports into another installation: photos first, then the setup replaces what was there', async () => {
    const { file, studio, photo } = await exportedSetup();

    // A fresh installation somewhere else, with a test room that already has a booking.
    await resetDb();
    await prisma.settings.create({ data: { id: 1, businessName: 'New install' } });
    await createStaff('owner@pi.test', 'ADMIN');
    const oldRoom = await prisma.room.create({ data: { name: 'Practice room', hourlyRatePence: 900 } });
    const spare = await prisma.room.create({ data: { name: 'Unused room', hourlyRatePence: 900 } });
    for (let d = 0; d < 7; d++) await prisma.openingHours.create({ data: { dayOfWeek: d, isOpen: true, openMinute: 9 * 60, closeMinute: 23 * 60 } });
    expect((await (await publicClient()).post('/api/public/bookings', bookingBody(oldRoom.id, futureDate(4), '10:00', 60))).status).toBe(201);

    const pi = await staffClient('owner@pi.test');
    const { website, ...rest } = file;
    const setup = { ...rest, website: { ...website, assets: website.assets.map(({ data: _data, ...a }: { data: string }) => a) } };

    // Photos must be uploaded before the setup that uses them.
    expect((await pi.post('/api/admin/settings/transfer/import', { setup, confirm: true })).status).toBe(400);
    expect((await uploadPhoto(pi, `/api/admin/settings/transfer/photos/${photo}`, Buffer.from('not an image'))).status).toBe(400);
    expect((await uploadPhoto(pi, `/api/admin/settings/transfer/photos/${photo}`, Buffer.from(website.assets[0].data, 'base64'))).status).toBe(200);
    expect((await pi.post('/api/admin/settings/transfer/import', { setup })).status).toBe(400); // not confirmed

    const res = await pi.post('/api/admin/settings/transfer/import', { setup, confirm: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rooms: 2, equipment: 2, promoCodes: 1, closures: 1, photos: 1, hiddenRooms: 1 });
    expect(res.body.toEnterAgain.join(' ')).toContain('Email password');

    const s = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(s).toMatchObject({ businessName: 'Test Studio', bookingRefPrefix: 'TST', smtpHost: 'smtp.studio.test', smtpPasswordEnc: null, stripeSecretKeyEnc: null });
    const rooms = await prisma.room.findMany({ include: { priceRules: true }, orderBy: { name: 'asc' } });
    expect(rooms.map((r) => [r.name, r.active])).toEqual([['Practice room', false], ['Room A', true], ['Room B', true]]);
    expect(rooms.find((r) => r.name === 'Room A')).toMatchObject({ id: studio.roomA.id });
    expect(rooms.find((r) => r.name === 'Room A')!.priceRules[0]).toMatchObject({ startMinute: 18 * 60, endMinute: 23 * 60, hourlyRatePence: 2000 });
    expect(await prisma.room.count({ where: { id: spare.id } })).toBe(0);
    expect(await prisma.booking.count()).toBe(1); // bookings untouched
    expect((await prisma.promoCode.findFirstOrThrow()).roomIds).toEqual([studio.roomA.id]);

    // The website comes across live, with its photo.
    const site = (await (await publicClient()).get('/api/public/site')).body;
    expect(JSON.stringify(site)).toContain('Welcome to Test Studio');
    expect((await (await publicClient()).get(`/api/public/site/assets/${photo}`)).status).toBe(200);

    // New bookings use the imported reference prefix.
    const booked = await (await publicClient()).post('/api/public/bookings', bookingBody(studio.roomA.id, futureDate(5), '12:00', 60));
    expect(booked.body.reference).toMatch(/^TST-/);
  });

  it('rejects files that are not setup files, and staff without settings access', async () => {
    const { file } = await exportedSetup();
    const owner = await staffClient('owner@studio.test');
    expect((await owner.post('/api/admin/settings/transfer/import', { setup: { ...file, format: 'something-else' }, confirm: true })).status).toBe(400);
    expect((await owner.post('/api/admin/settings/transfer/import', { setup: { ...file, version: 2 }, confirm: true })).status).toBe(400);

    await createStaff('desk@studio.test', 'STAFF');
    const desk = await staffClient('desk@studio.test');
    expect((await desk.get('/api/admin/settings/transfer/export')).status).toBe(403);
    expect((await desk.post('/api/admin/settings/transfer/import', { setup: file, confirm: true })).status).toBe(403);
  });
});
