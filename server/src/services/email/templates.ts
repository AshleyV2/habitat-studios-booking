import type { PriceLine } from '@habitat/shared';
import type { Booking, Room, Settings } from '@prisma/client';
import { publicLink } from '../../config/env';
import { manageToken } from '../../utils/manage-token';
import { formatMoney } from '../../utils/money';
import { formatLongDate, localTimeLabel } from '../../utils/time';
import { bookingIcs } from './ics';
import type { QueuedEmail } from './outbox';

// Plain-text emails: reliable across every mail client and easy to audit.

type B = Booking & { room: Room };

const when = (b: B, s: Settings) =>
  `${formatLongDate(b.startsAt, s.timezone)}, ${localTimeLabel(b.startsAt, s.timezone)}–${localTimeLabel(b.endsAt, s.timezone)}`;

export const manageLink = (b: Booking) => publicLink(`/booking/${b.reference}?token=${manageToken(b.id, b.manageSalt)}`);

function linesText(b: Booking) {
  const snap = b.pricingSnapshot as { lines?: PriceLine[] } | null;
  const lines = snap?.lines ?? [];
  const width = 44;
  const rows = lines.map((l) => {
    const amount = formatMoney(l.amountPence, b.currency);
    return `  ${l.description.padEnd(width).slice(0, width)} ${amount}`;
  });
  rows.push(`  ${'Total'.padEnd(width)} ${formatMoney(b.totalPence, b.currency)}`);
  return rows.join('\n');
}

function footer(s: Settings) {
  return ['', '—', s.businessName, s.address, s.contactPhone, s.contactEmail, s.websiteUrl].filter(Boolean).join('\n');
}

function details(b: B, s: Settings) {
  return [
    `Booking reference: ${b.reference}`,
    `Room: ${b.room.name}`,
    `When: ${when(b, s)}`,
    b.bandName ? `Band/artist: ${b.bandName}` : null,
    '',
    linesText(b),
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function confirmationEmail(b: B, s: Settings, paidPence: number): QueuedEmail {
  const balance = b.totalPence - paidPence;
  return {
    kind: 'booking_confirmation',
    bookingId: b.id,
    to: b.customerEmail,
    subject: `Booking confirmed: ${b.room.name}, ${formatLongDate(b.startsAt, s.timezone)} (${b.reference})`,
    text: [
      `Hi ${b.customerName},`,
      '',
      `Your booking at ${s.businessName} is confirmed.`,
      '',
      details(b, s),
      '',
      paidPence > 0 ? `Paid: ${formatMoney(paidPence, b.currency)}` : null,
      balance > 0 ? `Balance due on the day: ${formatMoney(balance, b.currency)}` : null,
      s.confirmationMessage ? `\n${s.confirmationMessage}` : null,
      '',
      `View or manage your booking: ${manageLink(b)}`,
      s.cancellationPolicy ? `\nCancellation policy:\n${s.cancellationPolicy}` : null,
      footer(s),
    ]
      .filter((l) => l !== null)
      .join('\n'),
    ics: bookingIcs({
      uid: `${b.id}@habitat-booking`,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      summary: `${s.businessName} — ${b.room.name}`,
      location: s.address,
      description: `Booking ${b.reference}. Manage: ${manageLink(b)}`,
    }),
  };
}

export function cancellationEmail(b: B, s: Settings, refundPence: number): QueuedEmail {
  return {
    kind: 'booking_cancellation',
    bookingId: b.id,
    to: b.customerEmail,
    subject: `Booking cancelled: ${b.reference}`,
    text: [
      `Hi ${b.customerName},`,
      '',
      `Your booking ${b.reference} (${b.room.name}, ${when(b, s)}) has been cancelled.`,
      b.cancellationReason ? `Reason: ${b.cancellationReason}` : null,
      '',
      refundPence > 0
        ? `A refund of ${formatMoney(refundPence, b.currency)} has been issued to your original payment method. It usually appears within 5–10 working days.`
        : null,
      `If you have any questions, reply to this email or contact us.`,
      footer(s),
    ]
      .filter((l) => l !== null)
      .join('\n'),
  };
}

export function latePaymentRefundedEmail(b: B, s: Settings, refundPence: number): QueuedEmail {
  return {
    kind: 'late_payment_refunded',
    bookingId: b.id,
    to: b.customerEmail,
    subject: `We couldn't hold your booking — refund issued (${b.reference})`,
    text: [
      `Hi ${b.customerName},`,
      '',
      `Your payment for ${b.room.name} on ${when(b, s)} arrived after the reservation window had closed, and that time has since been booked by someone else.`,
      `We have refunded ${formatMoney(refundPence, b.currency)} in full. Please book another time on our website or contact us and we'll help.`,
      footer(s),
    ].join('\n'),
  };
}

export function paymentLinkEmail(b: B, s: Settings, url: string, amountPence: number): QueuedEmail {
  return {
    kind: 'payment_link',
    bookingId: b.id,
    to: b.customerEmail,
    subject: `Payment for your booking ${b.reference}`,
    text: [
      `Hi ${b.customerName},`,
      '',
      `Please use the secure link below to pay ${formatMoney(amountPence, b.currency)} for your booking.`,
      '',
      details(b, s),
      '',
      `Pay securely with Stripe: ${url}`,
      'This link expires in 24 hours.',
      footer(s),
    ].join('\n'),
  };
}

export function bookingChangedEmail(b: B, s: Settings): QueuedEmail {
  return {
    kind: 'booking_changed',
    bookingId: b.id,
    to: b.customerEmail,
    subject: `Booking updated: ${b.reference}`,
    text: [`Hi ${b.customerName},`, '', 'Your booking has been updated. The details are now:', '', details(b, s), '', `Manage your booking: ${manageLink(b)}`, footer(s)].join('\n'),
    ics: bookingIcs({
      uid: `${b.id}@habitat-booking`,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      summary: `${s.businessName} — ${b.room.name}`,
      location: s.address,
      description: `Booking ${b.reference}.`,
    }),
  };
}

export function adminNewBookingEmail(b: B, s: Settings, to: string): QueuedEmail {
  return {
    kind: 'admin_new_booking',
    bookingId: b.id,
    to,
    subject: `New booking ${b.reference}: ${b.room.name}, ${formatLongDate(b.startsAt, s.timezone)}`,
    text: [
      `New ${b.source === 'ONLINE' ? 'online' : 'staff'} booking.`,
      '',
      details(b, s),
      '',
      `Customer: ${b.customerName} <${b.customerEmail}>${b.customerPhone ? `, ${b.customerPhone}` : ''}`,
      b.customerNotes ? `Notes: ${b.customerNotes}` : null,
      '',
      publicLink(`/admin/bookings/${b.id}`),
    ]
      .filter((l) => l !== null)
      .join('\n'),
  };
}

export function adminCancellationEmail(b: B, s: Settings, to: string, by: string): QueuedEmail {
  return {
    kind: 'admin_cancellation',
    bookingId: b.id,
    to,
    subject: `Booking cancelled ${b.reference} (${by})`,
    text: [`Booking ${b.reference} was cancelled by ${by}.`, '', details(b, s), '', `Reason: ${b.cancellationReason ?? '—'}`, publicLink(`/admin/bookings/${b.id}`)].join('\n'),
  };
}

export function staffInviteEmail(to: string, name: string, token: string, businessName: string): QueuedEmail {
  return {
    kind: 'staff_invite',
    to,
    subject: `Your ${businessName} booking admin account`,
    text: `Hi ${name},\n\nAn admin account has been created for you on the ${businessName} booking system. Choose a password to activate it:\n\n${publicLink(`/admin/reset-password?token=${encodeURIComponent(token)}&invite=1`)}\n\nThis link expires in 7 days.`,
  };
}

export function passwordResetEmail(to: string, name: string, token: string): QueuedEmail {
  return {
    kind: 'password_reset',
    to,
    subject: 'Reset your booking admin password',
    text: `Hi ${name},\n\nUse this link to choose a new password:\n\n${publicLink(`/admin/reset-password?token=${encodeURIComponent(token)}`)}\n\nThe link expires in 1 hour and can be used once. If you didn't ask for this, ignore this email.`,
  };
}

export function testEmail(to: string, s: Settings): QueuedEmail {
  return {
    kind: 'test',
    to,
    subject: `${s.businessName} booking system — test email`,
    text: `This is a test email from the ${s.businessName} booking system.\n\nIf you received it, outgoing email (SMTP) is working.\n\nSent ${new Date().toISOString()}`,
  };
}
