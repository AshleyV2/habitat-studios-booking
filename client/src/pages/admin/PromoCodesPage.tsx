import type { PromoCodeDto, RoomDto } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { Badge } from '../../components/Badges';
import { SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState, Notice } from '../../components/States';
import { money, penceToPounds, poundsToPence } from '../../lib/format';
import { useRooms } from './BookingsPage';

const usePromoCodes = () => useQuery({ queryKey: ['admin', 'promo-codes'], queryFn: () => api.get<PromoCodeDto[]>('/api/admin/promo-codes') });
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${Object.keys(e.fields).length ? ` (${Object.values(e.fields).join('; ')})` : ''}` : 'Something went wrong');

const offLabel = (p: Pick<PromoCodeDto, 'kind' | 'value'>) => (p.kind === 'PERCENT' ? `${p.value}% off` : `${money(p.value)} off`);

/** Plain-English summary of a code's limits, e.g. "From 1 Nov · Room A only · 3 of 50 used". */
function limits(p: PromoCodeDto, rooms: RoomDto[]) {
  const roomNames = p.roomIds.map((id) => rooms.find((r) => r.id === id)?.name ?? 'a deleted room');
  return [
    p.validFrom && `from ${p.validFrom}`,
    p.validUntil && `until ${p.validUntil}`,
    roomNames.length && `${roomNames.join(', ')} only`,
    p.minDurationMinutes && `${p.minDurationMinutes / 60} h+ bookings`,
    p.minSpendPence && `spend ${money(p.minSpendPence)}+`,
    p.onePerCustomer && 'once per customer',
    p.maxUses ? `${p.uses} of ${p.maxUses} used` : `${p.uses} used`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Admin › Promo codes: discount codes customers enter when booking online. */
export function PromoCodesPage() {
  const qc = useQueryClient();
  const codes = usePromoCodes();
  const rooms = useRooms();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
  const roomList = rooms.data ?? [];

  return (
    <>
      <PageHeader title="Promo codes" meta="Codes customers can enter when booking online, for a percentage or an amount off." />
      <Async query={codes}>
        {(list) => (
          <>
            <section className="panel" aria-labelledby="codes-h">
              <div className="panel__header"><h2 id="codes-h">Codes</h2></div>
              {list.length === 0 ? (
                <EmptyState title="No promo codes yet. Add one below." />
              ) : (
                <ul className="list">
                  {list.map((p) => (
                    <li key={p.id}>
                      <div className="spread">
                        <div>
                          <strong className="mono">{p.code}</strong> <span className="muted">· {offLabel(p)}</span>
                          {p.description && <div className="small">{p.description}</div>}
                          <div className="small muted">{limits(p, roomList)}</div>
                        </div>
                        <span className="row">
                          {!p.active && <Badge>Paused</Badge>}
                          <button type="button" className="btn btn--small" onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id}>
                            {editing === p.id ? 'Close' : 'Edit'}
                          </button>
                        </span>
                      </div>
                      {editing === p.id && (
                        <div style={{ marginTop: 12 }}>
                          <PromoForm promo={p} rooms={roomList} onSaved={() => { void refresh(); }} onDeleted={() => { setEditing(null); void refresh(); }} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel" aria-labelledby="new-code-h">
              <div className="panel__header"><h2 id="new-code-h">Add a promo code</h2></div>
              <div className="panel__body">
                <PromoForm rooms={roomList} onSaved={() => { void refresh(); }} />
              </div>
            </section>
          </>
        )}
      </Async>
    </>
  );
}

function PromoForm({ promo, rooms, onSaved, onDeleted }: { promo?: PromoCodeDto; rooms: RoomDto[]; onSaved: () => void; onDeleted?: () => void }) {
  const blank = {
    code: '', description: '', kind: 'PERCENT' as 'PERCENT' | 'FIXED', value: '', active: true, validFrom: '', validUntil: '',
    maxUses: '', onePerCustomer: false, roomIds: [] as string[], minSpend: '', minHours: '',
  };
  const [v, setV] = useState(() =>
    promo
      ? {
          code: promo.code, description: promo.description ?? '', kind: promo.kind,
          value: promo.kind === 'PERCENT' ? String(promo.value) : penceToPounds(promo.value),
          active: promo.active, validFrom: promo.validFrom ?? '', validUntil: promo.validUntil ?? '',
          maxUses: promo.maxUses ? String(promo.maxUses) : '', onePerCustomer: promo.onePerCustomer, roomIds: promo.roomIds,
          minSpend: promo.minSpendPence ? penceToPounds(promo.minSpendPence) : '', minHours: promo.minDurationMinutes ? String(promo.minDurationMinutes / 60) : '',
        }
      : blank,
  );
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = {
      code: v.code,
      description: v.description || null,
      kind: v.kind,
      value: v.kind === 'PERCENT' ? Math.round(Number(v.value)) : poundsToPence(v.value || '0'),
      active: v.active,
      validFrom: v.validFrom || null,
      validUntil: v.validUntil || null,
      maxUses: v.maxUses ? Math.round(Number(v.maxUses)) : null,
      onePerCustomer: v.onePerCustomer,
      roomIds: v.roomIds,
      minSpendPence: v.minSpend ? poundsToPence(v.minSpend) : null,
      minDurationMinutes: v.minHours ? Math.round(Number(v.minHours) * 60) : null,
    };
    try {
      if (promo) await api.put(`/api/admin/promo-codes/${promo.id}`, body);
      else await api.post('/api/admin/promo-codes', body);
      onSaved();
      if (!promo) setV(blank);
      setMsg({ tone: 'ok', text: promo ? 'Saved.' : `Added ${body.code.toUpperCase()}.` });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!promo) return;
    if (!window.confirm(`Delete ${promo.code}? Bookings that used it keep their discount. To stop new bookings using it but keep it, pause it instead.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/promo-codes/${promo.id}`);
      onDeleted?.();
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="field-row">
        <TextField label="Code" name="code" value={v.code} onChange={set('code')} hint="What customers type, e.g. SUMMER10. Not case-sensitive." autoComplete="off" />
        <TextField label="Description" optional name="description" value={v.description} onChange={set('description')} hint="Shown to the customer when it's applied." />
      </div>
      <div className="field-row">
        <SelectField label="Discount" name="kind" value={v.kind} onChange={set('kind')} options={[{ value: 'PERCENT', label: 'Percentage off' }, { value: 'FIXED', label: 'Amount off (£)' }]} />
        <TextField label={v.kind === 'PERCENT' ? 'Percent off' : 'Amount off (£)'} name="value" inputMode="decimal" value={v.value} onChange={set('value')} hint={v.kind === 'PERCENT' ? '100 makes the booking free.' : 'Taken off the whole booking; never below £0.'} />
      </div>
      <div className="field-row">
        <TextField label="Starts" optional name="validFrom" type="date" value={v.validFrom} onChange={set('validFrom')} />
        <TextField label="Ends" optional name="validUntil" type="date" value={v.validUntil} onChange={set('validUntil')} hint="Last day it can be used." />
      </div>
      <div className="field-row">
        <TextField label="Total uses" optional name="maxUses" inputMode="numeric" value={v.maxUses} onChange={set('maxUses')} hint="Blank = unlimited." />
        <label className="checkbox" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={v.onePerCustomer} onChange={(e) => setV((x) => ({ ...x, onePerCustomer: e.target.checked }))} />
          <span>Once per customer (by email address)</span>
        </label>
      </div>
      <div className="field-row">
        <TextField label="Minimum spend (£)" optional name="minSpend" inputMode="decimal" value={v.minSpend} onChange={set('minSpend')} />
        <TextField label="Minimum booking (hours)" optional name="minHours" inputMode="decimal" value={v.minHours} onChange={set('minHours')} />
      </div>
      {rooms.length > 1 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
          <legend>Rooms <span className="muted small">(none ticked = every room)</span></legend>
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            {rooms.map((r) => (
              <label key={r.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={v.roomIds.includes(r.id)}
                  onChange={(e) => setV((x) => ({ ...x, roomIds: e.target.checked ? [...x.roomIds, r.id] : x.roomIds.filter((id) => id !== r.id) }))}
                />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="checkbox" style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} />
        <span>Active (untick to pause it)</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy}>{promo ? 'Save code' : 'Add code'}</button>
        {promo && <button type="button" className="btn btn--ghost" onClick={remove} disabled={busy}>Delete</button>}
      </div>
    </form>
  );
}
