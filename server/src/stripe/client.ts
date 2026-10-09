import Stripe from 'stripe';
import { integrations, onIntegrationsChange } from '../config/integrations';
import { serviceUnavailable } from '../utils/errors';

// The studio's own Stripe account — completely separate from ApexBook's SaaS billing.
let client: Stripe | undefined;
let testClient = false;

// A new key in Settings takes effect at once (tests' stand-in client is kept).
onIntegrationsChange((next, prev) => {
  if (!testClient && next.stripe.secretKey !== prev.stripe.secretKey) client = undefined;
});

export function stripe(): Stripe {
  if (client) return client;
  const key = integrations().stripe.secretKey;
  if (!key) throw serviceUnavailable('Online payments are not set up.');
  client = new Stripe(key, { appInfo: { name: 'ApexBook Booking' }, maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export function setStripeClient(c: Stripe | undefined) {
  client = c;
  testClient = Boolean(c);
}

export const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === 'string' ? v : v.id);
