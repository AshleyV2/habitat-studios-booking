import type { ConnectionsDto } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Badge } from '../../components/Badges';
import { SelectField, TextAreaField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, Notice } from '../../components/States';

/*
 * Admin › Settings, in tabs. Business and booking settings save together; connections (payments,
 * email, monitoring, booking references) save separately because they can hold secrets.
 * Risky changes ask for confirmation first, listing what will happen.
 */

type Row = Record<string, string | number | boolean | null>;
type Msg = { tone: 'ok' | 'error' | 'warn'; text: string } | null;
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${Object.keys(e.fields).length ? ` (${Object.values(e.fields).join('; ')})` : ''}` : 'Something went wrong');

const TABS = [
  ['business', 'Business'],
  ['bookings', 'Bookings'],
  ['payments', 'Payments'],
  ['email', 'Email'],
  ['website', 'Website text'],
  ['monitoring', 'Monitoring'],
  ['server', 'Server'],
] as const;
type Tab = (typeof TABS)[number][0];

/** "Shown on …" link to where a field appears on the public website. */
function OnSite({ to, children }: { to: string; children: ReactNode }) {
  return (
    <>
      {' '}
      <a href={to} target="_blank" rel="noopener">{children} ↗</a>
    </>
  );
}

/** What a change to the general settings will do, for the "are you sure?" step. */
function generalWarnings(before: Row, after: Row): string[] {
  const w: string[] = [];
  const changed = (k: string) => String(before[k] ?? '') !== String(after[k] ?? '');
  if (changed('timezone')) w.push(`Timezone → ${after.timezone}: opening hours and new booking times are read in the new timezone. Existing bookings keep their exact moment, so they may now show at a different clock time.`);
  if (before.onlineBookingEnabled && !after.onlineBookingEnabled) w.push('Online booking switches off: customers can’t book on the website until you switch it back on.');
  if (changed('slotMinutes')) w.push('Start-time steps change: customers will see different start times. Existing bookings aren’t moved.');
  if (changed('minDurationMinutes') || changed('maxDurationMinutes')) w.push('Booking lengths change for new bookings (rooms with their own minimum keep it).');
  if (before.allowCustomerCancellation && !after.allowCustomerCancellation) w.push('Customers can no longer cancel online; they’ll have to contact you.');
  if (changed('cancellationNoticeHours')) w.push(`Automatic refunds will apply up to ${after.cancellationNoticeHours} hours before a booking, for every booking including existing ones.`);
  if (changed('businessName')) w.push(`Your business name changes to “${after.businessName}” on the website, emails and Stripe receipts.`);
  return w;
}

type ConnForm = {
  bookingRefPrefix: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  clearStripeSecretKey: boolean;
  clearStripeWebhookSecret: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: string;
  smtpUser: string;
  smtpPassword: string;
  clearSmtpPassword: boolean;
  emailFromName: string;
  emailFromAddress: string;
  emailReplyTo: string;
  apexbookApiUrl: string;
  apexbookAgentToken: string;
  clearApexbookAgentToken: boolean;
  apexbookHeartbeatMinutes: string;
};

const connForm = (c: ConnectionsDto): ConnForm => ({
  bookingRefPrefix: c.bookingRefPrefix.value ?? '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  clearStripeSecretKey: false,
  clearStripeWebhookSecret: false,
  smtpHost: c.smtp.host ?? '',
  smtpPort: c.smtp.port ? String(c.smtp.port) : '',
  smtpSecurity: c.smtp.security ?? 'starttls',
  smtpUser: c.smtp.user ?? '',
  smtpPassword: '',
  clearSmtpPassword: false,
  emailFromName: c.smtp.fromName ?? '',
  emailFromAddress: c.smtp.fromAddress ?? '',
  emailReplyTo: c.smtp.replyTo ?? '',
  apexbookApiUrl: c.apexbook.apiUrl ?? '',
  apexbookAgentToken: '',
  clearApexbookAgentToken: false,
  apexbookHeartbeatMinutes: c.apexbook.heartbeatMinutes ? String(c.apexbook.heartbeatMinutes) : '',
});

/** Secret fields: blank = keep, "remove" ticked = clear, otherwise the new value. */
const secretValue = (value: string, clear: boolean) => (clear ? null : value.trim() ? value.trim() : undefined);

function connBody(f: ConnForm) {
  return {
    bookingRefPrefix: f.bookingRefPrefix || null,
    stripeSecretKey: secretValue(f.stripeSecretKey, f.clearStripeSecretKey),
    stripeWebhookSecret: secretValue(f.stripeWebhookSecret, f.clearStripeWebhookSecret),
    smtpHost: f.smtpHost || null,
    smtpPort: f.smtpPort ? Number(f.smtpPort) : null,
    smtpSecurity: f.smtpHost ? f.smtpSecurity : null,
    smtpUser: f.smtpUser || null,
    smtpPassword: secretValue(f.smtpPassword, f.clearSmtpPassword),
    emailFromName: f.emailFromName || null,
    emailFromAddress: f.emailFromAddress || null,
    emailReplyTo: f.emailReplyTo || null,
    apexbookApiUrl: f.apexbookApiUrl || null,
    apexbookAgentToken: secretValue(f.apexbookAgentToken, f.clearApexbookAgentToken),
    apexbookHeartbeatMinutes: f.apexbookHeartbeatMinutes ? Number(f.apexbookHeartbeatMinutes) : null,
  };
}

function connWarnings(c: ConnectionsDto, f: ConnForm, tab: Tab): string[] {
  const w: string[] = [];
  if (tab === 'bookings' && (f.bookingRefPrefix || c.bookingRefPrefix.server) !== (c.bookingRefPrefix.value ?? c.bookingRefPrefix.server)) {
    w.push(`New bookings will get references starting ${(f.bookingRefPrefix || c.bookingRefPrefix.server).toUpperCase()}-. Existing references (and their links) keep working.`);
  }
  if (tab === 'payments') {
    const key = f.stripeSecretKey.trim();
    if (key) {
      const live = key.includes('_live_');
      if (c.stripe.mode && (c.stripe.mode === 'live') !== live) {
        w.push(live ? 'Switching Stripe to LIVE: real card payments will be taken from now on.' : 'Switching Stripe to TEST mode: customers won’t be charged, and bookings made will not be paid for.');
      } else w.push('A new Stripe key: payments go to the account this key belongs to. Bookings already waiting for payment may not confirm.');
    }
    if (f.clearStripeSecretKey) w.push('Removing the Stripe key: online booking stops unless the server has its own key set.');
    if (f.stripeWebhookSecret.trim() || f.clearStripeWebhookSecret) w.push('A different webhook secret: if it doesn’t match the endpoint in Stripe, paid bookings won’t confirm. Check with a test booking after saving.');
  }
  if (tab === 'email') {
    const changed = f.smtpHost !== (c.smtp.host ?? '') || f.smtpPort !== (c.smtp.port ? String(c.smtp.port) : '') || f.smtpUser !== (c.smtp.user ?? '') || f.smtpPassword || f.clearSmtpPassword || f.emailFromAddress !== (c.smtp.fromAddress ?? '');
    if (changed) w.push('Email server details change: if anything is wrong, booking confirmations and password resets stop sending (they wait in the outbox). Use “Send a test email” after saving.');
  }
  if (tab === 'monitoring' && (f.apexbookApiUrl !== (c.apexbook.apiUrl ?? '') || f.apexbookAgentToken || f.clearApexbookAgentToken)) {
    w.push('Monitoring details change: if they’re wrong, ApexBook will show this system as offline and alert its support team.');
  }
  return w;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const general = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<Row>('/api/admin/settings') });
  const conns = useQuery({ queryKey: ['admin', 'settings', 'connections'], queryFn: () => api.get<ConnectionsDto>('/api/admin/settings/connections') });
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.slice(1);
    return (TABS.find(([k]) => k === h)?.[0] ?? 'business') as Tab;
  });
  const [v, setV] = useState<Row | null>(null);
  const [f, setF] = useState<ConnForm | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (general.data && !v) setV(general.data);
  }, [general.data, v]);
  useEffect(() => {
    if (conns.data && !f) setF(connForm(conns.data));
  }, [conns.data, f]);

  const go = (t: Tab) => {
    setTab(t);
    setMsg(null);
    setConfirm(null);
    setTestResult(null);
    window.history.replaceState(null, '', `#${t}`);
  };

  if (!general.data) return <Async query={general}>{() => null}</Async>;
  if (!conns.data) return <Async query={conns}>{() => null}</Async>;
  if (!v || !f) return null;
  const c = conns.data;

  const str = (k: string) => ({ name: k, value: (v[k] as string | null) ?? '', onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  const num = (k: string) => ({ name: k, inputMode: 'numeric' as const, value: String(v[k] ?? ''), onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value === '' ? '' : Number(e.target.value) }) });
  const hoursOf = (k: string) => ({ name: k, inputMode: 'decimal' as const, value: String(Number(v[k]) / 60), onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: Math.round(Number(e.target.value) * 60) }) });
  const bool = (k: string, label: ReactNode) => (
    <label className="checkbox" style={{ marginBottom: 10 }}><input type="checkbox" checked={Boolean(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><span>{label}</span></label>
  );
  const cs = (k: keyof ConnForm) => ({ name: k, value: f[k] as string, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const clearBox = (k: keyof ConnForm, label: string) => (
    <label className="checkbox small" style={{ marginTop: -8, marginBottom: 12 }}><input type="checkbox" checked={Boolean(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /><span>{label}</span></label>
  );
  const source = (s: 'settings' | 'server' | null, set: boolean) =>
    set ? (s === 'server' ? <Badge>Set on the server</Badge> : <Badge tone="ok">Saved</Badge>) : <Badge tone="warn">Not set</Badge>;

  const usesGeneral = tab === 'business' || tab === 'bookings' || tab === 'email' || tab === 'website';
  const usesConns = tab === 'bookings' || tab === 'payments' || tab === 'email' || tab === 'monitoring';

  async function save(confirmed = false) {
    if (!confirmed) {
      const w = [...(usesGeneral ? generalWarnings(general.data!, v!) : []), ...(usesConns ? connWarnings(c, f!, tab) : [])];
      if (w.length) return setConfirm(w);
    }
    setConfirm(null);
    setSaving(true);
    setMsg(null);
    try {
      if (usesGeneral) {
        const { id: _id, updatedAt: _u, currency: _c, ...body } = v!;
        const saved = await api.put<Row>('/api/admin/settings', { ...body, slotMinutes: Number(body.slotMinutes) });
        setV(saved);
        qc.setQueryData(['admin', 'settings'], saved);
        void qc.invalidateQueries({ queryKey: ['public-config'] });
      }
      if (usesConns) {
        const saved = await api.put<ConnectionsDto>('/api/admin/settings/connections', connBody(f!));
        qc.setQueryData(['admin', 'settings', 'connections'], saved);
        setF(connForm(saved));
      }
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errText(err) });
    } finally {
      setSaving(false);
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  async function test(service: 'stripe' | 'apexbook') {
    setTestResult(null);
    try {
      setTestResult(await api.post<{ ok: boolean; detail: string }>('/api/admin/settings/connections/test', { service }));
    } catch (err) {
      setTestResult({ ok: false, detail: errText(err) });
    }
  }
  async function testEmail() {
    setTestResult(null);
    try {
      const check = await api.post<{ ok: boolean; detail: string }>('/api/admin/email/verify');
      if (!check.ok || !testTo) return setTestResult(check);
      const sent = await api.post<{ status: string; lastError: string | null }>('/api/admin/email/test', { to: testTo });
      setTestResult(sent.status === 'SENT' ? { ok: true, detail: `${check.detail}. A test email was sent to ${testTo}.` } : { ok: false, detail: sent.lastError ?? 'The test email couldn’t be sent.' });
    } catch (err) {
      setTestResult({ ok: false, detail: errText(err) });
    }
  }

  const saveBar = (
    <div className="settings-save">
      {confirm && (
        <div className="notice notice--warn settings-confirm" role="alertdialog" aria-label="Check before saving">
          <strong>Before you save:</strong>
          <ul>{confirm.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => void save(true)} disabled={saving}>Yes, save these changes</button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>Go back</button>
          </div>
        </div>
      )}
      {!confirm && <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
    </div>
  );

  return (
    <>
      <PageHeader title="Settings" meta="Business details, booking rules, payments, email and monitoring." />
      <nav className="subnav" aria-label="Settings sections">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#${k}`} aria-current={tab === k ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(k); }}>
            {label}
            {k === 'payments' && !c.stripe.enabled && <span className="settings-dot" title="Not set up" />}
            {k === 'email' && !c.smtp.enabled && <span className="settings-dot" title="Not set up" />}
          </a>
        ))}
      </nav>
      {c.unreadable.length > 0 && (
        <Notice tone="error">
          Saved {c.unreadable.join(', ')} can’t be read any more (the server’s secret key was changed). Enter {c.unreadable.length === 1 ? 'it' : 'them'} again below.
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <form onSubmit={onSubmit} noValidate className="panel settings-panel">
        <div className="panel__body">
          {tab === 'business' && (
            <>
              <TextField label="Business name" {...str('businessName')} hint={<>On your website, emails and Stripe receipts.<OnSite to="/">See your website</OnSite></>} />
              <div className="field-row">
                <TextField label="Contact email" optional type="email" {...str('contactEmail')} hint={<>Shown to customers.<OnSite to="/contact">Contact page</OnSite></>} />
                <TextField label="Contact phone" optional {...str('contactPhone')} />
              </div>
              <TextAreaField label="Address" optional rows={2} {...str('address')} hint={<>Shown with a map link.<OnSite to="/contact">Contact page</OnSite></>} />
              <div className="field-row">
                <TextField label="Instagram" optional {...str('instagramUrl')} placeholder="https://instagram.com/…" />
                <TextField label="Facebook" optional {...str('facebookUrl')} placeholder="https://facebook.com/…" />
              </div>
              <div className="field-row">
                <TextField label="Timezone" {...str('timezone')} hint="e.g. Europe/London. Changing it moves how opening hours are read." />
                <TextField label="Other website" optional {...str('websiteUrl')} hint="Only if you have a separate site to link to." />
              </div>
            </>
          )}

          {tab === 'bookings' && (
            <>
              {bool('onlineBookingEnabled', <>Accept online bookings<OnSite to="/book">Booking page</OnSite></>)}
              <div className="field-row">
                <SelectField label="Start-time steps" name="slotMinutes" value={String(v.slotMinutes)} onChange={(e) => setV({ ...v, slotMinutes: Number(e.target.value) })} options={[{ value: '15', label: 'Every 15 minutes' }, { value: '30', label: 'Every 30 minutes' }, { value: '60', label: 'On the hour' }]} />
                <TextField label="Hold while paying (minutes)" {...num('holdMinutes')} hint="At least 30 (Stripe’s limit)." />
              </div>
              <div className="field-row">
                <TextField label="Shortest booking (hours)" {...hoursOf('minDurationMinutes')} hint={<>Rooms can set their own in <Link to="/admin/rooms">Rooms &amp; pricing</Link>.</>} />
                <TextField label="Longest booking (hours)" {...hoursOf('maxDurationMinutes')} />
              </div>
              <div className="field-row">
                <TextField label="Minimum notice (hours)" {...hoursOf('minNoticeMinutes')} />
                <TextField label="Book up to (days ahead)" {...num('maxAdvanceDays')} />
              </div>
              <TextField label="Booking reference start" optional {...cs('bookingRefPrefix')} placeholder={c.bookingRefPrefix.server} hint={`2–5 letters. New references look like ${(f.bookingRefPrefix || c.bookingRefPrefix.server).toUpperCase()}-7K3Q9X.`} />
              <h3 className="settings-sub">Cancellations and terms</h3>
              {bool('allowCustomerCancellation', 'Customers may cancel online')}
              <TextField label="Full refund if cancelled at least (hours before)" {...num('cancellationNoticeHours')} />
              <TextAreaField label="Cancellation policy" optional rows={3} {...str('cancellationPolicy')} hint={<>Shown when booking and on its own page.<OnSite to="/refunds">Refund policy</OnSite></>} />
              <TextAreaField label="Booking terms (customers must accept)" optional rows={4} {...str('bookingTerms')} hint={<OnSite to="/terms">Terms page</OnSite>} />
              <TextAreaField label="Extra text in confirmation emails" optional rows={2} {...str('confirmationMessage')} hint="Directions, parking, door codes…" />
            </>
          )}

          {tab === 'payments' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Card payments go to <strong>your own Stripe account</strong>. Stripe status: {c.stripe.enabled ? <Badge tone={c.stripe.mode === 'live' ? 'ok' : 'warn'}>{c.stripe.mode === 'live' ? 'Live' : 'Test mode'}</Badge> : <Badge tone="warn">Not set up</Badge>}
              </p>
              <TextField
                label={<>Secret key {source(c.stripe.secretKey.source, c.stripe.secretKey.set)}</>}
                optional
                type="password"
                autoComplete="off"
                {...cs('stripeSecretKey')}
                placeholder={c.stripe.secretKey.hint ?? 'sk_live_…'}
                hint="Stripe Dashboard › Developers › API keys. Leave blank to keep the current one."
              />
              {c.stripe.secretKey.source === 'settings' && clearBox('clearStripeSecretKey', 'Remove the saved key')}
              <TextField
                label={<>Webhook signing secret {source(c.stripe.webhookSecret.source, c.stripe.webhookSecret.set)}</>}
                optional
                type="password"
                autoComplete="off"
                {...cs('stripeWebhookSecret')}
                placeholder="whsec_…"
                hint={<>In Stripe, add a webhook endpoint for <code>{c.stripe.webhookUrl}</code> (events: checkout.session.*, charge.refunded), then paste its signing secret.</>}
              />
              {c.stripe.webhookSecret.source === 'settings' && clearBox('clearStripeWebhookSecret', 'Remove the saved secret')}
              <div className="row" style={{ marginBottom: 12 }}>
                <button type="button" className="btn btn--small" onClick={() => void test('stripe')} disabled={!c.stripe.secretKey.set}>Test the saved key</button>
              </div>
            </>
          )}

          {tab === 'email' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Booking confirmations, reminders and staff alerts. Status: {c.smtp.enabled ? <Badge tone="ok">{c.smtp.source === 'server' ? 'Set on the server' : 'Working settings saved'}</Badge> : <Badge tone="warn">Not set up</Badge>}
              </p>
              <div className="field-row">
                <TextField label="Email server (SMTP)" optional {...cs('smtpHost')} placeholder={c.smtp.server.host ?? 'smtp.example.com'} hint={c.smtp.source === 'server' ? 'Using the server’s settings while this is blank.' : 'From your email provider.'} />
                <SelectField label="Security" name="smtpSecurity" value={f.smtpSecurity} onChange={(e) => setF({ ...f, smtpSecurity: e.target.value })} options={[{ value: 'starttls', label: 'STARTTLS (port 587)' }, { value: 'tls', label: 'TLS (port 465)' }, { value: 'none', label: 'None (local relay only)' }]} />
              </div>
              <div className="field-row">
                <TextField label="Port" optional inputMode="numeric" {...cs('smtpPort')} placeholder={f.smtpSecurity === 'tls' ? '465' : '587'} />
                <TextField label="Username" optional autoComplete="off" {...cs('smtpUser')} />
              </div>
              <TextField label={<>Password {source(c.smtp.password.source, c.smtp.password.set)}</>} optional type="password" autoComplete="new-password" {...cs('smtpPassword')} hint="Leave blank to keep the current one." />
              {c.smtp.password.source === 'settings' && clearBox('clearSmtpPassword', 'Remove the saved password')}
              <div className="field-row">
                <TextField label="Send from address" optional type="email" {...cs('emailFromAddress')} placeholder={c.smtp.server.fromAddress ?? 'bookings@yourstudio.co.uk'} />
                <TextField label="Sender name" optional {...cs('emailFromName')} placeholder={c.smtp.server.fromName ?? String(v.businessName ?? '')} hint="Blank = your business name." />
              </div>
              <TextField label="Replies go to" optional type="email" {...cs('emailReplyTo')} />
              <div className="row" style={{ marginBottom: 12 }}>
                <input className="input" style={{ maxWidth: 260 }} type="email" placeholder="you@example.com" aria-label="Send a test email to" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <button type="button" className="btn btn--small" onClick={() => void testEmail()} disabled={!c.smtp.enabled}>{testTo ? 'Send a test email' : 'Check the connection'}</button>
                <Link to="/admin/email" className="small">Email log</Link>
              </div>
              <h3 className="settings-sub">Staff notifications</h3>
              <TextField label="Notify staff at" optional type="email" {...str('adminNotifyEmail')} />
              {bool('notifyOnNewBooking', 'Email staff about new bookings')}
              {bool('notifyOnCancellation', 'Email staff about cancellations')}
            </>
          )}

          {tab === 'website' && (
            <>
              <Notice tone="info">
                Your website’s pages are edited in <Link to="/admin/website">Website</Link>. These texts fill in the starter pages (and the original site, where there is one); the policy pages always use them.
              </Notice>
              <TextField label="Announcement banner" optional {...str('announcement')} hint={<>e.g. holiday hours. Empty = hidden.<OnSite to="/">Home page</OnSite></>} />
              <div className="field-row">
                <TextField label="Home headline" optional {...str('homeHeadline')} hint='Blank = "Welcome to" + your name.' />
                <TextField label="Tagline" optional {...str('tagline')} />
              </div>
              <details className="settings-more">
                <summary>Page texts (about, rooms, quote)</summary>
                <TextAreaField label="Home introduction" optional rows={3} {...str('homeIntro')} />
                <TextAreaField label="About (our story)" optional rows={5} {...str('aboutText')} hint={<>Blank line between paragraphs.<OnSite to="/about">About page</OnSite></>} />
                <TextAreaField label="Rooms introduction" optional rows={3} {...str('roomsIntro')} hint={<OnSite to="/rooms">Rooms page</OnSite>} />
                <TextAreaField label="Communal area" optional rows={3} {...str('communalText')} />
                <div className="field-row">
                  <TextAreaField label="Client quote" optional rows={2} {...str('featuredQuote')} />
                  <TextField label="Quote by" optional {...str('featuredQuoteAuthor')} />
                </div>
              </details>
              <TextAreaField label="Privacy policy" optional rows={5} {...str('privacyPolicy')} hint={<OnSite to="/privacy">Privacy page</OnSite>} />
            </>
          )}

          {tab === 'monitoring' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Optional: lets ApexBook see that this booking system is online and up to date. Bookings never depend on it. Status: {c.apexbook.enabled ? <Badge tone="ok">Connected</Badge> : <Badge>Off</Badge>}
              </p>
              <TextField label="ApexBook address" optional {...cs('apexbookApiUrl')} placeholder={c.apexbook.server.apiUrl ?? 'https://apexbook.co.uk'} />
              <TextField label={<>Monitoring key {source(c.apexbook.token.source, c.apexbook.token.set)}</>} optional type="password" autoComplete="off" {...cs('apexbookAgentToken')} hint="From ApexBook: Systems › this system › Issue monitoring agent token. Leave blank to keep the current one." />
              {c.apexbook.token.source === 'settings' && clearBox('clearApexbookAgentToken', 'Remove the saved key')}
              <TextField label="Report every (minutes)" optional inputMode="numeric" {...cs('apexbookHeartbeatMinutes')} placeholder={String(c.apexbook.server.heartbeatMinutes)} />
              <div className="row" style={{ marginBottom: 12 }}>
                <button type="button" className="btn btn--small" onClick={() => void test('apexbook')} disabled={!c.apexbook.enabled}>Send a heartbeat now</button>
              </div>
            </>
          )}

          {tab === 'server' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Set when this server was installed (its <code>.env</code> file), because changing them from here could lock everyone out. Ask whoever runs your server to change them.
              </p>
              <dl className="settings-dl">
                <dt>Website address</dt>
                <dd><a href={c.server.publicUrl} target="_blank" rel="noopener">{c.server.publicUrl} ↗</a></dd>
                <dt>Other addresses staff use</dt>
                <dd>{c.server.additionalOrigins.length ? c.server.additionalOrigins.join(', ') : 'None'}</dd>
                <dt>Behind a proxy</dt>
                <dd>{c.server.trustProxy ? `Yes (${c.server.trustProxy})` : 'No'}</dd>
                <dt>First-run setup link</dt>
                <dd>{c.server.setupLinkConfigured ? 'Configured (it stops working once an administrator exists)' : 'Not configured'}</dd>
              </dl>
              <p className="small muted">Payments, email and monitoring set on the server are used whenever the matching field here is blank.</p>
            </>
          )}

          {testResult && <Notice tone={testResult.ok ? 'ok' : 'error'}>{testResult.detail}</Notice>}
          {tab !== 'server' && saveBar}
        </div>
      </form>
    </>
  );
}
