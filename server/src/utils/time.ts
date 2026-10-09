// Timezone arithmetic using the platform's ICU data (no external library).
// Bookings are stored as UTC instants; opening hours, pricing rules and what the
// customer sees are wall-clock times in the business timezone. These helpers
// convert between the two and are DST-correct.

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes after local midnight
  dayOfWeek: number; // 0 = Sunday
}

export function toLocal(instant: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    dayOfWeek: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. +60 for BST). */
function offsetMinutes(instant: Date, tz: string): number {
  const p = toLocal(instant, tz);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, 0, p.minutes);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/**
 * The UTC instant for local `date` at `minutes` after midnight (minutes may be 1440 =
 * next midnight). Times inside a spring-forward gap resolve to the later offset.
 */
export function fromLocal(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let result = naive - offsetMinutes(new Date(naive), tz) * 60000;
  const second = naive - offsetMinutes(new Date(result), tz) * 60000;
  if (second !== result) result = second;
  return new Date(result);
}

export function dayOfWeekOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function localTimeLabel(instant: Date, tz: string): string {
  const { minutes } = toLocal(instant, tz);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatLongDate(instant: Date, tz: string): string {
  return instant.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
