import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type BookingDetailDto } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Badge, PaidBadge, StatusBadge } from '../../components/Badges';
import { FormError, SelectField, TextAreaField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, Notice } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { dateLong, dateTime, money, penceToPounds, poundsToPence, time } from '../../lib/format';
import { useTz } from './DashboardPage';

function useBooking(id: string) {
  return useQuery({ queryKey: ['admin', 'booking', id], queryFn: () => api.get<BookingDetailDto>(`/api/admin/bookings/${id}`) });
}

function CancelForm({ b, onDone }: { b: BookingDetailDto; onDone: (msg: string, tone: 'ok' | 'warn') => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const form = useForm({ reason: '', refund: b.refundablePence > 0 && can('payments:refund') ? 'FULL' : 'NONE', amount: '', notifyCustomer: true });
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.values.reason.trim()) return form.setErrors({ reason: 'Give a reason (shown to the customer)' });
    const res = await form.submit(() =>
      api.post<{ booking: BookingDetailDto; refundedPence: number; refundErrors: string[] }>(`/api/admin/bookings/${b.id}/cancel`, {
        reason: form.values.reason,
        refund: form.values.refund,
        refundAmountPence: form.values.refund === 'AMOUNT' ? poundsToPence(form.values.amount) : undefined,
        notifyCustomer: form.values.notifyCustomer,
      }),
    );
    if (res) {
      qc.setQueryData(['admin', 'booking', b.id], res.booking);
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onDone(
        res.refundErrors.length
          ? `Cancelled, but the refund failed: ${res.refundErrors.join('; ')}. Retry from the payments table.`
          : `Booking cancelled${res.refundedPence ? ` and ${money(res.refundedPence, b.currency)} refunded` : ''}.`,
        res.refundErrors.length ? 'warn' : 'ok',
      );
    }
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />
      <TextField label="Reason" hint="Included in the cancellation email." {...form.field('reason')} />
      {b.refundablePence > 0 && can('payments:refund') && (
        <SelectField
          label="Refund"
          options={[
            { value: 'FULL', label: `Full refund (${money(b.refundablePence, b.currency)})` },
            { value: 'AMOUNT', label: 'Part refund' },
            { value: 'NONE', label: 'No refund' },
          ]}
          {...form.field('refund')}
        />
      )}
      {form.values.refund === 'AMOUNT' && <TextField label="Refund amount (£)" inputMode="decimal" {...form.field('amount')} />}
      <label className="checkbox" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={form.values.notifyCustomer as boolean} onChange={form.field('notifyCustomer').onChange} name="notifyCustomer" />
        <span>Email the customer</span>
      </label>
      <button type="submit" className="btn btn--danger" disabled={form.submitting}>{form.submitting ? 'Cancelling…' : 'Cancel booking'}</button>
    </form>
  );
}

function PaymentForm({ b }: { b: BookingDetailDto }) {
  const qc = useQueryClient();
  const balance = b.totalPence - b.paidPence;
  const form = useForm({ method: 'CARD_TERMINAL', amount: penceToPounds(Math.max(balance, 0)), note: '' });
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await form.submit(() => api.post<BookingDetailDto>(`/api/admin/bookings/${b.id}/payments`, { method: form.values.method, amountPence: poundsToPence(form.values.amount), note: form.values.note || null }));
    if (res) qc.setQueryData(['admin', 'booking', b.id], res);
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />
      <div className="field-row">
        <SelectField label="Method" options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} {...form.field('method')} />
        <TextField label="Amount (£)" inputMode="decimal" {...form.field('amount')} />
      </div>
      <TextField label="Note" optional {...form.field('note')} />
      <button type="submit" className="btn" disabled={form.submitting}>Record payment</button>
    </form>
  );
}

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const tz = useTz();
  const { can } = useAuth();
  const qc = useQueryClient();
  const query = useBooking(id);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null);
  const [panel, setPanel] = useState<'cancel' | 'payment' | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  async function act(path: string, success: string, body?: object) {
    setMsg(null);
    try {
      const res = await api.post<BookingDetailDto | { booking?: BookingDetailDto; url?: string; results?: string[] } | undefined>(`/api/admin/bookings/${id}/${path}`, body);
      if (res && 'reference' in res) qc.setQueryData(['admin', 'booking', id], res);
      else await query.refetch();
      void qc.invalidateQueries({ queryKey: ['admin'] });
      setMsg({ text: success, tone: 'ok' });
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Action failed', tone: 'error' });
    }
  }

  async function refund(paymentId: string, max: number, currency: string) {
    const input = window.prompt(`Refund how much? (max ${money(max, currency)})`, penceToPounds(max));
    if (!input) return;
    setMsg(null);
    try {
      qc.setQueryData(['admin', 'booking', id], await api.post<BookingDetailDto>(`/api/admin/payments/${paymentId}/refund`, { amountPence: poundsToPence(input) }));
      setMsg({ text: 'Refund issued.', tone: 'ok' });
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Refund failed', tone: 'error' });
    }
  }

  return (
    <Async query={query}>
      {(b) => {
        const started = new Date(b.startsAt) <= new Date();
        const balance = b.totalPence - b.paidPence;
        return (
          <>
            <PageHeader
              title={`${b.bandName ?? b.customerName} — ${b.room.name}`}
              documentTitle={b.reference}
              crumbs={[{ label: 'Bookings', to: '/admin/bookings' }, { label: b.reference }]}
              meta={<span className="row"><StatusBadge status={b.status} /><PaidBadge total={b.totalPence} paid={b.paidPence} /><span>{dateLong(b.startsAt, tz)}, {time(b.startsAt, tz)}–{time(b.endsAt, tz)}</span></span>}
              actions={
                can('bookings:write') && (
                  <>
                    {b.status === 'CONFIRMED' && <Link to={`/admin/bookings/${b.id}/edit`} className="btn">Edit / move</Link>}
                    {['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status) && <button type="button" className="btn btn--danger" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>Cancel…</button>}
                    {b.status === 'CONFIRMED' && started && <button type="button" className="btn" onClick={() => act('complete', 'Marked as completed.')}>Mark completed</button>}
                    {b.status === 'CONFIRMED' && started && <button type="button" className="btn" onClick={() => act('no-show', 'Marked as no-show.')}>No-show</button>}
                  </>
                )
              }
            />
            {msg && <Notice tone={msg.tone} role="status">{msg.text}</Notice>}
            {panel === 'cancel' && (
              <section className="panel" aria-labelledby="cancel-h">
                <div className="panel__header"><h2 id="cancel-h">Cancel booking</h2><p>The booking stays in the history; the slot and equipment are released.</p></div>
                <div className="panel__body"><CancelForm b={b} onDone={(text, tone) => { setPanel(null); setMsg({ text, tone }); }} /></div>
              </section>
            )}
            <div className="grid-sidebar">
              <div>
                <section className="panel" aria-labelledby="price-h">
                  <div className="panel__header"><h2 id="price-h">Price</h2><p>Snapshot of what was agreed — later price changes don't affect it.</p></div>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {b.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{money(l.amountPence, b.currency)}</td></tr>)}
                        <tr><td><strong>Total</strong></td><td className="num"><strong>{money(b.totalPence, b.currency)}</strong></td></tr>
                        <tr><td>Paid</td><td className="num">{money(b.paidPence, b.currency)}</td></tr>
                        {balance !== 0 && <tr><td>{balance > 0 ? 'Balance due' : 'Overpaid'}</td><td className="num">{money(Math.abs(balance), b.currency)}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel" aria-labelledby="pay-h">
                  <div className="panel__header">
                    <h2 id="pay-h">Payments</h2>
                    <span className="row">
                      {can('payments:write') && b.status === 'CONFIRMED' && balance > 0 && (
                        <>
                          <button type="button" className="btn btn--small" onClick={() => setPanel(panel === 'payment' ? null : 'payment')}>Record payment</button>
                          <button type="button" className="btn btn--small" onClick={() => act('payment-link', `Payment link for ${money(balance, b.currency)} emailed to ${b.customerEmail}.`)}>Email Stripe payment link</button>
                        </>
                      )}
                      {b.payments.some((p) => p.status === 'PENDING' && p.method === 'STRIPE') && (
                        <button type="button" className="btn btn--small" onClick={() => act('reconcile', 'Checked with Stripe.')}>Check with Stripe</button>
                      )}
                    </span>
                  </div>
                  {panel === 'payment' && <div className="panel__body"><PaymentForm b={b} /></div>}
                  {b.payments.length === 0 ? (
                    <div className="panel__body muted">No payments.</div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table table--stack">
                        <thead><tr><th scope="col">Date</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Refunded</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                        <tbody>
                          {b.payments.map((p) => (
                            <tr key={p.id}>
                              <td data-label="Date">{dateTime(p.paidAt ?? p.createdAt, tz)}</td>
                              <td data-label="Method">{PAYMENT_METHOD_LABELS[p.method]}{p.note && <div className="table__sub">{p.note}</div>}{p.stripePaymentIntentId && <div className="table__sub mono">{p.stripePaymentIntentId}</div>}</td>
                              <td data-label="Status"><Badge tone={p.status === 'SUCCEEDED' ? 'ok' : p.status === 'PENDING' ? 'warn' : 'neutral'} plain>{p.status.toLowerCase()}</Badge></td>
                              <td data-label="Amount" className="num">{money(p.amountPence, p.currency)}</td>
                              <td data-label="Refunded" className="num">{p.refundedPence ? money(p.refundedPence, p.currency) : '—'}</td>
                              <td data-label="">
                                {can('payments:refund') && p.status === 'SUCCEEDED' && p.amountPence > p.refundedPence && (
                                  <button type="button" className="btn btn--small" onClick={() => refund(p.id, p.amountPence - p.refundedPence, p.currency)}>Refund…</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="panel" aria-labelledby="notes-h">
                  <div className="panel__header"><h2 id="notes-h">Internal notes</h2><p>Staff only.</p></div>
                  <div className="panel__body">
                    <textarea className="textarea" aria-labelledby="notes-h" value={notes ?? b.internalNotes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={3} />
                    {notes !== null && notes !== (b.internalNotes ?? '') && (
                      <button type="button" className="btn btn--small" style={{ marginTop: 8 }} onClick={async () => {
                        try {
                          qc.setQueryData(['admin', 'booking', id], await api.patch<BookingDetailDto>(`/api/admin/bookings/${id}/notes`, { internalNotes: notes }));
                          setNotes(null);
                        } catch (err) {
                          setMsg({ text: err instanceof ApiError ? err.message : 'Could not save notes', tone: 'error' });
                        }
                      }}>Save notes</button>
                    )}
                  </div>
                </section>

                <section className="panel" aria-labelledby="hist-h">
                  <div className="panel__header"><h2 id="hist-h">History</h2></div>
                  <ul className="list">
                    {b.history.map((h, i) => <li key={i} className="spread"><span className="mono small">{h.action}</span><span className="list__meta">{h.actor ?? 'System / customer'} · {dateTime(h.createdAt, tz)}</span></li>)}
                  </ul>
                </section>
              </div>

              <div>
                <section className="panel" aria-labelledby="cust-h">
                  <div className="panel__header"><h2 id="cust-h">Customer</h2><Link to={`/admin/customers/${b.customer.id}`}>Profile</Link></div>
                  <div className="panel__body">
                    <dl className="details">
                      <dt>Name</dt><dd>{b.customerName}</dd>
                      {b.bandName && <><dt>Band</dt><dd>{b.bandName}</dd></>}
                      <dt>Email</dt><dd><a href={`mailto:${b.customerEmail}`}>{b.customerEmail}</a></dd>
                      <dt>Phone</dt><dd>{b.customerPhone ? <a href={`tel:${b.customerPhone}`}>{b.customerPhone}</a> : '—'}</dd>
                      {b.customerNotes && <><dt>Their notes</dt><dd className="pre-wrap">{b.customerNotes}</dd></>}
                    </dl>
                  </div>
                </section>
                <section className="panel" aria-labelledby="bk-h">
                  <div className="panel__header"><h2 id="bk-h">Booking</h2></div>
                  <div className="panel__body">
                    <dl className="details">
                      <dt>Reference</dt><dd className="mono">{b.reference}</dd>
                      <dt>Room</dt><dd>{b.room.name}</dd>
                      <dt>Equipment</dt><dd>{b.items.length ? b.items.map((i) => `${i.quantity} × ${i.name}`).join(', ') : 'None'}</dd>
                      <dt>Source</dt><dd>{b.source === 'ONLINE' ? 'Online' : 'Staff'}</dd>
                      <dt>Created</dt><dd>{dateTime(b.createdAt, tz)}</dd>
                      {b.expiresAt && <><dt>Hold expires</dt><dd>{dateTime(b.expiresAt, tz)}</dd></>}
                      {b.cancelledAt && <><dt>Cancelled</dt><dd>{dateTime(b.cancelledAt, tz)} by {b.cancelledBy ?? '—'}<div className="small">{b.cancellationReason}</div></dd></>}
                    </dl>
                  </div>
                </section>
                <section className="panel" aria-labelledby="em-h">
                  <div className="panel__header">
                    <h2 id="em-h">Emails</h2>
                    {b.status === 'CONFIRMED' && can('bookings:write') && <button type="button" className="btn btn--small" onClick={() => act('resend-confirmation', 'Confirmation queued.')}>Resend confirmation</button>}
                  </div>
                  {b.emails.length === 0 ? <div className="panel__body muted">None.</div> : (
                    <ul className="list">
                      {b.emails.map((e) => (
                        <li key={e.id}>
                          <div className="spread"><span>{e.kind.replace(/_/g, ' ')}</span><Badge tone={e.status === 'SENT' ? 'ok' : e.status === 'FAILED' ? 'bad' : 'warn'} plain>{e.status.toLowerCase()}</Badge></div>
                          <div className="list__meta">{e.to} · {dateTime(e.sentAt ?? e.createdAt, tz)}{e.lastError && ` · ${e.lastError}`}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}
