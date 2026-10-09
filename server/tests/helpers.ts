import type { StaffRole } from '@habitat/shared';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { applyIntegrations } from '../src/config/integrations';
import { hashPassword } from '../src/auth/password';
import { prisma } from '../src/db/prisma';
import { setStripeClient } from '../src/stripe/client';
import { addDays, toLocal } from '../src/utils/time';
import { createStripeStub, signedPayload } from './stripe-stub';

export const app = createApp();
export { prisma };
export const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'https://book.example-studio.test';

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  // Connections saved in a previous test must not leak into the next one.
  applyIntegrations(null);
}

/** Fresh Stripe double for each test. */
export function useStripeStub() {
  const s = createStripeStub();
  setStripeClient(s.stub);
  return s;
}

/** Studio configuration used by most tests: open 09:00–23:00 every day, 30-min slots, no notice. */
export async function configureStudio() {
  await prisma.settings.create({
    data: { id: 1, businessName: 'Test Studio', timezone: 'Europe/London', minNoticeMinutes: 0, slotMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480, holdMinutes: 30, cancellationNoticeHours: 48, adminNotifyEmail: 'owner@studio.test' },
  });
  for (let d = 0; d < 7; d++) await prisma.openingHours.create({ data: { dayOfWeek: d, isOpen: true, openMinute: 9 * 60, closeMinute: 23 * 60 } });
  const roomA = await prisma.room.create({ data: { name: 'Room A', hourlyRatePence: 1500, sortOrder: 1 } });
  const roomB = await prisma.room.create({ data: { name: 'Room B', hourlyRatePence: 1000, sortOrder: 2 } });
  const mic = await prisma.equipment.create({ data: { name: 'Microphone', pricePence: 300, pricing: 'PER_BOOKING', quantity: 4 } });
  const amp = await prisma.equipment.create({ data: { name: 'Guitar amp', pricePence: 200, pricing: 'PER_HOUR', quantity: 1 } });
  return { roomA, roomB, mic, amp };
}

/** A local date `days` from today in the studio's timezone. */
export const futureDate = (days = 3) => addDays(toLocal(new Date(), 'Europe/London').date, days);

export async function createStaff(email: string, role: StaffRole = 'ADMIN') {
  return prisma.staffUser.create({ data: { email, name: role === 'ADMIN' ? 'Ada Admin' : 'Sam Staff', role, passwordHash: await hashPassword(PASSWORD) } });
}

export class Client {
  readonly agent = supertest.agent(app);
  csrf = '';
  private capture(res: supertest.Response) {
    for (const c of (res.headers['set-cookie'] as unknown as string[]) ?? []) {
      const m = /^habitat_csrf=([^;]*)/.exec(c);
      if (m?.[1]) this.csrf = decodeURIComponent(m[1]);
    }
    return res;
  }
  async init() {
    this.capture(await this.agent.get('/api/auth/csrf'));
    return this;
  }
  async get(url: string) {
    return this.capture(await this.agent.get(url));
  }
  async send(method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: object) {
    const req = this.agent[method](url).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf);
    return this.capture(await (body ? req.send(body) : req));
  }
  post = (url: string, body?: object) => this.send('post', url, body);
  put = (url: string, body?: object) => this.send('put', url, body);
  patch = (url: string, body?: object) => this.send('patch', url, body);
  del = (url: string) => this.send('delete', url);
  async login(email: string, password = PASSWORD) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return this;
  }
}

export const publicClient = () => new Client().init();
export const staffClient = async (email: string) => (await new Client().init()).login(email);

export async function deliverWebhook(evt: object, secret?: string) {
  const { payload, signature } = signedPayload(evt, secret);
  return supertest(app).post('/api/stripe/webhook').set('Stripe-Signature', signature).set('Content-Type', 'application/json').send(payload);
}

export const customer = { name: 'Jo Bloggs', email: 'jo@band.test', phone: '07700 900123', bandName: 'The Tests' };

export function bookingBody(roomId: string, date: string, startTime: string, durationMinutes: number, equipment: { equipmentId: string; quantity: number }[] = []) {
  return { roomId, date, startTime, durationMinutes, equipment, customer, notes: null, acceptTerms: true };
}
