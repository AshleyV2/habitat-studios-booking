import type { BookingSummaryDto, DashboardResponse } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PaidBadge, StatusBadge } from '../../components/Badges';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { dateLong, dateShort, money, time } from '../../lib/format';
import { usePublicConfig } from '../public/PublicLayout';

export const useTz = () => usePublicConfig().data?.timezone ?? 'Europe/London';

export function BookingsTable({ bookings, showDate = true }: { bookings: BookingSummaryDto[]; showDate?: boolean }) {
  const tz = useTz();
  return (
    <div className="table-wrap">
      <table className="table table--stack">
        <thead>
          <tr>
            {showDate && <th scope="col">Date</th>}
            <th scope="col">Time</th>
            <th scope="col">Room</th>
            <th scope="col">Customer</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Total</th>
            <th scope="col">Payment</th>
            <th scope="col">Ref</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              {showDate && <td data-label="Date" className="nowrap">{dateShort(b.startsAt, tz)}</td>}
              <td data-label="Time" className="nowrap table__head-cell"><Link to={`/admin/bookings/${b.id}`} className="table__primary">{time(b.startsAt, tz)}–{time(b.endsAt, tz)}</Link></td>
              <td data-label="Room"><span className="row"><span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: b.room.colour, display: 'inline-block' }} />{b.room.name}</span></td>
              <td data-label="Customer">{b.customer.name}{b.bandName && <div className="table__sub">{b.bandName}</div>}</td>
              <td data-label="Status"><StatusBadge status={b.status} /></td>
              <td data-label="Total" className="num">{money(b.totalPence, b.currency)}</td>
              <td data-label="Payment"><PaidBadge total={b.totalPence} paid={b.paidPence} /></td>
              <td data-label="Ref" className="mono small">{b.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage() {
  const { me, can } = useAuth();
  const tz = useTz();
  const query = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<DashboardResponse>('/api/admin/dashboard'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="Dashboard" meta={`Signed in as ${me?.user.name}`} actions={can('bookings:write') && <Link to="/admin/bookings/new" className="btn btn--primary">New booking</Link>} />
      <Async query={query}>
        {(d) => {
          const setupTodo = [
            !d.setup.rooms && { text: 'Add your rooms and hourly prices', to: '/admin/rooms' },
            !d.setup.openingHours && { text: 'Set your opening hours (customers see no times until you do)', to: '/admin/hours' },
            !d.setup.stripe && { text: 'Configure Stripe so customers can pay online (see docs/INSTALL.md)', to: '/admin/health' },
            !d.setup.smtp && { text: 'Configure outgoing email (SMTP) so confirmations are sent', to: '/admin/email' },
            !d.setup.adminEmail && { text: 'Set an address for new-booking notifications', to: '/admin/settings' },
          ].filter(Boolean) as { text: string; to: string }[];
          return (
            <>
              {setupTodo.length > 0 && (
                <section className="panel" aria-labelledby="setup-h">
                  <div className="panel__header"><h2 id="setup-h">Finish setting up</h2></div>
                  <ul className="list">
                    {setupTodo.map((t) => <li key={t.to}><Link to={t.to}>{t.text}</Link></li>)}
                  </ul>
                </section>
              )}
              {d.emailProblems > 0 && (
                <div className="notice notice--error" role="status"><div>{d.emailProblems} email(s) could not be delivered. <Link to="/admin/email">Review the outbox</Link>.</div></div>
              )}
              <div className="figures" role="list">
                <div className="figure" role="listitem"><div className="figure__label">Today</div><div className="figure__value">{d.todaysBookings.filter((b) => b.status !== 'PENDING_PAYMENT').length}</div></div>
                <Link to="/admin/bookings?status=CONFIRMED" className="figure" role="listitem"><div className="figure__label">Upcoming confirmed</div><div className="figure__value">{d.upcomingCount}</div></Link>
                <Link to="/admin/bookings?status=PENDING_PAYMENT" className="figure" role="listitem"><div className="figure__label">Awaiting payment</div><div className="figure__value">{d.pendingPayments}</div></Link>
                <div className="figure" role="listitem"><div className="figure__label">Balances owed</div><div className="figure__value">{money(d.outstandingBalances.totalPence)}</div></div>
              </div>
              <section className="panel" aria-labelledby="today-h">
                <div className="panel__header">
                  <h2 id="today-h">Today — {dateLong(d.today, tz)}</h2>
                  <Link to="/admin/calendar">Open calendar</Link>
                </div>
                {d.todaysBookings.length === 0 ? <EmptyState title="No bookings today." /> : <BookingsTable bookings={d.todaysBookings} showDate={false} />}
              </section>
            </>
          );
        }}
      </Async>
    </>
  );
}
