import { beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { fromLocal } from '../src/utils/time';
import { event } from './stripe-stub';
import {
  app,
  bookingBody,
  configureStudio,
  deliverWebhook,
  futureDate,
  prisma,
  publicClient,
  resetDb,
  useStripeStub,
} from './helpers';

let studio: Awaited<ReturnType<typeof configureStudio>>;
let stripe: ReturnType<typeof useStripeStub>;
const date = futureDate(3);

beforeEach(async () => {
  await resetDb();
  studio = await configureStudio();
  stripe = useStripeStub();
});

async function book(body: object) {
  const c = await publicClient();
  return c.post('/api/public/bookings', body);
}

describe('public availability', () => {
  it('lists real start times within opening hours and hides booked time', async () => {
    const c = await publicClient();
    const before = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    expect(before.status).toBe(200);
    expect(before.body.openTime).toBe('09:00');
    expect(before.body.starts[0]).toEqual({ time: '09:00', maxDurationMinutes: 480 });
    expect(before.body.starts.at(-1).time).toBe('22:00'); // 1 h minimum before 23:00 close

    await book(bookingBody(studio.roomA.id, date, '14:00', 120));
    const after = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    const times = after.body.starts.map((s: { time: string }) => s.time);
    expect(times).not.toContain('14:00');
    expect(times).not.toContain('15:30');
    expect(after.body.starts.find((s: { time: string }) => s.time === '12:00').maxDurationMinutes).toBe(120);
    expect(after.body.busy).toEqual([{ start: '14:00', end: '16:00', kind: 'booking' }]);
    // Room B is unaffected.
    const b = await c.get(`/api/public/availability?roomId=${studio.roomB.id}&date=${date}`);
    expect(b.body.starts.map((s: { time: string }) => s.time)).toContain('14:00');
  });

  it('lists every start time with its state: booked greyed, closures red, gaps unavailable', async () => {
    await book(bookingBody(studio.roomA.id, date, '14:00', 120));
    await prisma.availabilityBlock.create({
      data: { roomId: null, startsAt: fromLocal(date, 18 * 60, 'Europe/London'), endsAt: fromLocal(date, 20 * 60, 'Europe/London'), reason: 'Private event' },
    });
    const c = await publicClient();
    const res = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    const state = (t: string) => res.body.slots.find((s: { time: string }) => s.time === t)?.state;
    expect(res.body.slots[0].time).toBe('09:00');
    expect(res.body.slots.at(-1).time).toBe('22:30');
    expect(state('10:00')).toBe('available');
    expect(state('14:00')).toBe('booked');
    expect(state('15:30')).toBe('booked');
    expect(state('13:30')).toBe('unavailable'); // only 30 min before the booking; minimum is 1 h
    expect(state('16:00')).toBe('available');
    expect(state('18:00')).toBe('closed');
    expect(state('19:30')).toBe('closed');
    expect(state('22:30')).toBe('unavailable'); // too close to closing
    expect(res.body.busy.map((b: { kind: string }) => b.kind).sort()).toEqual(['booking', 'closure']);
    // Only available slots are offered as starts, and nothing identifies who booked.
    expect(res.body.starts.map((s: { time: string }) => s.time)).not.toContain('14:00');
    expect(JSON.stringify(res.body)).not.toMatch(/Jo Bloggs|jo@band|Private event/);
  });

  it('respects closed days and closures', async () => {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    await prisma.openingHours.update({ where: { dayOfWeek: dow }, data: { isOpen: false } });
    const c = await publicClient();
    const closed = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    expect(closed.body).toMatchObject({ open: false, starts: [], reason: 'Closed' });

    await prisma.openingHours.update({ where: { dayOfWeek: dow }, data: { isOpen: true } });
    await prisma.availabilityBlock.create({ data: { roomId: null, startsAt: fromLocal(date, 9 * 60, 'Europe/London'), endsAt: fromLocal(date, 13 * 60, 'Europe/London'), reason: 'Maintenance' } });
    const blocked = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}`);
    expect(blocked.body.starts[0].time).toBe('13:00');
  });

  it('reports equipment available for the chosen window', async () => {
    const c = await publicClient();
    const res = await c.get(`/api/public/equipment?date=${date}&startTime=10:00&durationMinutes=120`);
    expect(res.body.find((e: { name: string }) => e.name === 'Microphone').available).toBe(4);
  });
});

describe('session types priced by length', () => {
  const plans = [
    { id: 'band', name: 'Band rehearsal', prices: [{ minutes: 120, pricePence: 2900 }, { minutes: 180, pricePence: 3675 }], extraHourPence: 1030 },
    { id: 'solo', name: 'Solo', prices: [], extraHourPence: 1100, minDurationMinutes: 60, latestEndTime: '18:00' },
  ];
  beforeEach(async () => {
    await prisma.room.update({ where: { id: studio.roomA.id }, data: { ratePlans: plans } });
  });

  it('quotes and books on the chosen plan, snapshotting it', async () => {
    const c = await publicClient();
    const q = await c.post('/api/public/quote', { roomId: studio.roomA.id, date, startTime: '10:00', durationMinutes: 180, equipment: [] });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ ratePlanId: 'band', roomSubtotalPence: 3675 });
    const long = await c.post('/api/public/quote', { roomId: studio.roomA.id, date, startTime: '10:00', durationMinutes: 300, equipment: [], ratePlanId: 'band' });
    expect(long.body.roomSubtotalPence).toBe(3675 + 2 * 1030);

    const res = await book({ ...bookingBody(studio.roomA.id, date, '14:00', 60), ratePlanId: 'solo' });
    expect(res.status).toBe(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
    expect(b).toMatchObject({ ratePlanId: 'solo', ratePlanName: 'Solo', totalPence: 1100 });
  });

  it("applies the plan's lengths and hours", async () => {
    const c = await publicClient();
    // Band has no 1-hour option; solo must end by 18:00; unknown plans are refused.
    expect((await c.post('/api/public/quote', { roomId: studio.roomA.id, date, startTime: '10:00', durationMinutes: 60, equipment: [], ratePlanId: 'band' })).status).toBe(400);
    expect((await c.post('/api/public/quote', { roomId: studio.roomA.id, date, startTime: '17:00', durationMinutes: 120, equipment: [], ratePlanId: 'solo' })).status).toBe(409);
    expect((await c.post('/api/public/quote', { roomId: studio.roomA.id, date, startTime: '10:00', durationMinutes: 120, equipment: [], ratePlanId: 'nope' })).status).toBe(400);

    const solo = await c.get(`/api/public/availability?roomId=${studio.roomA.id}&date=${date}&ratePlanId=solo`);
    const slot = (t: string) => solo.body.slots.find((s: { time: string }) => s.time === t);
    expect(slot('17:00')).toMatchObject({ state: 'available', maxDurationMinutes: 60 });
    expect(slot('18:00').state).toBe('unavailable');
  });
});

describe('online booking and payment', () => {
  it('prices on the server, ignoring any price sent by the browser', async () => {
    const res = await book({ ...bookingBody(studio.roomA.id, date, '10:00', 120, [{ equipmentId: studio.mic.id, quantity: 2 }]), totalPence: 1, price: 1 });
    expect(res.status).toBe(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
    expect(b.totalPence).toBe(2 * 1500 + 2 * 300);
    expect(b.status).toBe('PENDING_PAYMENT');
    // Stripe was asked for exactly the server's total.
    const session = [...stripe.sessions.values()][0]!;
    expect(session.amount_total).toBe(3600);
    expect(res.body.checkoutUrl).toBe(session.url);
    // The return URL carries no manage token.
    expect(session.params.success_url).not.toContain('token=');
  });

  it('confirms only when the signed webhook arrives — not on return from Stripe', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const session = [...stripe.sessions.values()][0]!;

    // Customer lands on the return page before the webhook: still pending.
    const view = await supertest(app).get(`/api/public/bookings/${res.body.reference}?session_id=${session.id}`);
    expect(view.status).toBe(200);
    expect(view.body.status).toBe('PENDING_PAYMENT');

    const hook = await deliverWebhook(stripe.pay(session.id));
    expect(hook.status).toBe(200);
    expect(hook.body.result).toBe('processed');

    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference }, include: { payments: true } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.payments[0]).toMatchObject({ status: 'SUCCEEDED', amountPence: 3000, stripePaymentIntentId: `pi_${session.id}` });

    const emails = await prisma.emailMessage.findMany({ where: { bookingId: b.id } });
    expect(emails.map((e) => e.kind).sort()).toEqual(['admin_new_booking', 'booking_confirmation']);
    const confirmation = emails.find((e) => e.kind === 'booking_confirmation')!;
    expect(confirmation.to).toBe('jo@band.test');
    expect(confirmation.text).toContain(b.reference);
    expect(confirmation.text).toContain('/booking/' + b.reference + '?token=');
    expect(confirmation.ics).toContain('BEGIN:VEVENT');
  });

  it('processes a duplicate webhook once', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const session = [...stripe.sessions.values()][0]!;
    const evt = stripe.pay(session.id);
    await deliverWebhook(evt);
    const second = await deliverWebhook(evt);
    expect(second.body.result).toBe('duplicate');
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference }, include: { payments: true } });
    expect(b.payments.filter((p) => p.status === 'SUCCEEDED')).toHaveLength(1);
    expect(await prisma.emailMessage.count({ where: { bookingId: b.id, kind: 'booking_confirmation' } })).toBe(1);
  });

  it('rejects webhooks with a bad signature and changes nothing', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const session = [...stripe.sessions.values()][0]!;
    const forged = await deliverWebhook(stripe.pay(session.id), 'whsec_attacker');
    expect(forged.status).toBe(400);
    expect((await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } })).status).toBe('PENDING_PAYMENT');
  });

  it('holds the slot while the customer pays, then releases it on expiry', async () => {
    const first = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const clash = await book(bookingBody(studio.roomA.id, date, '11:00', 60));
    expect(clash.status).toBe(409);

    const session = [...stripe.sessions.values()][0]!;
    await deliverWebhook(event('checkout.session.expired', { ...session, object: 'checkout.session', status: 'expired' }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { reference: first.body.reference } })).status).toBe('EXPIRED');
    expect((await book(bookingBody(studio.roomA.id, date, '11:00', 60))).status).toBe(201);
  });

  it('a lapsed hold stops blocking even before the expiry job runs', async () => {
    const first = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    await prisma.booking.update({ where: { reference: first.body.reference }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 120))).status).toBe(201);
    expect((await prisma.booking.findUniqueOrThrow({ where: { reference: first.body.reference } })).status).toBe('EXPIRED');
  });

  it('reinstates a late payment if the slot is still free', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const session = [...stripe.sessions.values()][0]!;
    await prisma.booking.update({ where: { reference: res.body.reference }, data: { status: 'EXPIRED' } });
    await deliverWebhook(stripe.pay(session.id));
    expect((await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } })).status).toBe('CONFIRMED');
    expect(stripe.refunds).toHaveLength(0);
  });

  it('refunds a late payment automatically if the slot was taken meanwhile', async () => {
    const late = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const lateSession = [...stripe.sessions.values()][0]!;
    await prisma.booking.update({ where: { reference: late.body.reference }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const other = await book({ ...bookingBody(studio.roomA.id, date, '10:00', 60), customer: { name: 'Other', email: 'other@band.test', phone: '07700 900999', bandName: null } });
    expect(other.status).toBe(201);

    await deliverWebhook(stripe.pay(lateSession.id));
    await new Promise((r) => setTimeout(r, 200));
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: late.body.reference }, include: { payments: true } });
    expect(b.status).toBe('CANCELLED');
    expect(stripe.refunds).toEqual([{ payment_intent: `pi_${lateSession.id}`, amount: 3000, metadata: expect.any(Object) }]);
    expect(b.payments[0]!.refundedPence).toBe(3000);
    expect(await prisma.emailMessage.count({ where: { bookingId: b.id, kind: 'late_payment_refunded' } })).toBe(1);
  });

  it('releases the slot and reports clearly if Stripe is unreachable', async () => {
    stripe.state.failCheckout = true;
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('payments_unavailable');
    const b = await prisma.booking.findFirstOrThrow();
    expect(b.status).toBe('EXPIRED');
    stripe.state.failCheckout = false;
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 120))).status).toBe(201);
  });

  it('reconciles a paid checkout directly with Stripe when the webhook is delayed', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const session = [...stripe.sessions.values()][0]!;
    stripe.pay(session.id); // paid at Stripe, but the webhook never arrives
    const { reconcilePayment } = await import('../src/services/payment.service');
    const payment = await prisma.payment.findFirstOrThrow();
    expect(await reconcilePayment(payment.id)).toBe('confirmed');
    expect((await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } })).status).toBe('CONFIRMED');
  });
});

describe('double-booking prevention', () => {
  it('lets exactly one of many simultaneous requests for the same slot through', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        book({ ...bookingBody(studio.roomA.id, date, '18:00', 120), customer: { name: `Band ${i}`, email: `b${i}@band.test`, phone: '07700 900000', bandName: null } }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.booking.count({ where: { status: 'PENDING_PAYMENT' } })).toBe(1);
  });

  it('the database itself rejects overlapping active bookings', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
    const { id: _id, reference: _r, ...rest } = b;
    await expect(
      prisma.booking.create({ data: { ...rest, reference: 'HAB-ZZZZZZ', pricingSnapshot: {}, startsAt: new Date(b.startsAt.getTime() + 30 * 60000) } }),
    ).rejects.toThrow(/booking_no_room_overlap|23P01|exclusion/i);
    // Cancelled bookings don't block.
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    await expect(prisma.booking.create({ data: { ...rest, reference: 'HAB-ZZZZZZ', pricingSnapshot: {} } })).resolves.toBeDefined();
  });

  it('back-to-back bookings are allowed', async () => {
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 120))).status).toBe(201);
    expect((await book(bookingBody(studio.roomA.id, date, '12:00', 60))).status).toBe(201);
  });
});

describe('equipment quantities', () => {
  it('4 microphones with 3 booked leaves exactly 1 for overlapping times', async () => {
    await book(bookingBody(studio.roomA.id, date, '10:00', 120, [{ equipmentId: studio.mic.id, quantity: 3 }]));
    const c = await publicClient();
    const avail = await c.get(`/api/public/equipment?date=${date}&startTime=11:00&durationMinutes=60`);
    expect(avail.body.find((e: { id: string }) => e.id === studio.mic.id).available).toBe(1);

    const tooMany = await book(bookingBody(studio.roomB.id, date, '11:00', 60, [{ equipmentId: studio.mic.id, quantity: 2 }]));
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.fields[`equipment.${studio.mic.id}`]).toBe('Only 1 available at that time');
    expect((await book(bookingBody(studio.roomB.id, date, '11:00', 60, [{ equipmentId: studio.mic.id, quantity: 1 }]))).status).toBe(201);
    // Non-overlapping time: all 4 free again.
    const later = await c.get(`/api/public/equipment?date=${date}&startTime=14:00&durationMinutes=60`);
    expect(later.body.find((e: { id: string }) => e.id === studio.mic.id).available).toBe(4);
  });

  it('counts peak concurrent use, not the sum of every overlapping booking', async () => {
    await book(bookingBody(studio.roomA.id, date, '10:00', 120, [{ equipmentId: studio.mic.id, quantity: 3 }]));
    await book({ ...bookingBody(studio.roomA.id, date, '12:00', 120, [{ equipmentId: studio.mic.id, quantity: 3 }]), customer: { name: 'B', email: 'b@band.test', phone: '07700 900001', bandName: null } });
    // 11:00–13:00 overlaps both, but at most 3 mics are out at once → 1 free.
    const res = await book(bookingBody(studio.roomB.id, date, '11:00', 120, [{ equipmentId: studio.mic.id, quantity: 1 }]));
    expect(res.status).toBe(201);
    const none = await book({ ...bookingBody(studio.roomB.id, date, '15:00', 60, [{ equipmentId: studio.amp.id, quantity: 2 }]) });
    expect(none.status).toBe(409);
  });

  it('simultaneous requests cannot oversubscribe equipment', async () => {
    const results = await Promise.all(
      [studio.roomA.id, studio.roomB.id].map((roomId, i) =>
        book({ ...bookingBody(roomId, date, '16:00', 60, [{ equipmentId: studio.amp.id, quantity: 1 }]), customer: { name: `C${i}`, email: `c${i}@band.test`, phone: '07700 900002', bandName: null } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('inactive equipment cannot be booked online', async () => {
    await prisma.equipment.update({ where: { id: studio.mic.id }, data: { active: false } });
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 60, [{ equipmentId: studio.mic.id, quantity: 1 }]));
    expect(res.status).toBe(409);
  });
});

describe('booking rules', () => {
  it('rejects times outside opening hours, bad durations and too-short notice', async () => {
    expect((await book(bookingBody(studio.roomA.id, date, '22:00', 120))).body.error.code).toBe('outside_opening_hours');
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 45))).status).toBe(400);
    expect((await book(bookingBody(studio.roomA.id, date, '10:15', 60))).status).toBe(400);
    await prisma.settings.update({ where: { id: 1 }, data: { minNoticeMinutes: 60 * 24 * 10 } });
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 60))).body.error.code).toBe('too_soon');
  });

  it('requires accepting the terms and valid contact details', async () => {
    const res = await book({ ...bookingBody(studio.roomA.id, date, '10:00', 60), acceptTerms: false, customer: { name: '', email: 'nope', phone: '' } });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['acceptTerms', 'customer.name', 'customer.email', 'customer.phone']));
  });

  it('online booking is refused when switched off', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { onlineBookingEnabled: false } });
    expect((await book(bookingBody(studio.roomA.id, date, '10:00', 60))).status).toBe(503);
  });
});

describe('price snapshots', () => {
  it('keep the charged price after the room price changes', async () => {
    const res = await book(bookingBody(studio.roomA.id, date, '10:00', 120));
    await prisma.room.update({ where: { id: studio.roomA.id }, data: { hourlyRatePence: 9999 } });
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } });
    expect(b.totalPence).toBe(3000);
    expect((b.pricingSnapshot as { lines: { amountPence: number }[] }).lines[0]!.amountPence).toBe(3000);
  });
});
