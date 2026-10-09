import nodemailer, { type Transporter } from 'nodemailer';
import { integrations, onIntegrationsChange } from '../../config/integrations';
import { getSettings } from '../settings.service';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  ics?: string | null;
}

let transporter: Transporter | undefined;
let testTransport = false;

// New email settings take effect at once.
onIntegrationsChange(() => {
  if (!testTransport) transporter = undefined;
});

/** Swap the transport (tests point this at a local SMTP server). */
export function setTransport(t: Transporter | undefined) {
  transporter = t;
  testTransport = Boolean(t);
}

function getTransport(): Transporter {
  if (transporter) return transporter;
  const smtp = integrations().smtp;
  if (!smtp.enabled) throw new Error('Email is not set up (Admin › Settings › Email)');
  const port = smtp.port;
  transporter = nodemailer.createTransport({
    host: smtp.host ?? undefined,
    port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

export function smtpConfigured() {
  return Boolean(transporter) || integrations().smtp.enabled;
}

export async function deliver(mail: OutgoingMail) {
  await getTransport().sendMail({
    from: { name: integrations().smtp.fromName ?? (await getSettings()).businessName, address: integrations().smtp.fromAddress ?? 'no-reply@localhost' },
    replyTo: integrations().smtp.replyTo ?? undefined,
    to: mail.to,
    // User-supplied text can reach subjects; never allow header line breaks.
    subject: mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 250),
    text: mail.text,
    ...(mail.ics ? { icalEvent: { method: 'PUBLISH', filename: 'booking.ics', content: mail.ics } } : {}),
  });
}

/** Open a connection and authenticate, without sending anything. */
export async function verifySmtp(): Promise<{ ok: boolean; detail: string }> {
  if (!smtpConfigured()) return { ok: false, detail: 'SMTP is not configured' };
  try {
    await getTransport().verify();
    return { ok: true, detail: `Connected to ${integrations().smtp.host ?? 'configured transport'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Connection failed' };
  }
}
