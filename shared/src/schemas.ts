import { z } from 'zod';
import { EQUIPMENT_PRICING, MANUAL_PAYMENT_METHODS, STAFF_ROLES } from './enums';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 12;

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Enter a valid email address');
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128);
export const idSchema = z.string().min(1).max(64);
export const idParamSchema = z.object({ id: idSchema });

/** Calendar date in the business timezone. */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01');
/** Local wall-clock time HH:mm. */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 18:30');
/** HH:mm where 24:00 means end of day (closing times). */
export const closingTimeSchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use a time like 23:00');

export const penceSchema = z.number().int('Whole pence only').min(0).max(10_000_000);
const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^[0-9+()\-\s]*$/, 'Enter a valid phone number');

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Public booking
// ---------------------------------------------------------------------------

export const availabilityQuerySchema = z.object({ roomId: idSchema, date: dateSchema, ratePlanId: z.string().max(40).optional() });

export const equipmentSelectionSchema = z
  .array(z.object({ equipmentId: idSchema, quantity: z.number().int().min(1).max(50) }))
  .max(50)
  .default([])
  .refine((items) => new Set(items.map((i) => i.equipmentId)).size === items.length, 'Each item can only be listed once');

export const slotSchema = z.object({
  roomId: idSchema,
  date: dateSchema,
  startTime: timeSchema,
  durationMinutes: z.number().int().min(15).max(24 * 60),
  equipment: equipmentSelectionSchema,
  /** Session type from the room's rate plans (e.g. band rehearsal / solo). Omitted = the room's first plan. */
  ratePlanId: z.string().max(40).optional().nullable(),
  /** Promo code typed by the customer (checked on the server). */
  promoCode: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v.toUpperCase() : null)),
});

export const customerDetailsSchema = z.object({
  name: text('Name', 120),
  email: emailSchema,
  phone: phoneSchema.min(6, 'Enter a phone number so we can reach you on the day'),
  bandName: optionalText(120),
});

export const publicBookingSchema = slotSchema.extend({
  customer: customerDetailsSchema,
  notes: optionalText(1000),
  acceptTerms: z.literal(true, { message: 'Please accept the booking terms' }),
});

export const manageTokenQuerySchema = z.object({ token: z.string().min(20).max(200) });

// ---------------------------------------------------------------------------
// Staff auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Password is required').max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

export const staffCreateSchema = z.object({
  name: text('Name', 120),
  email: emailSchema,
  role: z.enum(STAFF_ROLES),
});
export const staffUpdateSchema = z.object({ role: z.enum(STAFF_ROLES), disabled: z.boolean() });

// ---------------------------------------------------------------------------
// Admin bookings
// ---------------------------------------------------------------------------

export const adminBookingSchema = slotSchema.extend({
  customerId: idSchema.optional().nullable(),
  customer: customerDetailsSchema.extend({ phone: phoneSchema.optional().nullable().transform((v) => v || null) }).optional(),
  customerNotes: optionalText(1000),
  internalNotes: optionalText(2000),
  /** Staff may book outside opening hours / notice rules. Conflicts are never overridable. */
  ignoreBookingRules: z.boolean().default(false),
  sendConfirmation: z.boolean().default(true),
  payment: z
    .object({
      method: z.enum(MANUAL_PAYMENT_METHODS),
      amountPence: penceSchema.min(1),
      note: optionalText(200),
    })
    .optional()
    .nullable(),
});

export const adminBookingUpdateSchema = slotSchema.extend({
  customerName: text('Name', 120),
  customerEmail: emailSchema,
  customerPhone: phoneSchema.optional().nullable().transform((v) => v || null),
  bandName: optionalText(120),
  customerNotes: optionalText(1000),
  internalNotes: optionalText(2000),
  /** KEEP retains the price agreed at booking; RECALCULATE applies current prices. */
  pricing: z.enum(['KEEP', 'RECALCULATE']),
  ignoreBookingRules: z.boolean().default(false),
  notifyCustomer: z.boolean().default(true),
});

export const cancelBookingSchema = z.object({
  reason: text('Reason', 500),
  refund: z.enum(['NONE', 'FULL', 'AMOUNT']).default('NONE'),
  refundAmountPence: penceSchema.optional(),
  notifyCustomer: z.boolean().default(true),
});

export const recordPaymentSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amountPence: penceSchema.min(1, 'Amount must be more than zero'),
  note: optionalText(200),
});

export const refundSchema = z.object({ amountPence: penceSchema.min(1), reason: optionalText(300) });

export const bookingListQuerySchema = z.object({
  status: z.string().max(40).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  roomId: idSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #3d6b8f');

/**
 * A session type with its own price list by length, e.g. "Band rehearsal" 2h £29,
 * 3h £36.75… or "Solo" at £11/h. Lengths past the table use extraHourPence.
 */
export const ratePlanSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/, 'Use lower-case letters, numbers and dashes'),
    name: text('Name', 60),
    description: optionalText(300),
    prices: z
      .array(z.object({ minutes: z.number().int().min(15).max(1440), pricePence: penceSchema }))
      .max(48)
      .default([])
      .refine((p) => new Set(p.map((x) => x.minutes)).size === p.length, 'Each length can only be listed once'),
    /** Per hour beyond the longest listed length (or for every hour if no lengths are listed). */
    extraHourPence: penceSchema.nullable().default(null),
    minDurationMinutes: z.number().int().min(15).max(1440).nullable().default(null),
    maxDurationMinutes: z.number().int().min(15).max(1440).nullable().default(null),
    /** Only bookable within these local times, e.g. solo sessions ending by 18:00. */
    earliestStartTime: timeSchema.nullable().default(null),
    latestEndTime: closingTimeSchema.nullable().default(null),
  })
  .refine((p) => p.prices.length > 0 || p.extraHourPence !== null, { path: ['prices'], message: 'Add at least one length price or an hourly rate' });

export const ratePlansSchema = z
  .array(ratePlanSchema)
  .max(10)
  .default([])
  .refine((p) => new Set(p.map((x) => x.id)).size === p.length, 'Each session type needs a different id');

/** Site-relative path (e.g. site/room-1.jpg) or an https:// URL. */
export const imagePathSchema = z
  .union([
    z
      .string()
      .trim()
      .max(500)
      .regex(/^(https:\/\/[^\s"'<>]+|[A-Za-z0-9_][A-Za-z0-9_./-]*)$/, 'Use a path like site/room-1.jpg or an https:// link')
      .refine((v) => !v.includes('..'), 'Invalid path'),
    z.literal(''),
  ])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Cheaper for longer: e.g. 10% off bookings of 3 hours or more. The best matching tier applies. */
export const lengthDiscountsSchema = z
  .array(z.object({ fromMinutes: z.number().int().min(30).max(1440), percentOff: z.number().int().min(1, 'At least 1%').max(90, 'At most 90%') }))
  .max(6)
  .default([])
  .refine((d) => new Set(d.map((x) => x.fromMinutes)).size === d.length, 'Each length can only have one discount');

export const roomSchema = z.object({
  name: text('Room name', 80),
  description: optionalText(2000),
  imageUrl: imagePathSchema,
  ratePlans: ratePlansSchema,
  capacity: z.number().int().min(1).max(500).optional().nullable(),
  hourlyRatePence: penceSchema,
  /** Shortest booking for this room (hourly pricing). Null = the site-wide minimum. */
  minDurationMinutes: z.number().int().min(15).max(1440).nullable().default(null),
  lengthDiscounts: lengthDiscountsSchema,
  colour: hexColour.default('#3d6b8f'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const priceRuleSchema = z
  .object({
    label: text('Label', 60),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day').max(7),
    startTime: timeSchema,
    endTime: closingTimeSchema,
    hourlyRatePence: penceSchema,
  })
  .refine((r) => timeToMinutes(r.endTime) > timeToMinutes(r.startTime), { path: ['endTime'], message: 'End must be after start' });

export const equipmentSchema = z.object({
  name: text('Name', 80),
  description: optionalText(1000),
  pricePence: penceSchema,
  pricing: z.enum(EQUIPMENT_PRICING),
  quantity: z.number().int().min(0).max(1000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const openingHoursSchema = z
  .array(
    z
      .object({ dayOfWeek: z.number().int().min(0).max(6), isOpen: z.boolean(), openTime: timeSchema, closeTime: closingTimeSchema })
      .refine((d) => !d.isOpen || timeToMinutes(d.closeTime) > timeToMinutes(d.openTime), { path: ['closeTime'], message: 'Closing must be after opening' }),
  )
  .length(7)
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, 'Each day must appear once');

export const blockSchema = z
  .object({
    roomId: idSchema.optional().nullable(),
    startDate: dateSchema,
    startTime: timeSchema,
    endDate: dateSchema,
    endTime: closingTimeSchema,
    reason: text('Reason', 200),
  });

export const settingsSchema = z.object({
  businessName: text('Business name', 120),
  timezone: z.string().min(1).max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  contactEmail: emailSchema.optional().nullable().or(z.literal('').transform(() => null)),
  contactPhone: optionalText(40),
  address: optionalText(500),
  websiteUrl: z.string().trim().url('Enter a full URL').max(300).optional().nullable().or(z.literal('').transform(() => null)),
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  minDurationMinutes: z.number().int().min(15).max(1440),
  maxDurationMinutes: z.number().int().min(15).max(1440),
  minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 14),
  maxAdvanceDays: z.number().int().min(1).max(730),
  holdMinutes: z.number().int().min(30, 'Stripe needs at least 30 minutes').max(1440),
  onlineBookingEnabled: z.boolean(),
  allowCustomerCancellation: z.boolean(),
  cancellationNoticeHours: z.number().int().min(0).max(24 * 60),
  cancellationPolicy: optionalText(4000),
  bookingTerms: optionalText(8000),
  confirmationMessage: optionalText(2000),
  adminNotifyEmail: emailSchema.optional().nullable().or(z.literal('').transform(() => null)),
  notifyOnNewBooking: z.boolean(),
  notifyOnCancellation: z.boolean(),
  homeHeadline: optionalText(120),
  homeIntro: optionalText(4000),
  announcement: optionalText(500),
  tagline: optionalText(200),
  aboutText: optionalText(8000),
  roomsIntro: optionalText(4000),
  communalText: optionalText(4000),
  privacyPolicy: optionalText(20000),
  featuredQuote: optionalText(1000),
  featuredQuoteAuthor: optionalText(120),
  instagramUrl: z.string().trim().url('Enter a full URL').max(300).optional().nullable().or(z.literal('').transform(() => null)),
  facebookUrl: z.string().trim().url('Enter a full URL').max(300).optional().nullable().or(z.literal('').transform(() => null)),
}).refine((s) => s.maxDurationMinutes >= s.minDurationMinutes, { path: ['maxDurationMinutes'], message: 'Must be at least the minimum' });

export const customerUpdateSchema = z.object({
  name: text('Name', 120),
  email: emailSchema,
  phone: phoneSchema.optional().nullable().transform((v) => v || null),
  bandName: optionalText(120),
  notes: optionalText(4000),
});

export const testEmailSchema = z.object({ to: emailSchema });

/** First-run setup of a fresh installation (see server setup.service). */
export const setupSchema = z.object({
  token: z.string().trim().min(20, 'Enter the setup code from your link').max(200),
  businessName: z.string().trim().min(1, 'Required').max(120),
  timezone: z.string().trim().min(1).max(60).refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  contactEmail: z.preprocess((v) => (v === '' ? undefined : v), emailSchema.optional()),
  contactPhone: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(40).optional()),
  adminName: z.string().trim().min(1, 'Required').max(120),
  adminEmail: emailSchema,
  password: passwordSchema,
});

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export const PROMO_KINDS = ['PERCENT', 'FIXED'] as const;

export const promoCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/, '3–30 letters, numbers or dashes')),
    description: optionalText(200),
    kind: z.enum(PROMO_KINDS),
    /** Percent (1–100) or pence off. */
    value: z.number().int().min(1),
    active: z.boolean().default(true),
    validFrom: dateSchema.nullable().default(null),
    validUntil: dateSchema.nullable().default(null),
    maxUses: z.number().int().min(1).max(100_000).nullable().default(null),
    onePerCustomer: z.boolean().default(false),
    /** Empty = every room. */
    roomIds: z.array(idSchema).max(50).default([]),
    minSpendPence: penceSchema.nullable().default(null),
    minDurationMinutes: z.number().int().min(15).max(1440).nullable().default(null),
  })
  .refine((p) => p.kind !== 'PERCENT' || p.value <= 100, { path: ['value'], message: 'A percentage can be at most 100' })
  .refine((p) => !p.validFrom || !p.validUntil || p.validFrom <= p.validUntil, { path: ['validUntil'], message: 'Ends before it starts' });

// ---------------------------------------------------------------------------
// Connections (Admin › Settings: payments, email, ApexBook monitoring)
// ---------------------------------------------------------------------------

/** A secret field: undefined = keep what's saved, null = remove it (use the server's), string = new value. */
const secretInput = (pattern: RegExp, message: string) => z.string().trim().regex(pattern, message).nullable().optional();
const optionalEmail = emailSchema.nullable().or(z.literal('').transform(() => null));

export const connectionsSchema = z.object({
  bookingRefPrefix: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2,5}$/, '2–5 letters'))
    .nullable()
    .or(z.literal('').transform(() => null)),
  stripeSecretKey: secretInput(/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/, 'Starts with sk_live_ or sk_test_'),
  stripeWebhookSecret: secretInput(/^whsec_[A-Za-z0-9]{10,}$/, 'Starts with whsec_'),
  smtpHost: z.string().trim().max(253).regex(/^[A-Za-z0-9.-]+$/, 'A server name like smtp.example.com').nullable().or(z.literal('').transform(() => null)),
  smtpPort: z.number().int().min(1).max(65535).nullable(),
  smtpSecurity: z.enum(['tls', 'starttls', 'none']).nullable(),
  smtpUser: z.string().trim().max(200).nullable().or(z.literal('').transform(() => null)),
  smtpPassword: z.string().max(500).nullable().optional(),
  emailFromName: z.string().trim().max(120).nullable().or(z.literal('').transform(() => null)),
  emailFromAddress: optionalEmail,
  emailReplyTo: optionalEmail,
  apexbookApiUrl: z.string().trim().url('Enter a full address, e.g. https://apexbook.co.uk').max(300).nullable().or(z.literal('').transform(() => null)),
  apexbookAgentToken: z.string().trim().min(20, 'Paste the whole key').max(500).nullable().optional(),
  apexbookHeartbeatMinutes: z.number().int().min(1).max(1440).nullable(),
});

// ---------------------------------------------------------------------------
// Setup transfer (Admin › Settings › Server): copy one installation's setup to another,
// e.g. moving a cloud site onto the studio's own server. No bookings, customers, staff or secrets.
// ---------------------------------------------------------------------------

export const SETUP_FILE_FORMAT = 'apexbook-booking-setup';
export const SETUP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

/** A setup file as sent to the import (photos are uploaded separately, so `data` is not included). */
export const setupFileSchema = z.object({
  format: z.literal(SETUP_FILE_FORMAT, 'This is not an ApexBook booking setup file'),
  version: z.literal(1, 'This setup file is from a newer version. Update this installation first.'),
  exportedAt: z.string().max(40),
  from: z.object({ businessName: z.string().max(200), publicUrl: z.string().max(300), version: z.string().max(80) }),
  settings: settingsSchema,
  currency: z.string().regex(/^[a-z]{3}$/),
  bookingRefPrefix: connectionsSchema.shape.bookingRefPrefix,
  /** Email server details without the password (it has to be entered again). */
  email: connectionsSchema.pick({ smtpHost: true, smtpPort: true, smtpSecurity: true, smtpUser: true, emailFromName: true, emailFromAddress: true, emailReplyTo: true }),
  openingHours: openingHoursSchema,
  rooms: z.array(roomSchema.extend({ id: idSchema, priceRules: z.array(priceRuleSchema).max(50) })).max(100),
  equipment: z.array(equipmentSchema.extend({ id: idSchema })).max(500),
  promoCodes: z.array(promoCodeSchema).max(500),
  closures: z
    .array(z.object({ roomId: idSchema.nullable(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), reason: z.string().trim().min(1).max(200) }))
    .max(2000),
  website: z.object({
    builderLive: z.boolean(),
    /** Working copy and the live version (website builder documents). */
    draft: z.unknown().nullable(),
    published: z.unknown().nullable(),
    assets: z.array(z.object({ id: idSchema, filename: z.string().trim().min(1).max(200), mime: z.enum(SETUP_IMAGE_TYPES), size: z.number().int().min(1) })).max(500),
  }),
});
export type SetupFile = z.output<typeof setupFileSchema>;
export const setupImportSchema = z.object({ setup: setupFileSchema, confirm: z.literal(true, 'Tick the box to confirm') });
