import type { PublicBookingView } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, ApiError, qs } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { dateLong, dateTime, money } from '../../lib/format';
import { usePublicConfig } from './PublicLayout';

/**
 * Where Stripe sends the customer back, and the page behind the "manage booking" link.
 * It only DISPLAYS status: a booking becomes confirmed when the server receives
 * Stripe's signed webhook, never because the customer arrived here.
 */
export function BookingStatusPage() {
  const { reference = '' } = useParams();
  const [params] = useSearchParams();
  const { data: cfg } = usePublicConfig();
  const queryClient = useQueryClient();
  const sessionId = params.get('session_id');
  const [token] = useState(() => {
    const fromUrl = params.get('token');
    if (fromUrl) return fromUrl;
    try {
      return sessionStorage.getItem(`habitat-manage-${reference}`);
    } catch {
      return null;
    }
  });
  const [waitedMs, setWaitedMs] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  useDocumentTitle(`Booking ${reference}`);

  const query = useQuery({
    queryKey: ['public-booking', reference],
    queryFn: () => api.get<PublicBookingView>(`/api/public/bookings/${encodeURIComponent(reference)}${qs({ token, session_id: token ? undefined : sessionId })}`),
    enabled: Boolean(token || sessionId),
    retry: false,
    // Poll briefly while we wait for Stripe's webhook.
    refetchInterval: (q) => (q.state.data?.status === 'PENDING_PAYMENT' && sessionId && waitedMs < 120_000 ? 2500 : false),
  });
  useEffect(() => {
    if (query.data?.status !== 'PENDING_PAYMENT' || !sessionId) return;
    const t = setInterval(() => setWaitedMs((w) => w + 2500), 2500);
    return () => clearInterval(t);
  }, [query.data?.status, sessionId]);

  if (!token && !sessionId) {
    return (
      <div className="confirm-card confirm-card--bad">
        <h1>Open the link from your email</h1>
        <p>To view or change booking <span className="confirm-ref">{reference}</span>, use the link in your confirmation email.</p>
        <Link to="/book" className="pub-btn pub-btn--quiet">Make a new booking</Link>
      </div>
    );
  }
  if (query.isPending || !cfg) return <p className="pub-muted"><span className="spinner" /> Loading your booking…</p>;
  if (query.isError) {
    return (
      <div className="confirm-card confirm-card--bad">
        <h1>Booking not found</h1>
        <p>{query.error instanceof ApiError ? query.error.message : 'Please use the link from your confirmation email.'}</p>
        <Link to="/book" className="pub-btn pub-btn--quiet">Back to booking</Link>
      </div>
    );
  }

  const b = query.data;
  const tz = cfg.timezone;

  async function cancel() {
    if (!window.confirm(b.status === 'PENDING_PAYMENT' ? 'Cancel this booking before paying?' : 'Cancel this booking? Your payment will be refunded in full.')) return;
    setCancelling(true);
    setCancelError(null);
    try {
      queryClient.setQueryData(['public-booking', reference], await api.post<PublicBookingView>(`/api/public/bookings/${encodeURIComponent(reference)}/cancel`, { token }));
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Could not cancel. Please contact us.');
    } finally {
      setCancelling(false);
    }
  }

  const heading: Record<PublicBookingView['status'], string> = {
    PENDING_PAYMENT: sessionId ? 'Confirming your payment…' : 'Awaiting payment',
    CONFIRMED: "You're booked in",
    COMPLETED: 'Session completed',
    NO_SHOW: 'Session missed',
    CANCELLED: 'Booking cancelled',
    EXPIRED: 'Booking not completed',
  };
  const tone = b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? '' : b.status === 'PENDING_PAYMENT' ? ' confirm-card--pending' : ' confirm-card--bad';

  return (
    <div className={`confirm-card${tone}`}>
      <h1 className="site-title" style={{ fontSize: '2rem' }} aria-live="polite">{heading[b.status]}</h1>
      <p>Reference <span className="confirm-ref">{b.reference}</span></p>

      {b.status === 'PENDING_PAYMENT' && sessionId && (
        <div className="pub-notice pub-notice--warn" role="status">
          {waitedMs < 120_000 ? (
            <><span className="spinner" /> We're waiting for Stripe to confirm your payment. This usually takes a few seconds — you don't need to do anything.</>
          ) : (
            <>Your payment is still being confirmed. You'll receive an email as soon as it is. If you were charged and don't hear from us, contact us quoting your reference.</>
          )}
        </div>
      )}
      {b.status === 'PENDING_PAYMENT' && !sessionId && params.get('cancelled') && (
        <div className="pub-notice">Payment was not completed. Your time is held until {dateTime(b.expiresAt, tz)}; after that it is released.</div>
      )}
      {b.status === 'CONFIRMED' && <div className="pub-notice pub-notice--ok">A confirmation has been sent to {b.customerEmail}.</div>}
      {b.status === 'EXPIRED' && <div className="pub-notice">Payment wasn't completed in time, so the slot was released and you have not been charged.</div>}
      {b.status === 'CANCELLED' && b.cancellationReason && <div className="pub-notice">{b.cancellationReason}</div>}

      <div className="summary" style={{ position: 'static', border: 0, padding: 0, background: 'none' }}>
        <dl>
          <dt>Room</dt><dd>{b.roomName}</dd>
          <dt>Date</dt><dd>{dateLong(b.date, tz)}</dd>
          <dt>Time</dt><dd>{b.startTime}–{b.endTime}</dd>
          <dt>Name</dt><dd>{b.customerName}</dd>
        </dl>
        <ul className="summary-lines">
          {b.lines.map((l, i) => <li key={i}><span>{l.description}</span><span>{money(l.amountPence, b.currency)}</span></li>)}
        </ul>
        <div className="summary-total"><span>Total</span><span>{money(b.totalPence, b.currency)}</span></div>
        {b.paidPence > 0 && <p className="pub-muted">Paid: {money(b.paidPence, b.currency)}</p>}
      </div>

      {cancelError && <div className="pub-notice pub-notice--error" role="alert">{cancelError}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        {b.canCancel && (
          <button type="button" className="pub-btn pub-btn--quiet" onClick={cancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel booking'}
          </button>
        )}
        <Link to="/book" className="pub-btn">Book another session</Link>
      </div>
      {b.status === 'CONFIRMED' && !b.canCancel && b.cancelDeadline && (
        <p className="pub-muted" style={{ marginTop: 12 }}>
          {new Date(b.cancelDeadline) > new Date()
            ? `You can cancel online until ${dateTime(b.cancelDeadline, tz)} using the link in your confirmation email.`
            : `Online cancellation closed at ${dateTime(b.cancelDeadline, tz)}. Please contact us if you need to change this booking.`}
        </p>
      )}
    </div>
  );
}
