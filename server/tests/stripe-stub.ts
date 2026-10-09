// Test double for the Stripe API. It records what the app asks Stripe to do and
// returns Stripe-shaped objects. Webhook signing/verification uses the real library.
import Stripe from 'stripe';

export const WEBHOOK_SECRET = 'whsec_habitat_test';
const real = new Stripe('sk_test_habitat_local_only');

interface StubSession {
  id: string;
  url: string;
  amount_total: number;
  currency: string;
  metadata: Record<string, string>;
  client_reference_id: string | null;
  expires_at: number;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid';
  payment_intent: string | null;
  params: Stripe.Checkout.SessionCreateParams;
}

export function createStripeStub() {
  let n = 0;
  const sessions = new Map<string, StubSession>();
  const refunds: { payment_intent: string; amount: number }[] = [];
  const refundedByPi = new Map<string, number>();
  const state = { failCheckout: false, failRefunds: false };

  const stub = {
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(params: Stripe.Checkout.SessionCreateParams) {
          if (state.failCheckout) throw new Error('Stripe API unreachable (simulated)');
          // Like the real API: line item prices can't be negative (discounts must not be sent as lines).
          if ((params.line_items ?? []).some((l) => (l.price_data?.unit_amount ?? 0) < 0)) {
            throw new Error('Invalid non-negative integer: line_items[].price_data.unit_amount (simulated)');
          }
          const id = `cs_test_${++n}`;
          const amount = (params.line_items ?? []).reduce((s, l) => s + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1), 0);
          const s: StubSession = {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
            amount_total: amount,
            currency: params.line_items?.[0]?.price_data?.currency ?? 'gbp',
            metadata: (params.metadata ?? {}) as Record<string, string>,
            client_reference_id: params.client_reference_id ?? null,
            expires_at: params.expires_at ?? 0,
            status: 'open',
            payment_status: 'unpaid',
            payment_intent: null,
            params,
          };
          sessions.set(id, s);
          return s;
        },
        async retrieve(id: string) {
          const s = sessions.get(id);
          if (!s) throw new Error('No such session');
          return s;
        },
        async expire(id: string) {
          const s = sessions.get(id);
          if (s) s.status = 'expired';
          return s;
        },
      },
    },
    refunds: {
      async create(params: { payment_intent: string; amount: number }) {
        if (state.failRefunds) throw new Error('Stripe API unreachable (simulated)');
        refunds.push(params);
        refundedByPi.set(params.payment_intent, (refundedByPi.get(params.payment_intent) ?? 0) + params.amount);
        return { id: `re_${refunds.length}`, ...params };
      },
    },
    paymentIntents: {
      async retrieve(id: string) {
        return { id, latest_charge: { id: `ch_${id}`, amount_refunded: refundedByPi.get(id) ?? 0 } };
      },
    },
  };

  /** Simulate the customer paying: mark the session paid and return the webhook event. */
  function pay(sessionId: string, eventId = `evt_${sessionId}_paid`) {
    const s = sessions.get(sessionId)!;
    s.status = 'complete';
    s.payment_status = 'paid';
    s.payment_intent = `pi_${sessionId}`;
    return event('checkout.session.completed', { ...s, object: 'checkout.session' }, eventId);
  }

  return { stub: stub as unknown as Stripe, sessions, refunds, state, pay };
}

export function event(type: string, object: object, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id, object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: '2025-08-27.basil', data: { object } };
}

export function signedPayload(evt: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(evt);
  return { payload, signature: real.webhooks.generateTestHeaderString({ payload, secret }) };
}
