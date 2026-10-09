import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processOutbox } from '../src/services/email/outbox';
import { setTransport } from '../src/services/email/transport';
import { app, bookingBody, configureStudio, deliverWebhook, futureDate, prisma, publicClient, resetDb, useStripeStub } from './helpers';

let studio: Awaited<ReturnType<typeof configureStudio>>;
let stripe: ReturnType<typeof useStripeStub>;

beforeEach(async () => {
  await resetDb();
  studio = await configureStudio();
  stripe = useStripeStub();
  setTransport(undefined);
});

async function paidBooking(date = futureDate(5)) {
  const c = await publicClient();
  const res = await c.post('/api/public/bookings', bookingBody(studio.roomA.id, date, '10:00', 120));
  const session = [...stripe.sessions.values()].at(-1)!;
  await deliverWebhook(stripe.pay(session.id));
  return { ...res.body, bookingId: (await prisma.booking.findUniqueOrThrow({ where: { reference: res.body.reference } })).id };
}

describe('customer self-service link', () => {
  it('shows the booking with the manage token and cancels with a full refund before the deadline', async () => {
    const b = await paidBooking();
    const c = await publicClient();
    const view = await c.get(`/api/public/bookings/${b.reference}?token=${b.manageToken}`);
    expect(view.body).toMatchObject({ status: 'CONFIRMED', canCancel: true, paidPence: 3000 });
    const res = await c.post(`/api/public/bookings/${b.reference}/cancel`, { token: b.manageToken });
    expect(res.body.status).toBe('CANCELLED');
    expect(stripe.refunds[0]).toMatchObject({ amount: 3000 });
  });

  it('refuses online cancellation inside the notice period', async () => {
    const b = await paidBooking(futureDate(1));
    await prisma.settings.update({ where: { id: 1 }, data: { cancellationNoticeHours: 24 * 7 } });
    const c = await publicClient();
    const res = await c.post(`/api/public/bookings/${b.reference}/cancel`, { token: b.manageToken });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('too_late_to_cancel');
    expect(stripe.refunds).toHaveLength(0);
  });

  it('the token in the confirmation email is the working manage token', async () => {
    const b = await paidBooking();
    const email = await prisma.emailMessage.findFirstOrThrow({ where: { bookingId: b.bookingId, kind: 'booking_confirmation' } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(email.text)![1];
    expect(token).toBe(b.manageToken);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } });
    expect(JSON.stringify(stored)).not.toContain(b.manageToken);
  });

  it('a checkout session id only grants a read-only status view', async () => {
    const b = await paidBooking();
    const session = [...stripe.sessions.values()].at(-1)!;
    const view = await supertest(app).get(`/api/public/bookings/${b.reference}?session_id=${session.id}`);
    expect(view.body).toMatchObject({ status: 'CONFIRMED', canCancel: false });
  });
});

describe('email delivery over SMTP', () => {
  const received: { to: string; subject: string; raw: string }[] = [];
  let server: SMTPServer;
  let port = 0;
  let reject = false;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onRcptTo(address, _session, cb) {
        if (reject) return cb(new Error('Mailbox unavailable (simulated outage)'));
        cb();
      },
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (d) => (raw += d.toString()));
        stream.on('end', () => {
          // Unfold RFC 5322 header continuation lines before reading the subject.
          const headers = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
          received.push({ to: session.envelope.rcptTo[0]!.address, subject: /^Subject: (.*)$/m.exec(headers)?.[1] ?? '', raw });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const useSmtp = () => setTransport(nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true }));

  it('delivers the confirmation with its calendar invite', async () => {
    received.length = 0;
    const b = await paidBooking();
    useSmtp();
    const result = await processOutbox();
    expect(result.sent).toBe(2);
    const mail = received.find((m) => m.to === 'jo@band.test')!;
    expect(mail.subject).toContain(b.reference);
    expect(mail.raw).toContain('text/calendar');
    const stored = await prisma.emailMessage.findFirstOrThrow({ where: { kind: 'booking_confirmation' } });
    expect(stored).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('keeps emails queued with the error while SMTP is down, then sends them later', async () => {
    received.length = 0;
    await paidBooking();
    // No transport configured at all: nothing is lost.
    expect((await processOutbox()).sent).toBe(0);
    expect(await prisma.emailMessage.count({ where: { status: 'PENDING' } })).toBe(2);

    useSmtp();
    reject = true;
    const failed = await processOutbox();
    expect(failed.failed).toBe(2);
    const pending = await prisma.emailMessage.findFirstOrThrow({ where: { kind: 'booking_confirmation' } });
    expect(pending.status).toBe('PENDING');
    expect(pending.lastError).toMatch(/Mailbox unavailable/);
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    reject = false;
    await prisma.emailMessage.updateMany({ data: { nextAttemptAt: new Date() } });
    expect((await processOutbox()).sent).toBe(2);
    expect(received).toHaveLength(2);
    // The booking itself was never affected.
    expect(await prisma.booking.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });
});
