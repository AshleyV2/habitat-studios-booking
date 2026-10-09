import type { BookingStatus, EquipmentPricing, PaymentMethod, PaymentStatus, StaffRole } from './enums';
import type { Permission } from './permissions';
import type { RatePlan } from './rate-plans';

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// --- Public -----------------------------------------------------------------

export interface PublicConfig {
  businessName: string;
  timezone: string;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  websiteUrl: string | null;
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  /** Local date today in the business timezone. */
  today: string;
  onlineBooking: { available: boolean; reason: string | null };
  cancellationPolicy: string | null;
  bookingTerms: string | null;
  /** Home page text set by the studio (all optional). */
  homeHeadline: string | null;
  homeIntro: string | null;
  announcement: string | null;
  tagline: string | null;
  aboutText: string | null;
  roomsIntro: string | null;
  communalText: string | null;
  privacyPolicy: string | null;
  featuredQuote: string | null;
  featuredQuoteAuthor: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  openingHours: { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }[];
}

export interface PublicRoom {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  hourlyRatePence: number;
  /** Lowest hourly rate across price rules, for "from £x/hr". */
  fromRatePence: number;
  /** Photo: site-relative path or https URL. */
  imageUrl: string | null;
  /** Session types priced by length. Empty = priced per hour (hourlyRatePence / priceRules). */
  ratePlans: RatePlan[];
  priceRules: { label: string; daysOfWeek: number[]; startTime: string; endTime: string; hourlyRatePence: number }[];
  /** Shortest booking for this room (hourly pricing), in minutes. */
  minDurationMinutes: number;
  lengthDiscounts: LengthDiscount[];
}

/** Hire equipment as listed on the public site (no live availability). */
export interface PublicEquipment {
  id: string;
  name: string;
  description: string | null;
  pricePence: number;
  pricing: EquipmentPricing;
}

export interface AvailabilityStart {
  /** Local HH:mm */
  time: string;
  /** Longest bookable duration starting here, in minutes. */
  maxDurationMinutes: number;
}

export interface AvailabilityResponse {
  date: string;
  roomId: string;
  open: boolean;
  openTime: string | null;
  closeTime: string | null;
  starts: AvailabilityStart[];
  /**
   * Every start time within opening hours and its state: available, booked (taken by
   * another booking), closed (a studio closure) or unavailable (past, too little notice,
   * or too short a gap). No customer details.
   */
  slots: { time: string; state: 'available' | 'booked' | 'closed' | 'unavailable'; maxDurationMinutes: number }[];
  /** Busy periods (no customer details), local HH:mm. */
  busy: { start: string; end: string; kind: 'booking' | 'closure' }[];
  reason: string | null;
}

export interface EquipmentAvailability {
  id: string;
  name: string;
  description: string | null;
  pricePence: number;
  pricing: EquipmentPricing;
  /** Units free for the whole requested period. */
  available: number;
}

export interface PriceLine {
  /** Discounts are negative amounts. */
  kind: 'room' | 'equipment' | 'discount';
  description: string;
  amountPence: number;
  equipmentId?: string;
  quantity?: number;
}

export interface Quote {
  roomId: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  ratePlanId: string | null;
  ratePlanName: string | null;
  currency: string;
  lines: PriceLine[];
  roomSubtotalPence: number;
  equipmentSubtotalPence: number;
  /** Longer-booking discount and promo code together (positive). */
  discountPence: number;
  totalPence: number;
  /** The promo code applied, if any. */
  promo: { code: string; description: string | null } | null;
  /** Why the promo code entered couldn't be used (the price is shown without it). */
  promoError: string | null;
}

export interface CreatedOnlineBooking {
  reference: string;
  manageToken: string;
  /** Null when nothing is left to pay (e.g. a 100% promo code): the booking is already confirmed. */
  checkoutUrl: string | null;
}

export interface PublicBookingView {
  reference: string;
  status: BookingStatus;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerEmail: string;
  lines: PriceLine[];
  totalPence: number;
  paidPence: number;
  currency: string;
  expiresAt: string | null;
  cancellationReason: string | null;
  canCancel: boolean;
  cancelDeadline: string | null;
}

// --- Staff ------------------------------------------------------------------

export interface StaffUserDto {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  disabled: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface MeResponse {
  user: { id: string; email: string; name: string; role: StaffRole };
  permissions: Permission[];
}

export interface PaymentDto {
  id: string;
  bookingId: string;
  bookingReference?: string;
  customerName?: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountPence: number;
  refundedPence: number;
  currency: string;
  note: string | null;
  stripePaymentIntentId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface BookingSummaryDto {
  id: string;
  reference: string;
  status: BookingStatus;
  source: 'ONLINE' | 'ADMIN';
  room: { id: string; name: string; colour: string };
  customer: { id: string; name: string; email: string };
  bandName: string | null;
  startsAt: string;
  endsAt: string;
  totalPence: number;
  paidPence: number;
  currency: string;
  createdAt: string;
}

export interface BookingDetailDto extends BookingSummaryDto {
  ratePlanId: string | null;
  ratePlanName: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  roomSubtotalPence: number;
  equipmentSubtotalPence: number;
  lines: PriceLine[];
  items: { equipmentId: string; name: string; quantity: number; lineTotalPence: number }[];
  payments: PaymentDto[];
  expiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  refundablePence: number;
  emails: { id: string; kind: string; status: string; to: string; createdAt: string; sentAt: string | null; lastError: string | null }[];
  history: { action: string; actor: string | null; createdAt: string }[];
}

export interface RoomDto {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  hourlyRatePence: number;
  colour: string;
  active: boolean;
  sortOrder: number;
  imageUrl: string | null;
  ratePlans: RatePlan[];
  priceRules: { id: string; label: string; daysOfWeek: number[]; startTime: string; endTime: string; hourlyRatePence: number }[];
  /** Null = the site-wide minimum. */
  minDurationMinutes: number | null;
  lengthDiscounts: LengthDiscount[];
}

export interface EquipmentDto {
  id: string;
  name: string;
  description: string | null;
  pricePence: number;
  pricing: EquipmentPricing;
  quantity: number;
  active: boolean;
  sortOrder: number;
}

export interface CustomerDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  bandName: string | null;
  notes: string | null;
  bookingCount: number;
  lastBookingAt: string | null;
  createdAt: string;
}

export interface BlockDto {
  id: string;
  roomId: string | null;
  roomName: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface CalendarResponse {
  from: string;
  to: string;
  timezone: string;
  rooms: { id: string; name: string; colour: string; active: boolean }[];
  bookings: BookingSummaryDto[];
  blocks: BlockDto[];
  openingHours: PublicConfig['openingHours'];
}

export interface DashboardResponse {
  today: string;
  todaysBookings: BookingSummaryDto[];
  upcomingCount: number;
  pendingPayments: number;
  outstandingBalances: { count: number; totalPence: number };
  emailProblems: number;
  setup: { rooms: boolean; openingHours: boolean; stripe: boolean; smtp: boolean; adminEmail: boolean };
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'not_configured';
  detail: string;
}

export interface SystemHealthResponse {
  version: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
}

export interface EmailMessageDto {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  bookingId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface AuditEntryDto {
  id: string;
  action: string;
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export type LengthDiscount = { fromMinutes: number; percentOff: number };

export interface PromoCodeDto {
  id: string;
  code: string;
  description: string | null;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  onePerCustomer: boolean;
  roomIds: string[];
  minSpendPence: number | null;
  minDurationMinutes: number | null;
  /** Bookings that used it (not cancelled or expired). */
  uses: number;
  createdAt: string;
}

export type ConfigSource = 'settings' | 'server' | null;

/** Admin › Settings connections. Secrets are never sent: only whether they're set and where from. */
export interface ConnectionsDto {
  bookingRefPrefix: { value: string | null; effective: string; server: string };
  stripe: {
    enabled: boolean;
    mode: 'live' | 'test' | null;
    secretKey: { set: boolean; source: ConfigSource; hint: string | null };
    webhookSecret: { set: boolean; source: ConfigSource };
    /** Where Stripe should send webhooks for this site. */
    webhookUrl: string;
  };
  smtp: {
    enabled: boolean;
    source: ConfigSource;
    host: string | null;
    port: number | null;
    security: 'tls' | 'starttls' | 'none' | null;
    user: string | null;
    password: { set: boolean; source: ConfigSource };
    fromName: string | null;
    fromAddress: string | null;
    replyTo: string | null;
    /** The server's .env values, shown as what's used when a field is left empty. */
    server: { host: string | null; fromAddress: string | null; fromName: string | null };
  };
  apexbook: {
    enabled: boolean;
    apiUrl: string | null;
    token: { set: boolean; source: ConfigSource };
    heartbeatMinutes: number | null;
    server: { apiUrl: string | null; heartbeatMinutes: number };
  };
  /** Set by whoever installed this server (.env); shown read-only. */
  server: { publicUrl: string; additionalOrigins: string[]; trustProxy: number; setupLinkConfigured: boolean };
  /** Saved secrets that can't be decrypted any more (the server's SESSION_SECRET changed). */
  unreadable: string[];
}
