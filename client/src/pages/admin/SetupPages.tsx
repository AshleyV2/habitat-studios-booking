import { DAY_NAMES, EQUIPMENT_PRICING, EQUIPMENT_PRICING_LABELS, type BlockDto, type EquipmentDto, type PublicConfig, type RatePlan, type RoomDto } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { Badge } from '../../components/Badges';
import { SelectField, TextAreaField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState, Notice } from '../../components/States';
import { dateTime, money, penceToPounds, poundsToPence } from '../../lib/format';
import { useRooms } from './BookingsPage';
import { useTz } from './DashboardPage';

type Msg = { tone: 'ok' | 'error' | 'warn'; text: string } | null;
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${Object.keys(e.fields).length ? ` (${Object.values(e.fields).join('; ')})` : ''}` : 'Something went wrong');

// ---------------------------------------------------------------------------
// Rooms & pricing
// ---------------------------------------------------------------------------

/** The full room payload for PUT, so saving one part never drops another (plans, photo). */
const roomBody = (r?: RoomDto) =>
  r
    ? { name: r.name, description: r.description, capacity: r.capacity, hourlyRatePence: r.hourlyRatePence, colour: r.colour, active: r.active, sortOrder: r.sortOrder, imageUrl: r.imageUrl, ratePlans: r.ratePlans, minDurationMinutes: r.minDurationMinutes, lengthDiscounts: r.lengthDiscounts }
    : { ratePlans: [] as RatePlan[], minDurationMinutes: null, lengthDiscounts: [] };

type PlanDraft = { id: string; name: string; description: string; prices: { hours: string; price: string }[]; extra: string; minHours: string; from: string; until: string };
const toDraft = (p: RatePlan): PlanDraft => ({
  id: p.id, name: p.name, description: p.description ?? '',
  prices: [...p.prices].sort((a, b) => a.minutes - b.minutes).map((x) => ({ hours: String(x.minutes / 60), price: penceToPounds(x.pricePence) })),
  extra: p.extraHourPence === null ? '' : penceToPounds(p.extraHourPence),
  minHours: p.minDurationMinutes ? String(p.minDurationMinutes / 60) : '',
  from: p.earliestStartTime ?? '', until: p.latestEndTime ?? '',
});
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';

/** Session types priced by length, e.g. Band rehearsal (2 h £29, 3 h £36.75…) and Solo (£11/h). */
function RatePlans({ room, onSaved }: { room: RoomDto; onSaved: () => void }) {
  const [plans, setPlans] = useState<PlanDraft[]>(() => room.ratePlans.map(toDraft));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const edit = (i: number, patch: Partial<PlanDraft>) => setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save() {
    setMsg(null);
    setBusy(true);
    const used = new Set<string>();
    const ratePlans = plans.map((p) => {
      let id = p.id || slug(p.name);
      while (used.has(id)) id = `${id}-2`;
      used.add(id);
      return {
        id, name: p.name, description: p.description || null,
        prices: p.prices.filter((x) => x.hours && x.price).map((x) => ({ minutes: Math.round(Number(x.hours) * 60), pricePence: poundsToPence(x.price) })),
        extraHourPence: p.extra ? poundsToPence(p.extra) : null,
        minDurationMinutes: p.minHours ? Math.round(Number(p.minHours) * 60) : null,
        maxDurationMinutes: null,
        earliestStartTime: p.from || null, latestEndTime: p.until || null,
      };
    });
    try {
      await api.put(`/api/admin/rooms/${room.id}`, { ...roomBody(room), ratePlans });
      onSaved();
      setMsg({ tone: 'ok', text: 'Session prices saved. New bookings use them straight away.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 style={{ margin: '20px 0 4px' }}>Session prices by length</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        When a room has session types, customers pick one and pay its price for the length they choose; the hourly rate and time-of-week prices are not used.
        Leave empty to charge per hour.
      </p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {plans.map((p, i) => (
        <fieldset key={i} className="panel" style={{ padding: 14, margin: '0 0 12px' }}>
          <legend className="small"><strong>{p.name || 'New session type'}</strong></legend>
          <div className="field-row">
            <TextField label="Name" name={`plan-${i}-name`} value={p.name} onChange={(e) => edit(i, { name: e.target.value })} hint="e.g. Band rehearsal, Solo" />
            <TextField label="Description" optional name={`plan-${i}-desc`} value={p.description} onChange={(e) => edit(i, { description: e.target.value })} />
          </div>
          <table className="table" style={{ maxWidth: 420 }}>
            <thead><tr><th>Length (hours)</th><th>Price (£)</th><th /></tr></thead>
            <tbody>
              {p.prices.map((x, k) => (
                <tr key={k}>
                  <td><input className="input" aria-label="Hours" inputMode="decimal" value={x.hours} onChange={(e) => edit(i, { prices: p.prices.map((y, m) => (m === k ? { ...y, hours: e.target.value } : y)) })} /></td>
                  <td><input className="input" aria-label="Price" inputMode="decimal" value={x.price} onChange={(e) => edit(i, { prices: p.prices.map((y, m) => (m === k ? { ...y, price: e.target.value } : y)) })} /></td>
                  <td><button type="button" className="btn btn--small" onClick={() => edit(i, { prices: p.prices.filter((_, m) => m !== k) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn--small" style={{ margin: '6px 0 12px' }} onClick={() => edit(i, { prices: [...p.prices, { hours: String((Number(p.prices.at(-1)?.hours) || 1) + 1), price: '' }] })}>Add a length</button>
          <div className="field-row">
            <TextField label="Each extra hour (£)" optional name={`plan-${i}-extra`} inputMode="decimal" value={p.extra} onChange={(e) => edit(i, { extra: e.target.value })} hint="Beyond the longest length above. With no lengths listed, this is the hourly price." />
            <TextField label="Shortest session (hours)" optional name={`plan-${i}-min`} inputMode="decimal" value={p.minHours} onChange={(e) => edit(i, { minHours: e.target.value })} hint="Only needed with an hourly price." />
          </div>
          <div className="field-row">
            <TextField label="Bookable from" optional name={`plan-${i}-from`} value={p.from} onChange={(e) => edit(i, { from: e.target.value })} hint="HH:MM — blank = opening time" />
            <TextField label="Must end by" optional name={`plan-${i}-until`} value={p.until} onChange={(e) => edit(i, { until: e.target.value })} hint="HH:MM — blank = closing time" />
          </div>
          <button type="button" className="btn btn--small btn--danger" onClick={() => setPlans((ps) => ps.filter((_, j) => j !== i))}>Remove session type</button>
        </fieldset>
      ))}
      <span className="row">
        <button type="button" className="btn" onClick={() => setPlans((ps) => [...ps, { id: '', name: '', description: '', prices: [{ hours: '2', price: '' }], extra: '', minHours: '', from: '', until: '' }])}>Add session type</button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>Save session prices</button>
      </span>
    </div>
  );
}

function RoomForm({ room, onSaved }: { room?: RoomDto; onSaved: () => void }) {
  const [v, setV] = useState({
    name: room?.name ?? '', description: room?.description ?? '', capacity: room?.capacity ? String(room.capacity) : '',
    rate: room ? penceToPounds(room.hourlyRatePence) : '', colour: room?.colour ?? '#3d6b8f', active: room?.active ?? true, sortOrder: String(room?.sortOrder ?? 0),
    imageUrl: room?.imageUrl ?? '',
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = {
      ...roomBody(room),
      name: v.name, description: v.description || null, capacity: v.capacity ? Number(v.capacity) : null, hourlyRatePence: poundsToPence(v.rate || '0'),
      colour: v.colour, active: v.active, sortOrder: Number(v.sortOrder) || 0, imageUrl: v.imageUrl || null,
    };
    try {
      if (room) await api.put(`/api/admin/rooms/${room.id}`, body);
      else await api.post('/api/admin/rooms', body);
      onSaved();
      if (!room) setV({ ...v, name: '', description: '', capacity: '', rate: '' });
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={onSubmit} noValidate>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="field-row">
        <TextField label="Name" name="name" value={v.name} onChange={set('name')} />
        <TextField label="Standard rate (£ per hour)" name="rate" inputMode="decimal" value={v.rate} onChange={set('rate')} />
      </div>
      <TextAreaField label="Description" optional name="description" rows={2} value={v.description} onChange={set('description')} hint="Shown to customers." />
      <TextField label="Photo" optional name="imageUrl" value={v.imageUrl} onChange={set('imageUrl')} hint="A file in the website's site folder (e.g. site/room-1.jpg) or an https:// link." />
      <div className="field-row">
        <TextField label="Capacity (people)" optional name="capacity" inputMode="numeric" value={v.capacity} onChange={set('capacity')} />
        <TextField label="Calendar colour" name="colour" type="color" value={v.colour} onChange={set('colour')} />
      </div>
      <div className="field-row">
        <TextField label="Display order" name="sortOrder" inputMode="numeric" value={v.sortOrder} onChange={set('sortOrder')} />
        <label className="checkbox" style={{ alignSelf: 'center' }}><input type="checkbox" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} /><span>Bookable (inactive rooms keep their history)</span></label>
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>{room ? 'Save room' : 'Add room'}</button>
    </form>
  );
}

function PriceRules({ room, onSaved }: { room: RoomDto; onSaved: () => void }) {
  const [v, setV] = useState({ label: 'Evening', days: [1, 2, 3, 4, 5] as number[], start: '18:00', end: '24:00', rate: '' });
  const [msg, setMsg] = useState<Msg>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post(`/api/admin/rooms/${room.id}/price-rules`, { label: v.label, daysOfWeek: v.days, startTime: v.start, endTime: v.end, hourlyRatePence: poundsToPence(v.rate || '0') });
      onSaved();
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    }
  }
  async function remove(ruleId: string) {
    if (!window.confirm('Remove this price rule? Existing bookings keep the price they were charged.')) return;
    await api.del(`/api/admin/rooms/${room.id}/price-rules/${ruleId}`);
    onSaved();
  }
  return (
    <div>
      <h3 style={{ margin: '16px 0 8px' }}>Time-of-week prices</h3>
      {room.priceRules.length === 0 ? <p className="muted small">None — the standard rate applies at all times.</p> : (
        <table className="table">
          <tbody>
            {room.priceRules.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{r.daysOfWeek.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ')}</td>
                <td>{r.startTime}–{r.endTime}</td>
                <td className="num">{money(r.hourlyRatePence)}/h</td>
                <td><button type="button" className="btn btn--small btn--danger" onClick={() => remove(r.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} noValidate style={{ marginTop: 10 }}>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
          <legend className="small">Days</legend>
          <span className="row">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} className="checkbox small">
                <input type="checkbox" checked={v.days.includes(d)} onChange={(e) => setV((x) => ({ ...x, days: e.target.checked ? [...x.days, d] : x.days.filter((y) => y !== d) }))} />
                <span>{DAY_NAMES[d]!.slice(0, 3)}</span>
              </label>
            ))}
          </span>
        </fieldset>
        <div className="field-row">
          <TextField label="Label" name="label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
          <TextField label="Rate (£ per hour)" name="rate" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
        </div>
        <div className="field-row">
          <TextField label="From" name="start" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} hint="HH:MM" />
          <TextField label="Until" name="end" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} hint="HH:MM, 24:00 = midnight" />
        </div>
        <button type="submit" className="btn">Add price rule</button>
      </form>
    </div>
  );
}

/** Hourly rooms: the shortest booking, and "cheaper for longer" discounts. */
function LengthRules({ room, onSaved }: { room: RoomDto; onSaved: () => void }) {
  const [min, setMin] = useState(room.minDurationMinutes ? String(room.minDurationMinutes / 60) : '');
  const [tiers, setTiers] = useState(() => [...room.lengthDiscounts].sort((a, b) => a.fromMinutes - b.fromMinutes).map((d) => ({ hours: String(d.fromMinutes / 60), percent: String(d.percentOff) })));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const minutes = min ? Math.round(Number(min) * 60) : null;
    const lengthDiscounts = tiers.filter((t) => t.hours && t.percent).map((t) => ({ fromMinutes: Math.round(Number(t.hours) * 60), percentOff: Math.round(Number(t.percent)) }));
    try {
      await api.put(`/api/admin/rooms/${room.id}`, { ...roomBody(room), minDurationMinutes: minutes, lengthDiscounts });
      onSaved();
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} noValidate style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: '1rem', margin: '0 0 4px' }}>Booking length and discounts</h3>
      <p className="muted small" style={{ marginTop: 0 }}>Set a minimum booking for this room, and make longer bookings cheaper. The biggest discount a booking qualifies for applies to the room (not equipment).</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <TextField label="Minimum booking (hours)" optional name="minHours" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} hint="e.g. 2 means every booking is at least 2 hours. Blank = the studio-wide minimum (Settings)." />
      <div className="field">
        <span>Cheaper for longer</span>
        {tiers.length === 0 && <p className="muted small" style={{ margin: '4px 0 8px' }}>No discounts: every hour costs the same.</p>}
        {tiers.map((t, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <span className="small">Bookings of</span>
            <input className="input" style={{ width: 70 }} inputMode="decimal" aria-label="Hours or more" value={t.hours} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, hours: e.target.value } : x)))} />
            <span className="small">hours or more:</span>
            <input className="input" style={{ width: 70 }} inputMode="numeric" aria-label="Percent off" value={t.percent} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, percent: e.target.value } : x)))} />
            <span className="small">% off</span>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setTiers(tiers.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        {tiers.length < 6 && <button type="button" className="btn btn--small" onClick={() => setTiers([...tiers, { hours: String((Number(tiers.at(-1)?.hours) || 2) + 1), percent: '' }])}>Add a discount</button>}
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>Save length and discounts</button>
    </form>
  );
}

export function RoomsPage() {
  const qc = useQueryClient();
  const rooms = useRooms();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'rooms'] });
  return (
    <>
      <PageHeader title="Rooms & pricing" meta="Changes apply to new bookings. Existing bookings keep the price they were charged." />
      <Async query={rooms}>
        {(list) => (
          <>
            {list.length === 0 && <Notice tone="warn">No rooms yet. Add your first room below — customers can't book until you do.</Notice>}
            {list.map((r) => (
              <section key={r.id} className="panel" aria-labelledby={`room-${r.id}`}>
                <div className="panel__header">
                  <h2 id={`room-${r.id}`}><span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, background: r.colour, borderRadius: 2, marginRight: 8 }} />{r.name}</h2>
                  <span className="row">
                    {!r.active && <Badge>Inactive</Badge>}
                    {r.ratePlans.length === 0 && r.minDurationMinutes && <Badge>Min {r.minDurationMinutes / 60} h</Badge>}
                    {r.ratePlans.length === 0 && r.lengthDiscounts.length > 0 && <Badge>Up to {Math.max(...r.lengthDiscounts.map((d) => d.percentOff))}% off longer bookings</Badge>}
                    <span>{money(r.hourlyRatePence)}/h</span>
                    <button type="button" className="btn btn--small" onClick={() => setEditing(editing === r.id ? null : r.id)} aria-expanded={editing === r.id}>{editing === r.id ? 'Close' : 'Edit'}</button>
                  </span>
                </div>
                {editing === r.id && (
                  <div className="panel__body">
                    <RoomForm room={r} onSaved={refresh} />
                    <RatePlans room={r} onSaved={refresh} />
                    {r.ratePlans.length === 0 && <PriceRules room={r} onSaved={refresh} />}
                    {r.ratePlans.length === 0 && <LengthRules room={r} onSaved={refresh} />}
                  </div>
                )}
              </section>
            ))}
            <section className="panel" aria-labelledby="new-room-h">
              <div className="panel__header"><h2 id="new-room-h">Add a room</h2></div>
              <div className="panel__body"><RoomForm onSaved={refresh} /></div>
            </section>
          </>
        )}
      </Async>
    </>
  );
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

function EquipmentForm({ item, onSaved }: { item?: EquipmentDto; onSaved: () => void }) {
  const [v, setV] = useState({ name: item?.name ?? '', description: item?.description ?? '', price: item ? penceToPounds(item.pricePence) : '', pricing: item?.pricing ?? 'PER_BOOKING', quantity: String(item?.quantity ?? 1), active: item?.active ?? true, sortOrder: String(item?.sortOrder ?? 0) });
  const [msg, setMsg] = useState<Msg>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body = { name: v.name, description: v.description || null, pricePence: poundsToPence(v.price || '0'), pricing: v.pricing, quantity: Number(v.quantity), active: v.active, sortOrder: Number(v.sortOrder) || 0 };
    try {
      if (item) await api.put(`/api/admin/equipment/${item.id}`, body);
      else await api.post('/api/admin/equipment', body);
      onSaved();
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    }
  }
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={onSubmit} noValidate>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="field-row">
        <TextField label="Name" name="name" value={v.name} onChange={set('name')} />
        <TextField label="Quantity owned" name="quantity" inputMode="numeric" value={v.quantity} onChange={set('quantity')} hint="Units available across all rooms at once." />
      </div>
      <TextField label="Description" optional name="description" value={v.description} onChange={set('description')} />
      <div className="field-row">
        <TextField label="Price (£)" name="price" inputMode="decimal" value={v.price} onChange={set('price')} />
        <SelectField label="Charged" name="pricing" value={v.pricing} onChange={set('pricing')} options={EQUIPMENT_PRICING.map((p) => ({ value: p, label: EQUIPMENT_PRICING_LABELS[p] }))} />
      </div>
      <label className="checkbox" style={{ marginBottom: 12 }}><input type="checkbox" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} /><span>Available to hire</span></label>
      <button type="submit" className="btn btn--primary">{item ? 'Save' : 'Add equipment'}</button>
    </form>
  );
}

export function EquipmentPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'equipment'], queryFn: () => api.get<EquipmentDto[]>('/api/admin/equipment') });
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'equipment'] });
  return (
    <>
      <PageHeader title="Equipment" meta="Availability is worked out per time slot: if you own 4 and 3 are booked at a time, 1 remains." />
      <Async query={query}>
        {(list) => (
          <>
            <div className="panel">
              {list.length === 0 ? <EmptyState title="No equipment yet." /> : (
                <table className="table table--stack">
                  <thead><tr><th scope="col">Item</th><th scope="col" className="num">Owned</th><th scope="col" className="num">Price</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Edit</span></th></tr></thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id}>
                        <td className="table__head-cell" data-label="Item">{e.name}{e.description && <div className="table__sub">{e.description}</div>}
                          {editing === e.id && <div style={{ marginTop: 12 }}><EquipmentForm item={e} onSaved={refresh} /></div>}
                        </td>
                        <td data-label="Owned" className="num">{e.quantity}</td>
                        <td data-label="Price" className="num">{money(e.pricePence)} {EQUIPMENT_PRICING_LABELS[e.pricing]}</td>
                        <td data-label="Status">{e.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                        <td data-label=""><button type="button" className="btn btn--small" onClick={() => setEditing(editing === e.id ? null : e.id)}>{editing === e.id ? 'Close' : 'Edit'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <section className="panel" aria-labelledby="new-eq-h">
              <div className="panel__header"><h2 id="new-eq-h">Add equipment</h2></div>
              <div className="panel__body"><EquipmentForm onSaved={refresh} /></div>
            </section>
          </>
        )}
      </Async>
    </>
  );
}

// ---------------------------------------------------------------------------
// Opening hours & closures
// ---------------------------------------------------------------------------

type Day = PublicConfig['openingHours'][number];

export function HoursPage() {
  const tz = useTz();
  const qc = useQueryClient();
  const rooms = useRooms();
  const hours = useQuery({ queryKey: ['admin', 'hours'], queryFn: () => api.get<Day[]>('/api/admin/opening-hours') });
  const blocks = useQuery({ queryKey: ['admin', 'blocks'], queryFn: () => api.get<BlockDto[]>('/api/admin/blocks') });
  const [days, setDays] = useState<Day[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [block, setBlock] = useState({ roomId: '', startDate: '', startTime: '09:00', endDate: '', endTime: '24:00', reason: '' });
  const [blockMsg, setBlockMsg] = useState<Msg>(null);
  useEffect(() => {
    if (hours.data && !days) setDays(hours.data);
  }, [hours.data, days]);

  async function saveHours(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      setDays(await api.put<Day[]>('/api/admin/opening-hours', days));
      void qc.invalidateQueries({ queryKey: ['public-config'] });
      setMsg({ tone: 'ok', text: 'Opening hours saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    }
  }
  async function addBlock(e: FormEvent) {
    e.preventDefault();
    setBlockMsg(null);
    try {
      const res = await api.post<{ affectedBookings: { id: string; reference: string }[] }>('/api/admin/blocks', { ...block, roomId: block.roomId || null, endDate: block.endDate || block.startDate });
      void qc.invalidateQueries({ queryKey: ['admin', 'blocks'] });
      setBlockMsg(
        res.affectedBookings.length
          ? { tone: 'warn', text: `Closure added. ${res.affectedBookings.length} existing booking(s) fall inside it and were NOT cancelled: ${res.affectedBookings.map((b) => b.reference).join(', ')}.` }
          : { tone: 'ok', text: 'Closure added.' },
      );
    } catch (err) {
      setBlockMsg({ tone: 'error', text: errText(err) });
    }
  }
  const update = (d: number, patch: Partial<Day>) => setDays((all) => all!.map((x) => (x.dayOfWeek === d ? { ...x, ...patch } : x)));

  return (
    <>
      <PageHeader title="Opening hours & closures" meta={`Times are in ${tz}.`} />
      <section className="panel" aria-labelledby="hours-h">
        <div className="panel__header"><h2 id="hours-h">Weekly hours</h2><p>Customers can only book inside these hours.</p></div>
        <div className="panel__body">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {!days ? <p className="muted">Loading…</p> : (
            <form onSubmit={saveHours}>
              <table className="table">
                <thead><tr><th scope="col">Day</th><th scope="col">Open</th><th scope="col">From</th><th scope="col">Until</th></tr></thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const day = days.find((x) => x.dayOfWeek === d)!;
                    return (
                      <tr key={d}>
                        <td>{DAY_NAMES[d]}</td>
                        <td><label className="checkbox"><input type="checkbox" checked={day.isOpen} onChange={(e) => update(d, { isOpen: e.target.checked })} /><span className="visually-hidden">Open on {DAY_NAMES[d]}</span></label></td>
                        <td><input className="input" aria-label={`${DAY_NAMES[d]} opening`} value={day.openTime} disabled={!day.isOpen} onChange={(e) => update(d, { openTime: e.target.value })} /></td>
                        <td><input className="input" aria-label={`${DAY_NAMES[d]} closing`} value={day.closeTime} disabled={!day.isOpen} onChange={(e) => update(d, { closeTime: e.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="small muted">Use 24:00 for midnight.</p>
              <button type="submit" className="btn btn--primary">Save hours</button>
            </form>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="closures-h">
        <div className="panel__header"><h2 id="closures-h">Closures & holds</h2><p>Holidays, maintenance or private events. Blocks online and staff bookings.</p></div>
        <Async query={blocks}>
          {(list) => list.length === 0 ? <div className="panel__body muted">No upcoming closures.</div> : (
            <table className="table table--stack">
              <thead><tr><th scope="col">From</th><th scope="col">Until</th><th scope="col">Room</th><th scope="col">Reason</th><th scope="col"><span className="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td data-label="From">{dateTime(b.startsAt, tz)}</td>
                    <td data-label="Until">{dateTime(b.endsAt, tz)}</td>
                    <td data-label="Room">{b.roomName ?? 'Whole studio'}</td>
                    <td data-label="Reason">{b.reason}</td>
                    <td data-label=""><button type="button" className="btn btn--small btn--danger" onClick={async () => { await api.del(`/api/admin/blocks/${b.id}`); void qc.invalidateQueries({ queryKey: ['admin', 'blocks'] }); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
        <div className="panel__body" style={{ borderTop: '1px solid var(--border)' }}>
          {blockMsg && <Notice tone={blockMsg.tone}>{blockMsg.text}</Notice>}
          <form onSubmit={addBlock} noValidate className="form">
            <SelectField label="Room" name="roomId" value={block.roomId} onChange={(e) => setBlock({ ...block, roomId: e.target.value })} placeholder="Whole studio" options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
            <div className="field-row">
              <TextField label="From date" name="startDate" type="date" value={block.startDate} onChange={(e) => setBlock({ ...block, startDate: e.target.value })} />
              <TextField label="From time" name="startTime" value={block.startTime} onChange={(e) => setBlock({ ...block, startTime: e.target.value })} />
            </div>
            <div className="field-row">
              <TextField label="Until date" name="endDate" type="date" optional value={block.endDate} onChange={(e) => setBlock({ ...block, endDate: e.target.value })} hint="Leave empty for the same day." />
              <TextField label="Until time" name="endTime" value={block.endTime} onChange={(e) => setBlock({ ...block, endTime: e.target.value })} />
            </div>
            <TextField label="Reason" name="reason" value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} />
            <button type="submit" className="btn btn--primary">Add closure</button>
          </form>
        </div>
      </section>
    </>
  );
}
