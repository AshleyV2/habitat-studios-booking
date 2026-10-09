import { BOOKING_STATUS_LABELS, type CalendarResponse } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, qs } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState } from '../../components/States';
import { addDays, dateLong, dateShort, dayOfWeek, localDate, time } from '../../lib/format';
import { BookingsTable, useTz } from './DashboardPage';
import { usePublicConfig } from '../public/PublicLayout';

const HOUR_PX = 56;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function minutesInDay(iso: string, tz: string) {
  const t = time(iso, tz);
  return toMin(t);
}

/** Day view: rooms as columns, the studio's opening hours as rows. */
function DayGrid({ data, date }: { data: CalendarResponse; date: string }) {
  const tz = data.timezone;
  const navigate = useNavigate();
  const hours = data.openingHours.find((h) => h.dayOfWeek === dayOfWeek(date));
  const rooms = data.rooms.filter((r) => r.active || data.bookings.some((b) => b.room.id === r.id));
  const dayBookings = data.bookings.filter((b) => localDate(b.startsAt, tz) === date || localDate(b.endsAt, tz) === date);
  const starts = dayBookings.map((b) => minutesInDay(b.startsAt, tz));
  const open = Math.min(hours?.isOpen ? toMin(hours.openTime) : 9 * 60, ...starts, 24 * 60);
  const close = Math.max(hours?.isOpen ? toMin(hours.closeTime === '24:00' ? '24:00' : hours.closeTime) : 22 * 60, ...dayBookings.map((b) => (localDate(b.endsAt, tz) === date ? minutesInDay(b.endsAt, tz) : 24 * 60)));
  const from = Math.floor(open / 60) * 60;
  const to = Math.ceil(close / 60) * 60;
  const px = (m: number) => ((m - from) / 60) * HOUR_PX;
  const rowsH = px(to);
  if (!rooms.length) return <EmptyState title="No rooms yet." action={<Link to="/admin/rooms" className="btn">Add rooms</Link>} />;

  return (
    <div className="table-wrap" style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
      {!hours?.isOpen && <div className="notice notice--warn" style={{ margin: 8 }}><div>Closed on this day (by opening hours).</div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${rooms.length}, minmax(150px, 1fr))`, minWidth: 56 + rooms.length * 150 }}>
        <div />
        {rooms.map((r) => (
          <div key={r.id} style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
            <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: r.colour, borderRadius: 2, marginRight: 6 }} />
            {r.name}{!r.active && <span className="muted small"> (inactive)</span>}
          </div>
        ))}
        <div style={{ position: 'relative', height: rowsH }}>
          {Array.from({ length: (to - from) / 60 }, (_, i) => (
            <div key={i} className="small muted" style={{ position: 'absolute', top: i * HOUR_PX - 8, right: 6 }}>{String((from / 60 + i) % 24).padStart(2, '0')}:00</div>
          ))}
        </div>
        {rooms.map((r) => (
          <div
            key={r.id}
            style={{ position: 'relative', height: rowsH, borderLeft: '1px solid var(--border)', backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)`, cursor: 'copy' }}
            onDoubleClick={(e) => {
              const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
              const m = from + Math.floor(((y / HOUR_PX) * 60) / 30) * 30;
              navigate(`/admin/bookings/new${qs({ roomId: r.id, date, startTime: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })}`);
            }}
            title="Double-click an empty time to create a booking"
          >
            {data.blocks
              .filter((b) => (b.roomId === null || b.roomId === r.id) && localDate(b.startsAt, tz) <= date && localDate(b.endsAt, tz) >= date)
              .map((b) => {
                const s = localDate(b.startsAt, tz) === date ? minutesInDay(b.startsAt, tz) : from;
                const e = localDate(b.endsAt, tz) === date ? minutesInDay(b.endsAt, tz) : to;
                return (
                  <div key={b.id} style={{ position: 'absolute', left: 0, right: 0, top: px(Math.max(s, from)), height: Math.max(px(Math.min(e, to)) - px(Math.max(s, from)), 4), background: 'repeating-linear-gradient(45deg, #eceae5 0 6px, #f6f5f2 6px 12px)', borderTop: '1px solid #c9c4b8' }}>
                    <span className="small muted" style={{ padding: 4, display: 'block' }}>Closed: {b.reason}</span>
                  </div>
                );
              })}
            {dayBookings
              .filter((b) => b.room.id === r.id)
              .map((b) => {
                const s = localDate(b.startsAt, tz) === date ? minutesInDay(b.startsAt, tz) : from;
                const e = localDate(b.endsAt, tz) === date ? minutesInDay(b.endsAt, tz) : to;
                const pending = b.status === 'PENDING_PAYMENT';
                return (
                  <Link
                    key={b.id}
                    to={`/admin/bookings/${b.id}`}
                    style={{
                      position: 'absolute', left: 4, right: 4, top: px(s) + 1, height: Math.max(px(e) - px(s) - 2, 22), overflow: 'hidden',
                      background: pending ? '#fff' : `${b.room.colour}1f`, border: `1px ${pending ? 'dashed' : 'solid'} ${b.room.colour}`, borderLeftWidth: 4,
                      borderRadius: 3, padding: '3px 6px', color: 'var(--text)', textDecoration: 'none', fontSize: '0.84rem', lineHeight: 1.3,
                    }}
                  >
                    <strong>{time(b.startsAt, tz)}–{time(b.endsAt, tz)}</strong> {b.bandName ?? b.customer.name}
                    <div className="muted">{BOOKING_STATUS_LABELS[b.status]}{b.paidPence < b.totalPence && b.status === 'CONFIRMED' ? ' · balance due' : ''}</div>
                  </Link>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarPage() {
  const tz = useTz();
  const { data: cfg } = usePublicConfig();
  const [params, setParams] = useSearchParams();
  const today = cfg?.today ?? localDate(new Date(), tz);
  const date = params.get('date') ?? today;
  const view = params.get('view') === 'week' ? 'week' : 'day';
  const weekStart = addDays(date, -((dayOfWeek(date) + 6) % 7));
  const [from, to] = view === 'day' ? [date, date] : [weekStart, addDays(weekStart, 6)];
  const query = useQuery({
    queryKey: ['admin', 'calendar', from, to],
    queryFn: () => api.get<CalendarResponse>(`/api/admin/calendar${qs({ from, to })}`),
    refetchInterval: 30_000,
  });
  const go = (d: string, v = view) => setParams({ date: d, view: v }, { replace: true });
  const step = view === 'day' ? 1 : 7;

  return (
    <>
      <PageHeader
        title="Calendar"
        meta={view === 'day' ? dateLong(date, tz) : `${dateShort(from, tz)} – ${dateShort(to, tz)}`}
        actions={
          <>
            <div className="segmented">
              <a href="#" aria-current={view === 'day' ? 'true' : undefined} onClick={(e) => { e.preventDefault(); go(date, 'day'); }}>Day</a>
              <a href="#" aria-current={view === 'week' ? 'true' : undefined} onClick={(e) => { e.preventDefault(); go(date, 'week'); }}>Week</a>
            </div>
            <button type="button" className="btn" onClick={() => go(addDays(date, -step))} aria-label="Previous">←</button>
            <button type="button" className="btn" onClick={() => go(today)}>Today</button>
            <button type="button" className="btn" onClick={() => go(addDays(date, step))} aria-label="Next">→</button>
            <label className="visually-hidden" htmlFor="cal-date">Go to date</label>
            <input id="cal-date" type="date" className="input" style={{ width: 'auto' }} value={date} onChange={(e) => e.target.value && go(e.target.value)} />
          </>
        }
      />
      <Async query={query}>
        {(data) =>
          view === 'day' ? (
            <DayGrid data={data} date={date} />
          ) : (
            <div className="stack">
              {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
                const list = data.bookings.filter((b) => localDate(b.startsAt, tz) === d);
                return (
                  <section key={d} className="panel" aria-label={dateLong(d, tz)}>
                    <div className="panel__header">
                      <h2><a href="#" onClick={(e) => { e.preventDefault(); go(d, 'day'); }}>{dateLong(d, tz)}</a></h2>
                      <span className="muted small">{list.length} booking{list.length === 1 ? '' : 's'}</span>
                    </div>
                    {list.length > 0 && <BookingsTable bookings={list} showDate={false} />}
                  </section>
                );
              })}
            </div>
          )
        }
      </Async>
    </>
  );
}
