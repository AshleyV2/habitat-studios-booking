import { BOOKING_STATUS_LABELS, type BookingStatus, type HealthCheck } from '@habitat/shared';
import type { ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export function Badge({ tone = 'neutral', children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={['badge', tone !== 'neutral' && `badge--${tone}`, plain && 'badge--plain'].filter(Boolean).join(' ')}>{children}</span>;
}

const STATUS_TONE: Record<BookingStatus, Tone> = {
  PENDING_PAYMENT: 'warn',
  CONFIRMED: 'info',
  COMPLETED: 'ok',
  NO_SHOW: 'bad',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export const StatusBadge = ({ status }: { status: BookingStatus }) => <Badge tone={STATUS_TONE[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>;

export function PaidBadge({ total, paid }: { total: number; paid: number }) {
  if (total === 0) return <Badge plain>No charge</Badge>;
  if (paid >= total) return <Badge tone="ok" plain>Paid</Badge>;
  if (paid > 0) return <Badge tone="warn" plain>Part paid</Badge>;
  return <Badge tone="bad" plain>Unpaid</Badge>;
}

export function HealthBadge({ status }: { status: HealthCheck['status'] }) {
  const map: Record<HealthCheck['status'], [string, Tone]> = { ok: ['OK', 'ok'], warning: ['Attention', 'warn'], error: ['Problem', 'bad'], not_configured: ['Not configured', 'neutral'] };
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
