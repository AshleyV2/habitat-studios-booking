import { planDurations, planPrice, type RatePlan } from '@habitat/shared';
// All times are shown in the studio's timezone, whatever the viewer's device says.

export function money(pence: number | null | undefined, currency = 'gbp') {
  if (pence == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(pence / 100);
}

export const poundsToPence = (v: string) => Math.round(Number(v.replace(/[£,\s]/g, '')) * 100);
export const penceToPounds = (p: number) => (p / 100).toFixed(2);

export function dateLong(isoOrDate: string, tz: string) {
  const d = isoOrDate.length === 10 ? new Date(`${isoOrDate}T12:00:00Z`) : new Date(isoOrDate);
  return d.toLocaleDateString('en-GB', { timeZone: isoOrDate.length === 10 ? 'UTC' : tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateShort(isoOrDate: string, tz: string) {
  const d = isoOrDate.length === 10 ? new Date(`${isoOrDate}T12:00:00Z`) : new Date(isoOrDate);
  return d.toLocaleDateString('en-GB', { timeZone: isoOrDate.length === 10 ? 'UTC' : tz, weekday: 'short', day: 'numeric', month: 'short' });
}

export function time(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function dateTime(iso: string | null | undefined, tz: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Local YYYY-MM-DD of an instant in a timezone. */
export function localDate(iso: string | Date, tz: string) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? '' : 's'}`;
}

/** Rooms priced by session: the cheapest session anyone can book, e.g. "from £11.00 per session". */
export function roomFromPrice(room: { ratePlans: RatePlan[]; fromRatePence: number }, rules: { slotMinutes: number; minDurationMinutes: number; maxDurationMinutes: number }) {
  if (!room.ratePlans.length) return { pence: room.fromRatePence, unit: 'per hour' as const };
  const prices = room.ratePlans.map((p) => {
    const first = planDurations(p, rules)[0];
    return first ? planPrice(p, first) : Infinity;
  });
  return { pence: Math.min(...prices), unit: 'per session' as const };
}

/** "2 h £29.00 · 3 h £36.75 · then £10.30/h" */
export function planSummary(plan: RatePlan, currency = 'gbp') {
  const listed = [...plan.prices].sort((a, b) => a.minutes - b.minutes).map((p) => `${duration(p.minutes)} ${money(p.pricePence, currency)}`);
  if (plan.extraHourPence !== null) listed.push(`${plan.prices.length ? 'then ' : ''}${money(plan.extraHourPence, currency)}/hour`);
  return listed.join(' · ');
}

/** Wall-clock end of a session, e.g. endTimeLabel('18:00', 180) → '21:00'; midnight shows as 00:00. */
export function endTimeLabel(start: string, minutes: number) {
  const [h, m] = start.split(':').map(Number) as [number, number];
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
