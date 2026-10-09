import {
  customerDetailsSchema,
  planDurations,
  planPrice,
  type AvailabilityResponse,
  type CreatedOnlineBooking,
  type EquipmentAvailability,
  type PublicRoom,
  type Quote,
} from '@habitat/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, qs } from '../../api/client';
import { TextAreaField, TextField } from '../../components/Field';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useForm } from '../../hooks/useForm';
import { addDays, dateLong, dayOfWeek, duration, endTimeLabel, money, planSummary, roomFromPrice } from '../../lib/format';
import { usePublicConfig } from './PublicLayout';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Step({ n, title, locked, children, hint }: { n: number; title: string; locked?: boolean; hint?: string; children?: ReactNode }) {
  return (
    <section className={`step${locked ? ' step--locked' : ''}`} aria-labelledby={`step-${n}`}>
      <div className="step__head">
        <span className="step__num">STEP {n}</span>
        <h2 className="step__title" id={`step-${n}`}>{title}</h2>
      </div>
      {hint && !locked && <p className="step__hint">{hint}</p>}
      {!locked && children}
    </section>
  );
}

export function BookingPage() {
  useDocumentTitle(`Book a room · ${usePublicConfig().data?.businessName ?? 'Online booking'}`);
  const { data: cfg } = usePublicConfig();
  const queryClient = useQueryClient();
  const [roomId, setRoomId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('room'));
  const [planChoice, setPlanChoice] = useState<string | null>(() => new URLSearchParams(window.location.search).get('session'));
  const [date, setDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [durationMinutes, setDuration] = useState<number | null>(null);
  const [kit, setKit] = useState<Record<string, number>>({});
  const [accepted, setAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Promo code: what's typed, and the code currently applied to the quote.
  const [codeInput, setCodeInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const details = useForm({ name: '', email: '', phone: '', bandName: '', notes: '' });

  const rooms = useQuery({ queryKey: ['public-rooms'], queryFn: () => api.get<PublicRoom[]>('/api/public/rooms') });
  const selectedRoom = rooms.data?.find((r) => r.id === roomId);
  // Session type (e.g. band rehearsal / solo); rooms without them are priced per hour.
  const plan = selectedRoom?.ratePlans.find((p) => p.id === planChoice) ?? selectedRoom?.ratePlans[0] ?? null;
  const ratePlanId = plan?.id ?? null;
  const availability = useQuery({
    queryKey: ['availability', roomId, date, ratePlanId],
    queryFn: () => api.get<AvailabilityResponse>(`/api/public/availability${qs({ roomId, date, ratePlanId })}`),
    enabled: Boolean(roomId && date),
    refetchInterval: 60_000,
  });
  const equipment = useQuery({
    queryKey: ['equipment', date, startTime, durationMinutes],
    queryFn: () => api.get<EquipmentAvailability[]>(`/api/public/equipment${qs({ date, startTime, durationMinutes })}`),
    enabled: Boolean(date && startTime && durationMinutes),
    placeholderData: keepPreviousData,
  });
  const selection = useMemo(() => Object.entries(kit).filter(([, q]) => q > 0).map(([equipmentId, quantity]) => ({ equipmentId, quantity })), [kit]);
  const quote = useQuery({
    queryKey: ['quote', roomId, ratePlanId, date, startTime, durationMinutes, selection, promoCode],
    queryFn: () => api.post<Quote>('/api/public/quote', { roomId, ratePlanId, date, startTime, durationMinutes, equipment: selection, promoCode }),
    enabled: Boolean(roomId && date && startTime && durationMinutes),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Keep the selection consistent with live availability.
  const start = availability.data?.starts.find((s) => s.time === startTime);
  useEffect(() => {
    if (availability.data && startTime && !start) {
      setStartTime(null);
      setDuration(null);
    }
  }, [availability.data, startTime, start]);
  useEffect(() => {
    if (!equipment.data) return;
    setKit((k) => {
      const next = { ...k };
      for (const e of equipment.data) if ((next[e.id] ?? 0) > e.available) next[e.id] = e.available;
      return next;
    });
  }, [equipment.data]);

  if (!cfg) return <p className="pub-muted">Loading…</p>;
  const today = cfg.today;
  const lastDate = addDays(today, cfg.maxAdvanceDays);
  const stripDays = Array.from({ length: Math.min(14, cfg.maxAdvanceDays + 1) }, (_, i) => addDays(today, i));
  const isClosed = (d: string) => !cfg.openingHours.find((h) => h.dayOfWeek === dayOfWeek(d))?.isOpen;

  const lengths = plan ? planDurations(plan, cfg) : null;
  const durations: number[] = [];
  if (start && lengths) durations.push(...lengths.filter((m) => m <= start.maxDurationMinutes));
  else if (start) for (let m = selectedRoom?.minDurationMinutes ?? cfg.minDurationMinutes; m <= start.maxDurationMinutes; m += cfg.slotMinutes) durations.push(m);
  const resetTime = () => {
    setStartTime(null);
    setDuration(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const customer = details.validate(customerDetailsSchema, details.values);
    if (!customer) return;
    if (!accepted) {
      setSubmitError('Please accept the booking terms to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<CreatedOnlineBooking>('/api/public/bookings', {
        roomId, ratePlanId, date, startTime, durationMinutes, equipment: selection,
        customer, notes: details.values.notes || null, acceptTerms: true,
        // Only a code the quote accepted (a rejected one would stop the booking).
        promoCode: quote.data?.promo?.code ?? null,
      });
      try {
        sessionStorage.setItem(`habitat-manage-${res.reference}`, res.manageToken);
      } catch {
        /* private browsing: the confirmation email carries the link */
      }
      // Nothing to pay (e.g. a 100% code): it's already confirmed.
      window.location.assign(res.checkoutUrl ?? `/booking/${encodeURIComponent(res.reference)}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        details.setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^customer\./, ''), v])));
        setSubmitError(err.message);
        if (err.status === 409) {
          void queryClient.invalidateQueries({ queryKey: ['availability'] });
          void queryClient.invalidateQueries({ queryKey: ['equipment'] });
        }
      } else setSubmitError('Something went wrong. Please try again.');
    }
  }

  const ready = Boolean(quote.data && !quote.isError && startTime && durationMinutes);

  return (
    <>
      <h1 className="site-title">Book a rehearsal room</h1>
      <p className="site-lede">Pick a room and a time, add any gear you need, and pay securely online. You'll get a confirmation email straight away.</p>
      {!cfg.onlineBooking.available && <div className="pub-notice pub-notice--warn" role="status">{cfg.onlineBooking.reason}</div>}

      <div className="booking">
        <div>
          <Step n={1} title="Choose a room">
            {rooms.isPending ? (
              <p className="pub-muted">Loading rooms…</p>
            ) : rooms.isError ? (
              <div className="pub-notice pub-notice--error">Rooms could not be loaded. Please refresh the page.</div>
            ) : rooms.data.length === 0 ? (
              <div className="pub-notice">No rooms are available to book online at the moment.</div>
            ) : (
              <ul className="room-list" role="radiogroup" aria-labelledby="step-1">
                {rooms.data.map((r) => {
                  const selected = r.id === roomId;
                  const from = roomFromPrice(r, cfg);
                  return (
                    <li key={r.id}>
                      <label className="room-option" data-selected={selected}>
                        <input
                          type="radio"
                          name="room"
                          value={r.id}
                          checked={selected}
                          onChange={() => {
                            setRoomId(r.id);
                            setPlanChoice(null);
                            resetTime();
                          }}
                        />
                        <span>
                          <span className="room-option__name">{r.name}</span>
                          {r.capacity && <span className="room-option__meta"> · up to {r.capacity} people</span>}
                          {/* Full details only for the chosen room, to keep the list short. */}
                          {selected && r.description && <span className="room-option__meta room-option__details">{r.description}</span>}
                          {selected && r.ratePlans.length === 0 && r.priceRules.length > 0 && (
                            <span className="room-option__meta room-option__details">
                              {r.priceRules.map((p) => `${p.label}: ${money(p.hourlyRatePence, cfg.currency)}/h`).join(' · ')}
                            </span>
                          )}
                          {r.ratePlans.length === 0 && (r.lengthDiscounts.length > 0 || r.minDurationMinutes > cfg.minDurationMinutes) && (
                            <span className="room-option__meta room-option__details room-option__deal">
                              {[
                                r.minDurationMinutes > cfg.minDurationMinutes ? `Minimum ${duration(r.minDurationMinutes)}` : null,
                                ...[...r.lengthDiscounts].sort((a, b) => a.fromMinutes - b.fromMinutes).map((d) => `${duration(d.fromMinutes)} or more: save ${d.percentOff}%`),
                              ].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="room-option__price">
                          {r.ratePlans.length || r.fromRatePence < r.hourlyRatePence ? 'from ' : ''}
                          {money(from.pence, cfg.currency)}
                          <small>{from.unit}</small>
                        </span>
                      </label>
                      {selected && r.ratePlans.length > 0 && (
                        <fieldset className="plan-picker">
                          <legend>{r.ratePlans.length > 1 ? 'Type of session' : 'Prices'}</legend>
                          <ul className="plan-list">
                            {r.ratePlans.map((p) => (
                              <li key={p.id}>
                                <label className="room-option" data-selected={p.id === plan?.id}>
                                  <input
                                    type="radio"
                                    name="session"
                                    value={p.id}
                                    checked={p.id === plan?.id}
                                    onChange={() => {
                                      setPlanChoice(p.id);
                                      resetTime();
                                    }}
                                  />
                                  <span>
                                    <span className="room-option__name">{p.name}</span>
                                    {p.description && <span className="room-option__meta room-option__details">{p.description}</span>}
                                    <span className="room-option__meta room-option__details">{planSummary(p, cfg.currency)}</span>
                                    {(p.earliestStartTime || p.latestEndTime) && (
                                      <span className="room-option__meta room-option__details">
                                        Bookable {[p.earliestStartTime && `from ${p.earliestStartTime}`, p.latestEndTime && `until ${p.latestEndTime}`].filter(Boolean).join(' ')}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </fieldset>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Step>

          <Step n={2} title="Pick a date" locked={!roomId}>
            <div className="date-strip" role="group" aria-label="Next two weeks">
              {stripDays.map((d) => {
                const closed = isClosed(d);
                const [, , dd] = d.split('-');
                return (
                  <button
                    key={d}
                    type="button"
                    className="date-chip"
                    aria-pressed={d === date}
                    disabled={closed}
                    aria-label={`${dateLong(d, cfg.timezone)}${closed ? ' (closed)' : ''}`}
                    onClick={() => {
                      setDate(d);
                      setStartTime(null);
                      setDuration(null);
                    }}
                  >
                    <small>{d === today ? 'Today' : WEEKDAY[dayOfWeek(d)]}</small>
                    <strong>{Number(dd)}</strong>
                  </button>
                );
              })}
            </div>
            <div className="date-other">
              <label htmlFor="other-date">Another date:</label>
              <input
                id="other-date"
                type="date"
                min={today}
                max={lastDate}
                value={date ?? ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setDate(e.target.value);
                  setStartTime(null);
                  setDuration(null);
                }}
              />
            </div>
          </Step>

          <Step n={3} title="Choose your start and end time" locked={!roomId || !date} hint={date ? dateLong(date, cfg.timezone) : undefined}>
            {availability.isPending ? (
              <p className="pub-muted"><span className="spinner" /> Checking availability…</p>
            ) : availability.isError ? (
              <div className="pub-notice pub-notice--error">{(availability.error as Error).message}</div>
            ) : availability.data.slots.length === 0 ? (
              <div className="pub-notice">{availability.data.reason === 'Closed' ? "We're closed that day." : `${availability.data.reason ?? 'No times available'} — please try another date or room.`}</div>
            ) : (
              <>
                {availability.data.starts.length === 0 && (
                  <div className="pub-notice">No free start times left on this day — please try another date or room.</div>
                )}
                <div className="time-grid" role="group" aria-label="Start times">
                  {availability.data.slots.map((s) => {
                    const free = s.state === 'available';
                    const label = s.state === 'booked' ? 'Booked' : s.state === 'closed' ? 'Closed' : null;
                    return (
                      <button
                        key={s.time}
                        type="button"
                        className={`time-btn time-btn--${s.state}`}
                        aria-pressed={free ? s.time === startTime : undefined}
                        disabled={!free}
                        aria-label={free ? `Start at ${s.time}` : `${s.time} — ${label ?? 'not available'}`}
                        title={free ? undefined : label ?? 'Not available (too soon or too short a gap)'}
                        onClick={() => {
                          if (!free) return;
                          // New start: the customer then picks when they finish.
                          if (s.time !== startTime) setDuration(null);
                          setStartTime(s.time);
                        }}
                      >
                        <span className="time-btn__time">{s.time}</span>
                        {label && <span className="time-btn__state">{label}</span>}
                      </button>
                    );
                  })}
                </div>
                <ul className="time-legend" aria-label="Key">
                  <li><span className="time-legend__swatch time-legend__swatch--available" /> Available</li>
                  <li><span className="time-legend__swatch time-legend__swatch--booked" /> Booked</li>
                  <li><span className="time-legend__swatch time-legend__swatch--closed" /> Closed</li>
                  <li><span className="time-legend__swatch time-legend__swatch--unavailable" /> Too soon / gap too short</li>
                </ul>
                {start && startTime && (
                  <div className="end-times">
                    <h3 className="end-times__title" id="end-times-title">Pick an end time <span className="pub-muted">— starting {startTime}</span></h3>
                    <div className="time-grid time-grid--end" role="group" aria-labelledby="end-times-title">
                      {durations.map((m) => {
                        const end = endTimeLabel(startTime, m);
                        return (
                          <button
                            key={m}
                            type="button"
                            className="time-btn time-btn--available time-btn--end"
                            aria-pressed={m === durationMinutes}
                            aria-label={`Finish at ${end} (${duration(m)}${plan ? `, ${money(planPrice(plan, m), cfg.currency)}` : ''})`}
                            onClick={() => setDuration(m)}
                          >
                            <span className="time-btn__time">{end}</span>
                            <span className="time-btn__state">{plan ? money(planPrice(plan, m), cfg.currency) : duration(m)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {durationMinutes && quote.data && (
                      <p className="end-times__result">
                        {startTime}–{quote.data.endTime} · {duration(durationMinutes)} · <strong>{money(quote.data.roomSubtotalPence, cfg.currency)}</strong>
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </Step>

          <Step n={4} title="Add equipment (optional)" locked={!startTime || !durationMinutes} hint="Numbers show what's free for your whole session.">
            {equipment.data && equipment.data.length === 0 && <p className="pub-muted">No hire equipment is listed.</p>}
            {equipment.data && equipment.data.length > 0 && (
              <div className="kit">
                {equipment.data.map((e) => {
                  const q = kit[e.id] ?? 0;
                  return (
                    <div className="kit__row" key={e.id}>
                      <div>
                        <div className="kit__name">{e.name}</div>
                        <div className="kit__meta">
                          {e.description ? `${e.description} · ` : ''}
                          {e.available === 0 ? 'None free at this time' : `${e.available} available`}
                        </div>
                      </div>
                      <div className="kit__price">{money(e.pricePence, cfg.currency)} {e.pricing === 'PER_HOUR' ? 'per hour' : 'per session'}</div>
                      <div className="stepper" role="group" aria-label={`Quantity of ${e.name}`}>
                        <button type="button" aria-label={`Remove one ${e.name}`} disabled={q === 0} onClick={() => setKit((k) => ({ ...k, [e.id]: q - 1 }))}>−</button>
                        <output aria-live="polite">{q}</output>
                        <button type="button" aria-label={`Add one ${e.name}`} disabled={q >= e.available} onClick={() => setKit((k) => ({ ...k, [e.id]: q + 1 }))}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Step>

          <Step n={5} title="Your details" locked={!ready}>
            <form id="booking-form" onSubmit={onSubmit} noValidate>
              <div className="field-row">
                <TextField label="Your name" autoComplete="name" {...details.field('name')} />
                <TextField label="Band / artist" optional autoComplete="organization" {...details.field('bandName')} />
              </div>
              <div className="field-row">
                <TextField label="Email" type="email" autoComplete="email" hint="Your confirmation goes here." {...details.field('email')} />
                <TextField label="Mobile number" type="tel" autoComplete="tel" hint="In case we need to reach you on the day." {...details.field('phone')} />
              </div>
              <TextAreaField label="Anything we should know?" optional rows={3} maxLength={1000} {...details.field('notes')} />
              {(cfg.bookingTerms || cfg.cancellationPolicy) && (
                <div className="terms" tabIndex={0} aria-label="Booking terms">
                  {[cfg.cancellationPolicy && `Cancellation policy\n${cfg.cancellationPolicy}`, cfg.bookingTerms && `Terms\n${cfg.bookingTerms}`].filter(Boolean).join('\n\n')}
                </div>
              )}
              <label className="checkbox-line">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>I agree to the booking terms and cancellation policy.</span>
              </label>
            </form>
          </Step>
        </div>

        <aside className="summary" aria-label="Your booking">
          <h2>Your booking</h2>
          <dl>
            <dt>Room</dt>
            <dd>{selectedRoom ? `${selectedRoom.name}${plan && selectedRoom.ratePlans.length > 1 ? ` · ${plan.name}` : ''}` : '—'}</dd>
            <dt>Date</dt>
            <dd>{date ? dateLong(date, cfg.timezone) : '—'}</dd>
            <dt>Time</dt>
            <dd>{startTime && quote.data ? `${startTime}–${quote.data.endTime}` : '—'}</dd>
          </dl>
          {quote.isError && <div className="pub-notice pub-notice--error" role="alert">{(quote.error as Error).message}</div>}
          {quote.data && !quote.isError && (
            <>
              <ul className="summary-lines">
                {quote.data.lines.map((l, i) => (
                  <li key={i} className={l.kind === 'discount' ? 'summary-lines__discount' : undefined}>
                    <span>{l.description}</span>
                    <span>{l.amountPence < 0 ? `−${money(-l.amountPence, cfg.currency)}` : money(l.amountPence, cfg.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="summary-total"><span>Total</span><span>{money(quote.data.totalPence, cfg.currency)}</span></div>
            </>
          )}
          {ready && (
            <div className="promo">
              {quote.data?.promo ? (
                <p className="promo__applied">
                  <span>Code <strong>{quote.data.promo.code}</strong> applied{quote.data.promo.description ? ` · ${quote.data.promo.description}` : ''}</span>
                  <button type="button" className="promo__remove" onClick={() => { setPromoCode(null); setCodeInput(''); }}>Remove</button>
                </p>
              ) : (
                <form
                  className="promo__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPromoCode(codeInput.trim().toUpperCase() || null);
                  }}
                >
                  <label htmlFor="promo-code">Promo code</label>
                  <div className="promo__row">
                    <input id="promo-code" className="pub-input" autoComplete="off" spellCheck={false} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
                    <button type="submit" className="pub-btn pub-btn--quiet" disabled={!codeInput.trim() || quote.isFetching}>Apply</button>
                  </div>
                  {quote.data?.promoError && promoCode && <p className="promo__error" role="alert">{quote.data.promoError}</p>}
                </form>
              )}
            </div>
          )}
          {submitError && <div className="pub-notice pub-notice--error" role="alert">{submitError}</div>}
          <button type="submit" form="booking-form" className="pub-btn pub-btn--block" disabled={!ready || submitting || !cfg.onlineBooking.available}>
            {submitting
              ? quote.data?.totalPence === 0 ? 'Confirming…' : 'Taking you to payment…'
              : quote.data && ready
                ? quote.data.totalPence === 0 ? 'Confirm booking' : `Pay ${money(quote.data.totalPence, cfg.currency)} securely`
                : 'Choose a time to continue'}
          </button>
          <p className="muted" style={{ marginTop: 10 }}>
            Card payment is handled by Stripe; we never see your card details. Your time is held for a short while as you pay.
          </p>
        </aside>
      </div>
    </>
  );
}
