import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type BookingDetailDto, type CustomerDto, type EquipmentAvailability, type PriceLine } from '@habitat/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, qs } from '../../api/client';
import { FormError, SelectField, TextAreaField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice } from '../../components/States';
import { useDebounced } from '../../hooks/useDebounced';
import { duration, localDate, money, poundsToPence, time } from '../../lib/format';
import { usePublicConfig } from '../public/PublicLayout';
import { useRooms } from './BookingsPage';
import { useTz } from './DashboardPage';

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const DURATIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 15);

export function BookingFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tz = useTz();
  const { data: cfg } = usePublicConfig();
  const rooms = useRooms();
  const existing = useQuery({ queryKey: ['admin', 'booking', id], queryFn: () => api.get<BookingDetailDto>(`/api/admin/bookings/${id}`), enabled: editing });

  const [roomId, setRoomId] = useState(params.get('roomId') ?? '');
  const [date, setDate] = useState(params.get('date') ?? cfg?.today ?? '');
  const [startTime, setStartTime] = useState(params.get('startTime') ?? '18:00');
  const [durationMinutes, setDuration] = useState(120);
  const [ratePlanId, setRatePlanId] = useState('');
  const [kit, setKit] = useState<Record<string, number>>({});
  const [ignoreRules, setIgnoreRules] = useState(false);
  const [notify, setNotify] = useState(true);
  const [pricing, setPricing] = useState<'KEEP' | 'RECALCULATE'>('KEEP');
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [c, setC] = useState({ name: '', email: '', phone: '', bandName: '', customerNotes: '', internalNotes: '' });
  const [payment, setPayment] = useState({ record: false, method: 'CARD_TERMINAL', amount: '' });
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);

  // Load an existing booking into the form once.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const b = existing.data;
    if (!b || loaded) return;
    setRoomId(b.room.id);
    setDate(localDate(b.startsAt, tz));
    setStartTime(time(b.startsAt, tz));
    setDuration(Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60000));
    setRatePlanId(b.ratePlanId ?? '');
    setKit(Object.fromEntries(b.items.map((i) => [i.equipmentId, i.quantity])));
    setC({ name: b.customerName, email: b.customerEmail, phone: b.customerPhone ?? '', bandName: b.bandName ?? '', customerNotes: b.customerNotes ?? '', internalNotes: b.internalNotes ?? '' });
    setLoaded(true);
  }, [existing.data, loaded, tz]);
  useEffect(() => {
    if (!roomId && rooms.data?.[0]) setRoomId(rooms.data.find((r) => r.active)?.id ?? rooms.data[0].id);
  }, [rooms.data, roomId]);
  useEffect(() => {
    if (!date && cfg?.today) setDate(cfg.today);
  }, [cfg?.today, date]);

  const roomPlans = rooms.data?.find((r) => r.id === roomId)?.ratePlans ?? [];
  const planId = roomPlans.some((p) => p.id === ratePlanId) ? ratePlanId : (roomPlans[0]?.id ?? null);
  const selection = useMemo(() => Object.entries(kit).filter(([, q]) => q > 0).map(([equipmentId, quantity]) => ({ equipmentId, quantity })), [kit]);
  const ready = Boolean(roomId && date && startTime && durationMinutes && (!editing || loaded));
  const kitQuery = useQuery({
    queryKey: ['admin', 'kit', date, startTime, durationMinutes, id],
    queryFn: () => api.get<EquipmentAvailability[]>(`/api/admin/equipment-availability${qs({ date, startTime, durationMinutes, excludeBookingId: id })}`),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const quote = useQuery({
    queryKey: ['admin', 'quote', roomId, planId, date, startTime, durationMinutes, selection, id, ignoreRules],
    queryFn: () => api.post<{ lines: PriceLine[]; totalPence: number; endTime: string }>('/api/admin/quote', { roomId, ratePlanId: planId, date, startTime, durationMinutes, equipment: selection, excludeBookingId: id, ignoreBookingRules: ignoreRules }),
    enabled: ready,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const debounced = useDebounced(customerSearch.trim());
  const customers = useQuery({
    queryKey: ['admin', 'customers', debounced],
    queryFn: () => api.get<CustomerDto[]>(`/api/admin/customers${qs({ q: debounced })}`),
    enabled: !editing && customerMode === 'existing' && debounced.length >= 2,
  });

  if (editing && existing.isPending) return <Loading />;
  if (editing && existing.data && existing.data.status !== 'CONFIRMED') {
    return <Notice tone="warn">Only confirmed bookings can be changed. <Link to={`/admin/bookings/${id}`}>Back to booking</Link></Notice>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const slot = { roomId, ratePlanId: planId, date, startTime, durationMinutes, equipment: selection, ignoreBookingRules: ignoreRules };
    try {
      let result: BookingDetailDto;
      if (editing) {
        result = await api.put<BookingDetailDto>(`/api/admin/bookings/${id}`, {
          ...slot, pricing, notifyCustomer: notify,
          customerName: c.name, customerEmail: c.email, customerPhone: c.phone || null, bandName: c.bandName || null, customerNotes: c.customerNotes || null, internalNotes: c.internalNotes || null,
        });
      } else {
        result = await api.post<BookingDetailDto>('/api/admin/bookings', {
          ...slot,
          sendConfirmation: notify,
          customerId: customerMode === 'existing' ? customerId || null : null,
          customer: customerMode === 'new' ? { name: c.name, email: c.email, phone: c.phone || null, bandName: c.bandName || null } : undefined,
          customerNotes: c.customerNotes || null,
          internalNotes: c.internalNotes || null,
          payment: payment.record ? { method: payment.method, amountPence: poundsToPence(payment.amount), note: null } : null,
        });
      }
      await qc.invalidateQueries({ queryKey: ['admin'] });
      navigate(`/admin/bookings/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, fields: err.fields } : { message: 'Could not save', fields: {} });
      setSaving(false);
    }
  }
  const f = (k: keyof typeof c) => ({ name: k, value: c[k], onChange: (e: { target: { value: string } }) => setC((x) => ({ ...x, [k]: e.target.value })), error: error?.fields[k] ?? error?.fields[`customer.${k}`] ?? error?.fields[k === 'name' ? 'customerName' : k === 'email' ? 'customerEmail' : k] });

  return (
    <>
      <PageHeader title={editing ? `Edit ${existing.data?.reference}` : 'New booking'} crumbs={[{ label: 'Bookings', to: '/admin/bookings' }, { label: editing ? existing.data!.reference : 'New' }]} />
      <form onSubmit={onSubmit} noValidate>
        <div className="grid-sidebar">
          <div>
            <section className="panel" aria-labelledby="when-h">
              <div className="panel__header"><h2 id="when-h">Room and time</h2></div>
              <div className="panel__body">
                <div className="field-row">
                  <SelectField label="Room" name="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.active ? r.name : `${r.name} (inactive)` }))} />
                  <TextField label="Date" type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                {roomPlans.length > 0 && (
                  <SelectField label="Session type" name="ratePlanId" value={planId ?? ''} onChange={(e) => setRatePlanId(e.target.value)} options={roomPlans.map((p) => ({ value: p.id, label: p.name }))} />
                )}
                <div className="field-row">
                  <SelectField label="Start" name="startTime" value={startTime} onChange={(e) => setStartTime(e.target.value)} options={TIMES.map((t) => ({ value: t, label: t }))} />
                  <SelectField label="Length" name="duration" value={String(durationMinutes)} onChange={(e) => setDuration(Number(e.target.value))} options={DURATIONS.map((m) => ({ value: String(m), label: duration(m) }))} />
                </div>
                <label className="checkbox small">
                  <input type="checkbox" checked={ignoreRules} onChange={(e) => setIgnoreRules(e.target.checked)} />
                  <span>Allow outside opening hours (conflicts with other bookings are never allowed)</span>
                </label>
              </div>
            </section>

            <section className="panel" aria-labelledby="kit-h">
              <div className="panel__header"><h2 id="kit-h">Equipment</h2><p>Availability shown for this exact time.</p></div>
              {kitQuery.data && kitQuery.data.length === 0 && <div className="panel__body muted">No active equipment.</div>}
              {kitQuery.data && kitQuery.data.length > 0 && (
                <table className="table">
                  <tbody>
                    {kitQuery.data.map((e) => (
                      <tr key={e.id}>
                        <td>{e.name}<div className="table__sub">{money(e.pricePence, cfg?.currency)} {e.pricing === 'PER_HOUR' ? 'per hour' : 'per booking'} · {e.available} free</div></td>
                        <td style={{ width: 110 }}>
                          <label className="visually-hidden" htmlFor={`q-${e.id}`}>Quantity of {e.name}</label>
                          <input id={`q-${e.id}`} className="input" type="number" min={0} max={e.available} value={kit[e.id] ?? 0} onChange={(ev) => setKit((k) => ({ ...k, [e.id]: Math.max(0, Number(ev.target.value)) }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="panel" aria-labelledby="c-h">
              <div className="panel__header">
                <h2 id="c-h">Customer</h2>
                {!editing && (
                  <div className="segmented">
                    <a href="#" aria-current={customerMode === 'new' ? 'true' : undefined} onClick={(e) => { e.preventDefault(); setCustomerMode('new'); }}>New / by email</a>
                    <a href="#" aria-current={customerMode === 'existing' ? 'true' : undefined} onClick={(e) => { e.preventDefault(); setCustomerMode('existing'); }}>Find existing</a>
                  </div>
                )}
              </div>
              <div className="panel__body">
                {!editing && customerMode === 'existing' ? (
                  <>
                    <TextField label="Search customers" name="customerSearch" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} hint="Name, email, band or phone" optional />
                    {customers.data && (
                      <SelectField label="Customer" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder={customers.data.length ? 'Choose…' : 'No matches'} options={customers.data.map((x) => ({ value: x.id, label: `${x.name}${x.bandName ? ` (${x.bandName})` : ''} — ${x.email}` }))} error={error?.fields.customerId} />
                    )}
                  </>
                ) : (
                  <>
                    <div className="field-row">
                      <TextField label="Name" {...f('name')} />
                      <TextField label="Band / artist" optional {...f('bandName')} />
                    </div>
                    <div className="field-row">
                      <TextField label="Email" type="email" hint={editing ? undefined : 'An existing customer with this email is reused.'} {...f('email')} />
                      <TextField label="Phone" type="tel" optional {...f('phone')} />
                    </div>
                  </>
                )}
                <TextAreaField label="Customer notes" optional rows={2} {...f('customerNotes')} />
                <TextAreaField label="Internal notes" optional rows={2} hint="Staff only." {...f('internalNotes')} />
              </div>
            </section>
          </div>

          <div>
            <section className="panel" aria-labelledby="sum-h">
              <div className="panel__header"><h2 id="sum-h">Price</h2></div>
              <div className="panel__body">
                {quote.isError ? (
                  <Notice tone="error">{(quote.error as Error).message}</Notice>
                ) : quote.data ? (
                  <>
                    <ul className="kv">
                      {quote.data.lines.map((l, i) => <li key={i}><span>{l.description}</span><strong>{money(l.amountPence, cfg?.currency)}</strong></li>)}
                      <li><span>Total at current prices</span><strong>{money(quote.data.totalPence, cfg?.currency)}</strong></li>
                    </ul>
                    <p className="small muted">Ends {quote.data.endTime}. Time and equipment are available.</p>
                  </>
                ) : (
                  <p className="muted">Choose a room and time.</p>
                )}
                {editing && existing.data && (
                  <fieldset className="field" style={{ border: 0, padding: 0, margin: '12px 0' }}>
                    <legend>Pricing</legend>
                    <label className="checkbox"><input type="radio" name="pricing" checked={pricing === 'KEEP'} onChange={() => setPricing('KEEP')} /><span>Keep agreed price ({money(existing.data.totalPence, existing.data.currency)}) — moving only</span></label>
                    <label className="checkbox"><input type="radio" name="pricing" checked={pricing === 'RECALCULATE'} onChange={() => setPricing('RECALCULATE')} /><span>Recalculate at current prices</span></label>
                    {error?.fields.pricing && <p className="field__error">{error.fields.pricing}</p>}
                  </fieldset>
                )}
                {!editing && (
                  <div style={{ margin: '12px 0' }}>
                    <label className="checkbox"><input type="checkbox" checked={payment.record} onChange={(e) => setPayment((p) => ({ ...p, record: e.target.checked, amount: p.amount || (quote.data ? (quote.data.totalPence / 100).toFixed(2) : '') }))} /><span>Record a payment taken now</span></label>
                    {payment.record && (
                      <div className="field-row" style={{ marginTop: 8 }}>
                        <SelectField label="Method" name="method" value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))} options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
                        <TextField label="Amount (£)" name="amount" inputMode="decimal" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} error={error?.fields['payment.amountPence']} />
                      </div>
                    )}
                  </div>
                )}
                <label className="checkbox" style={{ marginBottom: 12 }}>
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  <span>{editing ? 'Email the customer about changes' : 'Email a confirmation to the customer'}</span>
                </label>
                <FormError message={error?.message ?? null} />
                <div className="form-actions">
                  <button type="submit" className="btn btn--primary" disabled={saving || !ready}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create booking'}</button>
                  <Link to={editing ? `/admin/bookings/${id}` : '/admin/bookings'} className="btn btn--ghost">Cancel</Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </form>
    </>
  );
}
