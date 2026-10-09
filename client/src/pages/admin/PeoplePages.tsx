import { customerUpdateSchema, PAYMENT_METHOD_LABELS, type BookingSummaryDto, type CustomerDto, type PaymentDto } from '@habitat/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, qs } from '../../api/client';
import { Badge } from '../../components/Badges';
import { FormError, TextAreaField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { useDebounced } from '../../hooks/useDebounced';
import { useForm } from '../../hooks/useForm';
import { dateShort, dateTime, money } from '../../lib/format';
import { BookingsTable, useTz } from './DashboardPage';

export function CustomersPage() {
  const tz = useTz();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const query = useQuery({ queryKey: ['admin', 'customers', q], queryFn: () => api.get<CustomerDto[]>(`/api/admin/customers${qs({ q })}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Customers" meta="Created automatically when someone books." />
      <div className="filters" role="search">
        <div className="field">
          <label htmlFor="c-q">Search</label>
          <input id="c-q" className="input" type="search" placeholder="Name, email, band, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="panel">
        <Async query={query}>
          {(list) =>
            list.length === 0 ? <EmptyState title={q ? 'No customers match.' : 'No customers yet.'} /> : (
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead><tr><th scope="col">Name</th><th scope="col">Band</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col" className="num">Bookings</th><th scope="col">Last booking</th></tr></thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td className="table__head-cell" data-label="Name"><Link to={`/admin/customers/${c.id}`} className="table__primary">{c.name}</Link></td>
                        <td data-label="Band">{c.bandName ?? '—'}</td>
                        <td data-label="Email">{c.email}</td>
                        <td data-label="Phone">{c.phone ?? '—'}</td>
                        <td data-label="Bookings" className="num">{c.bookingCount}</td>
                        <td data-label="Last booking">{c.lastBookingAt ? dateShort(c.lastBookingAt, tz) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </div>
    </>
  );
}

interface CustomerDetail {
  customer: CustomerDto;
  bookings: BookingSummaryDto[];
  totals: { paidPence: number; cancelled: number; noShows: number };
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api.get<CustomerDetail>(`/api/admin/customers/${id}`) });
  const form = useForm({ name: '', email: '', phone: '', bandName: '', notes: '' });
  const [saved, setSaved] = useState(false);
  const { setValues } = form;
  useEffect(() => {
    const c = query.data?.customer;
    if (c) setValues({ name: c.name, email: c.email, phone: c.phone ?? '', bandName: c.bandName ?? '', notes: c.notes ?? '' });
  }, [query.data, setValues]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const input = form.validate(customerUpdateSchema);
    if (!input) return;
    const res = await form.submit(() => api.put<CustomerDetail>(`/api/admin/customers/${id}`, input));
    if (res) {
      qc.setQueryData(['admin', 'customer', id], res);
      setSaved(true);
    }
  }

  return (
    <Async query={query}>
      {(d) => (
        <>
          <PageHeader title={d.customer.name} crumbs={[{ label: 'Customers', to: '/admin/customers' }, { label: d.customer.name }]} meta={`${d.bookings.length} bookings · ${money(d.totals.paidPence)} paid · ${d.totals.cancelled} cancelled · ${d.totals.noShows} no-shows`}
            actions={can('bookings:write') && <Link className="btn btn--primary" to="/admin/bookings/new">New booking</Link>} />
          <div className="grid-sidebar">
            <section className="panel" aria-labelledby="cb-h">
              <div className="panel__header"><h2 id="cb-h">Booking history</h2></div>
              {d.bookings.length ? <BookingsTable bookings={d.bookings} /> : <EmptyState title="No bookings." />}
            </section>
            <section className="panel" aria-labelledby="cd-h">
              <div className="panel__header"><h2 id="cd-h">Details</h2></div>
              <div className="panel__body">
                <form onSubmit={onSubmit} noValidate>
                  <FormError message={form.formError} />
                  <TextField label="Name" {...form.field('name')} />
                  <TextField label="Email" type="email" {...form.field('email')} />
                  <TextField label="Phone" optional {...form.field('phone')} />
                  <TextField label="Band / artist" optional {...form.field('bandName')} />
                  <TextAreaField label="Notes" optional rows={3} hint="Staff only." {...form.field('notes')} />
                  {can('customers:write') && <button type="submit" className="btn btn--primary" disabled={form.submitting}>Save</button>}
                  {saved && <span className="small" role="status" style={{ marginLeft: 8, color: 'var(--ok-fg)' }}>Saved.</span>}
                </form>
              </div>
            </section>
          </div>
        </>
      )}
    </Async>
  );
}

export function PaymentsPage() {
  const tz = useTz();
  const query = useQuery({ queryKey: ['admin', 'payments'], queryFn: () => api.get<PaymentDto[]>('/api/admin/payments') });
  return (
    <>
      <PageHeader title="Payments" meta="Online (Stripe) and payments recorded at the desk. Most recent 300." />
      <div className="panel">
        <Async query={query}>
          {(list) =>
            list.length === 0 ? <EmptyState title="No payments yet." /> : (
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead><tr><th scope="col">Date</th><th scope="col">Booking</th><th scope="col">Customer</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Refunded</th></tr></thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Date" className="nowrap">{dateTime(p.paidAt ?? p.createdAt, tz)}</td>
                        <td data-label="Booking" className="table__head-cell"><Link to={`/admin/bookings/${p.bookingId}`} className="mono">{p.bookingReference}</Link></td>
                        <td data-label="Customer">{p.customerName}</td>
                        <td data-label="Method">{PAYMENT_METHOD_LABELS[p.method]}</td>
                        <td data-label="Status"><Badge tone={p.status === 'SUCCEEDED' ? 'ok' : p.status === 'PENDING' ? 'warn' : 'bad'} plain>{p.status.toLowerCase()}</Badge></td>
                        <td data-label="Amount" className="num">{money(p.amountPence, p.currency)}</td>
                        <td data-label="Refunded" className="num">{p.refundedPence ? money(p.refundedPence, p.currency) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </div>
    </>
  );
}
