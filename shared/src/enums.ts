// Mirrors prisma/schema.prisma enums.

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  EXPIRED: 'Expired (unpaid)',
};

/** Statuses that occupy a room and its equipment. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'];

export const STAFF_ROLES = ['ADMIN', 'STAFF'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const EQUIPMENT_PRICING = ['PER_BOOKING', 'PER_HOUR'] as const;
export type EquipmentPricing = (typeof EQUIPMENT_PRICING)[number];
export const EQUIPMENT_PRICING_LABELS: Record<EquipmentPricing, string> = {
  PER_BOOKING: 'per booking',
  PER_HOUR: 'per hour',
};

export const PAYMENT_METHODS = ['STRIPE', 'CASH', 'CARD_TERMINAL', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  STRIPE: 'Stripe (online)',
  CASH: 'Cash',
  CARD_TERMINAL: 'Card terminal',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};
/** Methods staff can record by hand. Stripe payments are only created by Stripe. */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'CARD_TERMINAL', 'BANK_TRANSFER', 'OTHER'] as const;

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
