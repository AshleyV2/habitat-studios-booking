import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, bookingBody, configureStudio, createStaff, deliverWebhook, futureDate, prisma, publicClient, resetDb, staffClient, useStripeStub } from './helpers';

let studio: Awaited<ReturnType<typeof configureStudio>>;
let stripe: ReturnType<typeof useStripeStub>;
const date = futureDate(4);

beforeEach(async () => {
  await resetDb();
  studio = await configureStudio();
  stripe = useStripeStub();
  await createStaff('admin@studio.test', 'ADMIN');
  await createStaff('staff@studio.test', 'STAFF');
});

const adminBooking = (over: object = {}) => ({
  roomId: studio.roomA.id,
  date,
  startTime: '10:00',
  durationMinutes: 120,
  equipment: [],
  customer: { name: 'Walk In', email: 'walkin@band.test', phone: null, bandName: null },
  sendConfirmation: true,
  ...over,
});

async function paidOnlineBooking() {
  const c = await publicClient();
  const res = await c.post('/api/public/bookings', bookingBody(studio.roomA.id, date, '14:00', 120));
  const session = [...stripe.sessions.values()].at(-1)!;
  await deliverWebhook(stripe.pay(session.id));
  return prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
}

describe('admin API protection', () => {
  it.each(['/api/admin/dashboard', '/api/admin/bookings', '/api/admin/calendar?from=2026-01-01&to=2026-01-07', '/api/admin/customers', '/api/admin/settings', '/api/admin/health'])(
    '%s requires sign-in',
    async (url) => {
      expect((await supertest(app).get(url)).status).toBe(401);
    },
  );

  it('staff cannot change settings, prices, rooms or staff accounts', async () => {
    const s = await staffClient('staff@studio.test');
    expect((await s.get('/api/admin/bookings')).status).toBe(200);
    expect((await s.get('/api/admin/settings')).status).toBe(403);
    expect((await s.put(`/api/admin/rooms/${studio.roomA.id}`, { name: 'Hacked', hourlyRatePence: 1 })).status).toBe(403);
    expect((await s.post('/api/admin/equipment', { name: 'X', pricePence: 0, pricing: 'PER_BOOKING', quantity: 1 })).status).toBe(403);
    expect((await s.get('/api/admin/staff')).status).toBe(403);
    expect((await s.post(`/api/admin/payments/x/refund`, { amountPence: 100 })).status).toBe(403);
  });

  it('public booking views never expose other bookings', async () => {
    const b = await paidOnlineBooking();
    const c = await publicClient();
    expect((await c.get(`/api/public/bookings/${b.reference}`)).status).toBe(404);
    expect((await c.get(`/api/public/bookings/${b.reference}?token=wrong-token-value-wrong-token`)).status).toBe(404);
    const avail = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    expect(JSON.stringify(avail.body)).not.toMatch(/Jo Bloggs|jo@band\.test/);
  });
});

describe('staff bookings', () => {
  it('creates a confirmed manual booking with a recorded cash payment', async () => {
    const a = await staffClient('admin@studio.test');
    const res = await a.post('/api/admin/bookings', adminBooking({ payment: { method: 'CASH', amountPence: 1000, note: 'Deposit' } }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', source: 'ADMIN', totalPence: 3000, paidPence: 1000 });
    expect(res.body.payments[0]).toMatchObject({ method: 'CASH', amountPence: 1000 });
    expect(await prisma.emailMessage.count({ where: { bookingId: res.body.id, kind: 'booking_confirmation' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'booking.created_by_staff' } })).toBe(1);
  });

  it('staff cannot override a conflict, even with ignoreBookingRules', async () => {
    await paidOnlineBooking();
    const a = await staffClient('staff@studio.test');
    const res = await a.post('/api/admin/bookings', adminBooking({ startTime: '15:00', durationMinutes: 60, ignoreBookingRules: true }));
    expect(res.status).toBe(409);
  });

  it('can book outside opening hours only when explicitly overriding rules', async () => {
    const a = await staffClient('admin@studio.test');
    expect((await a.post('/api/admin/bookings', adminBooking({ startTime: '07:00' }))).body.error.code).toBe('outside_opening_hours');
    expect((await a.post('/api/admin/bookings', adminBooking({ startTime: '07:00', ignoreBookingRules: true }))).status).toBe(201);
  });

  it('moves a booking, keeping the agreed price, and refuses a move into a conflict', async () => {
    const b = await paidOnlineBooking();
    const a = await staffClient('admin@studio.test');
    const other = (await a.post('/api/admin/bookings', adminBooking({ startTime: '18:00', durationMinutes: 60 }))).body;
    const detail = (await a.get(`/api/admin/bookings/${b.id}`)).body;
    const base = {
      roomId: studio.roomA.id, date, durationMinutes: 120, equipment: [], customerName: detail.customerName, customerEmail: detail.customerEmail,
      customerPhone: detail.customerPhone, bandName: detail.bandName, customerNotes: null, internalNotes: 'Moved at customer request', notifyCustomer: true,
    };
    const conflictRes = await a.put(`/api/admin/bookings/${b.id}`, { ...base, startTime: '17:00', pricing: 'KEEP' });
    expect(conflictRes.status).toBe(409);

    const moved = await a.put(`/api/admin/bookings/${b.id}`, { ...base, startTime: '11:00', pricing: 'KEEP' });
    expect(moved.status).toBe(200);
    expect(moved.body.totalPence).toBe(3000);
    expect(await prisma.emailMessage.count({ where: { bookingId: b.id, kind: 'booking_changed' } })).toBe(1);

    const longer = await a.put(`/api/admin/bookings/${b.id}`, { ...base, startTime: '11:00', durationMinutes: 180, pricing: 'KEEP' });
    expect(longer.status).toBe(400);
    const recalculated = await a.put(`/api/admin/bookings/${b.id}`, { ...base, startTime: '11:00', durationMinutes: 180, equipment: [{ equipmentId: studio.mic.id, quantity: 1 }], pricing: 'RECALCULATE' });
    expect(recalculated.body).toMatchObject({ totalPence: 4500 + 300, paidPence: 3000 });
    expect(other.id).toBeDefined();
  });

  it('cancels with a full Stripe refund, keeps the booking in history and frees the slot', async () => {
    const b = await paidOnlineBooking();
    const a = await staffClient('admin@studio.test');
    const res = await a.post(`/api/admin/bookings/${b.id}/cancel`, { reason: 'Studio flood', refund: 'FULL', notifyCustomer: true });
    expect(res.status).toBe(200);
    expect(res.body.refundedPence).toBe(3000);
    expect(res.body.booking).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Studio flood', paidPence: 0 });
    expect(stripe.refunds[0]).toMatchObject({ amount: 3000 });
    expect(await prisma.booking.count({ where: { id: b.id } })).toBe(1);
    expect(await prisma.emailMessage.count({ where: { bookingId: b.id, kind: 'booking_cancellation' } })).toBe(1);
    const again = await (await publicClient()).post('/api/public/bookings', bookingBody(studio.roomA.id, date, '14:00', 120));
    expect(again.status).toBe(201);
  });

  it('a failed refund does not undo the cancellation and is reported', async () => {
    const b = await paidOnlineBooking();
    stripe.state.failRefunds = true;
    const a = await staffClient('admin@studio.test');
    const res = await a.post(`/api/admin/bookings/${b.id}/cancel`, { reason: 'Test', refund: 'FULL' });
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(res.body.refundErrors).toHaveLength(1);
    expect(res.body.booking.refundablePence).toBe(3000);
    stripe.state.failRefunds = false;
    const pay = res.body.booking.payments[0];
    const retry = await a.post(`/api/admin/payments/${pay.id}/refund`, { amountPence: 3000 });
    expect(retry.body.refundablePence).toBe(0);
  });

  it('marks completed and no-show only after the start time', async () => {
    const a = await staffClient('admin@studio.test');
    const future = (await a.post('/api/admin/bookings', adminBooking())).body;
    expect((await a.post(`/api/admin/bookings/${future.id}/complete`)).status).toBe(409);
    await prisma.booking.update({ where: { id: future.id }, data: { startsAt: new Date(Date.now() - 3 * 3600_000), endsAt: new Date(Date.now() - 3600_000) } });
    expect((await a.post(`/api/admin/bookings/${future.id}/no-show`)).body.status).toBe('NO_SHOW');
    expect((await a.post(`/api/admin/bookings/${future.id}/complete`)).body.status).toBe('COMPLETED');
  });

  it('manual payments cannot exceed the balance', async () => {
    const a = await staffClient('admin@studio.test');
    const b = (await a.post('/api/admin/bookings', adminBooking())).body;
    expect((await a.post(`/api/admin/bookings/${b.id}/payments`, { method: 'CARD_TERMINAL', amountPence: 5000 })).status).toBe(400);
    expect((await a.post(`/api/admin/bookings/${b.id}/payments`, { method: 'CARD_TERMINAL', amountPence: 3000 })).body.paidPence).toBe(3000);
  });

  it('the calendar and dashboard show real bookings', async () => {
    await paidOnlineBooking();
    const a = await staffClient('staff@studio.test');
    const cal = await a.get(`/api/admin/calendar?from=${date}&to=${date}`);
    expect(cal.body.bookings).toHaveLength(1);
    expect(cal.body.rooms.map((r: { name: string }) => r.name)).toEqual(['Room A', 'Room B']);
    const dash = await a.get('/api/admin/dashboard');
    expect(dash.body.upcomingCount).toBe(1);
    expect(dash.body.setup).toMatchObject({ rooms: true, openingHours: true, stripe: true });
  });
});

describe('configuration', () => {
  it('manages rooms, price rules, equipment, hours and closures', async () => {
    const a = await staffClient('admin@studio.test');
    const room = (await a.post('/api/admin/rooms', { name: 'Live Room', hourlyRatePence: 2500, capacity: 8 })).body;
    const withRule = await a.post(`/api/admin/rooms/${room.id}/price-rules`, { label: 'Weekend', daysOfWeek: [0, 6], startTime: '09:00', endTime: '24:00', hourlyRatePence: 3000 });
    expect(withRule.body.priceRules[0]).toMatchObject({ label: 'Weekend', endTime: '24:00' });
    const eq = await a.post('/api/admin/equipment', { name: 'Drum kit', pricePence: 1000, pricing: 'PER_BOOKING', quantity: 1 });
    expect(eq.status).toBe(201);

    const hours = (await a.get('/api/admin/opening-hours')).body.map((d: object) => ({ ...d, isOpen: false }));
    expect((await a.put('/api/admin/opening-hours', hours)).body.every((d: { isOpen: boolean }) => !d.isOpen)).toBe(true);

    const block = await a.post('/api/admin/blocks', { roomId: null, startDate: date, startTime: '09:00', endDate: date, endTime: '12:00', reason: 'Deep clean' });
    expect(block.status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: { in: ['room.created', 'price_rule.created', 'equipment.created', 'hours.updated', 'availability.blocked'] } } })).toBe(5);
  });

  it('refuses to delete rooms or equipment with booking history', async () => {
    const b = await paidOnlineBooking();
    const a = await staffClient('admin@studio.test');
    expect((await a.del(`/api/admin/rooms/${b.roomId}`)).status).toBe(409);
    await a.post('/api/admin/bookings', adminBooking({ startTime: '09:00', durationMinutes: 60, equipment: [{ equipmentId: studio.mic.id, quantity: 1 }] }));
    expect((await a.del(`/api/admin/equipment/${studio.mic.id}`)).status).toBe(409);
  });

  it('keeps at least one active administrator', async () => {
    const a = await staffClient('admin@studio.test');
    const me = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@studio.test' } });
    expect((await a.put(`/api/admin/staff/${me.id}`, { role: 'STAFF', disabled: false })).status).toBe(400);
  });

  it('invites staff with a single-use link; admins never set passwords', async () => {
    const a = await staffClient('admin@studio.test');
    const res = await a.post('/api/admin/staff', { name: 'New Person', email: 'new@studio.test', role: 'STAFF' });
    expect(res.body.user.hasPassword).toBe(false);
    const token = new URL(res.body.inviteLink).searchParams.get('token')!;
    const c = await publicClient();
    expect((await c.post('/api/auth/reset-password', { token, password: 'the new person chose this' })).status).toBe(200);
    expect((await c.post('/api/auth/reset-password', { token, password: 'the new person chose this' })).status).toBe(400);
    await c.login('new@studio.test', 'the new person chose this');
    expect((await c.get('/api/me')).body.user.role).toBe('STAFF');
  });
});
