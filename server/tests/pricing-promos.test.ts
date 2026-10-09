import { beforeEach, describe, expect, it } from 'vitest';
import { bookingBody, configureStudio, createStaff, futureDate, prisma, publicClient, resetDb, staffClient, useStripeStub } from './helpers';
import { addDays, toLocal } from '../src/utils/time';

let studio: Awaited<ReturnType<typeof configureStudio>>;
let stripe: ReturnType<typeof useStripeStub>;
const date = futureDate(3);
const today = () => toLocal(new Date(), 'Europe/London').date;

beforeEach(async () => {
  await resetDb();
  studio = await configureStudio(); // Room A £15/h, Room B £10/h, 30-min slots, 1 h minimum
  stripe = useStripeStub();
});

const slot = (roomId: string, startTime: string, durationMinutes: number, extra: object = {}) => ({ roomId, date, startTime, durationMinutes, equipment: [], ...extra });

async function quote(body: object) {
  const c = await publicClient();
  return c.post('/api/public/quote', body);
}

async function promoAdmin() {
  await createStaff('owner@studio.test', 'ADMIN');
  return staffClient('owner@studio.test');
}

const promo = (overrides: object = {}) => ({
  code: 'save10',
  description: 'Ten percent off',
  kind: 'PERCENT',
  value: 10,
  active: true,
  validFrom: null,
  validUntil: null,
  maxUses: null,
  onePerCustomer: false,
  roomIds: [],
  minSpendPence: null,
  minDurationMinutes: null,
  ...overrides,
});

describe('cheaper for longer', () => {
  it('takes the best matching % off the room (not equipment), shown as its own line', async () => {
    await prisma.room.update({ where: { id: studio.roomA.id }, data: { lengthDiscounts: [{ fromMinutes: 180, percentOff: 10 }, { fromMinutes: 300, percentOff: 20 }] } });
    expect((await quote(slot(studio.roomA.id, '10:00', 120))).body).toMatchObject({ totalPence: 3000, discountPence: 0 });

    const three = await quote(slot(studio.roomA.id, '10:00', 180, { equipment: [{ equipmentId: studio.mic.id, quantity: 1 }] }));
    expect(three.body).toMatchObject({ roomSubtotalPence: 4500, equipmentSubtotalPence: 300, discountPence: 450, totalPence: 4350 });
    expect(three.body.lines.find((l: { kind: string }) => l.kind === 'discount')).toMatchObject({ amountPence: -450 });
    expect(three.body.lines.find((l: { kind: string }) => l.kind === 'discount').description).toContain('10% off bookings of 3 h');

    expect((await quote(slot(studio.roomA.id, '10:00', 300))).body).toMatchObject({ discountPence: 1500, totalPence: 6000 });
  });
});

describe('minimum booking length per room', () => {
  it('refuses shorter bookings for that room only, and availability follows it', async () => {
    await prisma.room.update({ where: { id: studio.roomA.id }, data: { minDurationMinutes: 120 } });
    const short = await quote(slot(studio.roomA.id, '10:00', 60));
    expect(short.status).toBe(400);
    expect(short.body.error.message).toContain('between 2 and 8 hours');
    expect((await quote(slot(studio.roomA.id, '10:00', 120))).status).toBe(200);
    expect((await quote(slot(studio.roomB.id, '10:00', 60))).status).toBe(200);

    const c = await publicClient();
    const avail = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    expect(avail.body.starts.at(-1).time).toBe('21:00'); // 2 h before the 23:00 close
    const rooms = await c.get('/api/public/rooms');
    expect(rooms.body.find((r: { id: string }) => r.id === studio.roomA.id).minDurationMinutes).toBe(120);
    expect(rooms.body.find((r: { id: string }) => r.id === studio.roomB.id).minDurationMinutes).toBe(60);
  });
});

describe('promo codes', () => {
  it('staff create codes; a valid code (any case) comes off the price and is charged; a bad one is explained', async () => {
    const staff = await promoAdmin();
    const created = await staff.post('/api/admin/promo-codes', promo());
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('SAVE10');
    expect((await staff.post('/api/admin/promo-codes', promo())).status).toBe(409);
    expect((await staff.post('/api/admin/promo-codes', promo({ code: 'BIG', value: 150 }))).status).toBe(400);

    const ok = await quote(slot(studio.roomA.id, '10:00', 120, { promoCode: 'save10' }));
    expect(ok.body).toMatchObject({ totalPence: 2700, discountPence: 300, promo: { code: 'SAVE10' }, promoError: null });
    const bad = await quote(slot(studio.roomA.id, '10:00', 120, { promoCode: 'NOPE' }));
    expect(bad.body).toMatchObject({ totalPence: 3000, promo: null });
    expect(bad.body.promoError).toContain('isn’t a valid promo code');

    const c = await publicClient();
    const booked = await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '10:00', 120), promoCode: 'SAVE10' });
    expect(booked.status).toBe(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: booked.body.reference } });
    expect(b).toMatchObject({ totalPence: 2700, discountPence: 300, promoCode: 'SAVE10', status: 'PENDING_PAYMENT' });
    const session = [...stripe.sessions.values()].at(-1)!;
    expect(session.amount_total).toBe(2700);
    // Stripe rejects negative line items: a discounted booking is one item, with the breakdown in its description.
    const items = session.params.line_items ?? [];
    expect(items).toHaveLength(1);
    const product = items[0]?.price_data?.product_data;
    expect(product?.name).toMatch(/^Booking [A-Z]+-[A-Z0-9]{6} — Room A$/);
    expect(product?.description).toMatch(/Promo code .+: −£/);
    expect((await staff.get('/api/admin/promo-codes')).body[0].uses).toBe(1);
    // A bad code when booking stops the booking rather than charging full price.
    expect((await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '15:00', 120), promoCode: 'NOPE' })).status).toBe(400);
  });

  it('enforces dates, rooms, minimum spend and length, total uses and one per customer', async () => {
    const staff = await promoAdmin();
    await staff.post('/api/admin/promo-codes', promo({ code: 'OLD', validUntil: addDays(today(), -1) }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'SOON', validFrom: addDays(today(), 5) }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'ROOMB', roomIds: [studio.roomB.id] }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'BIGSPEND', minSpendPence: 5000 }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'LONG', minDurationMinutes: 180 }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'ONCE', maxUses: 1 }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'MINE', onePerCustomer: true }));
    await staff.post('/api/admin/promo-codes', promo({ code: 'OFF', active: false }));

    const err = async (code: string, minutes = 120, roomId = studio.roomA.id) => (await quote(slot(roomId, '10:00', minutes, { promoCode: code }))).body.promoError as string | null;
    expect(await err('OLD')).toContain('expired');
    expect(await err('SOON')).toContain('can be used from');
    expect(await err('ROOMB')).toContain('this room');
    expect(await err('ROOMB', 120, studio.roomB.id)).toBeNull();
    expect(await err('BIGSPEND')).toContain('£50.00 or more');
    expect(await err('LONG')).toContain('3 hours or more');
    expect(await err('LONG', 180)).toBeNull();
    expect(await err('OFF')).toContain('isn’t a valid');

    const c = await publicClient();
    expect((await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '10:00', 60), promoCode: 'ONCE' })).status).toBe(201);
    const second = await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '12:00', 60), promoCode: 'ONCE', customer: { name: 'Sam', email: 'sam@band.test', phone: '07700 900999' } });
    expect(second.status).toBe(400);
    expect(second.body.error.message).toContain('fully used');

    expect((await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '14:00', 60), promoCode: 'MINE' })).status).toBe(201);
    const again = await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '16:00', 60), promoCode: 'MINE' });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toContain('already used');
  });

  it('a code that covers everything confirms the booking without payment', async () => {
    const staff = await promoAdmin();
    await staff.post('/api/admin/promo-codes', promo({ code: 'FREEJAM', kind: 'FIXED', value: 10_000 }));
    const sessionsBefore = stripe.sessions.size;
    const c = await publicClient();
    const res = await c.post('/api/public/bookings', { ...bookingBody(studio.roomA.id, date, '10:00', 120), promoCode: 'FREEJAM' });
    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toBeNull();
    expect(res.body.reference).toMatch(/^BK-[A-Z0-9]{6}$/); // ApexBook's default prefix (BOOKING_REF_PREFIX)
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
    expect(b).toMatchObject({ status: 'CONFIRMED', totalPence: 0, discountPence: 3000, expiresAt: null });
    expect(stripe.sessions.size).toBe(sessionsBefore);
    expect(await prisma.emailMessage.count({ where: { to: 'jo@band.test' } })).toBe(1);
  });
});
