import { changePasswordSchema, staffCreateSchema, type AuditEntryDto, type EmailMessageDto, type StaffUserDto, type SystemHealthResponse } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Badge, HealthBadge } from '../../components/Badges';
import { FormError, SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState, Notice } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { dateTime } from '../../lib/format';
import { useTz } from './DashboardPage';

export function HealthPage() {
  const query = useQuery({ queryKey: ['admin', 'health'], queryFn: () => api.get<SystemHealthResponse>('/api/admin/health'), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="System health" meta="Everything here runs on this server except Stripe, email delivery and the optional ApexBook link." />
      <Async query={query}>
        {(h) => (
          <>
            <div className="panel">
              <table className="table table--stack">
                <thead><tr><th scope="col">Component</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
                <tbody>
                  {h.checks.map((c) => (
                    <tr key={c.name}>
                      <td className="table__head-cell" data-label="Component"><strong>{c.name}</strong></td>
                      <td data-label="Status"><HealthBadge status={c.status} /></td>
                      <td data-label="Detail">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Version {h.version} · up {Math.floor(h.uptimeSeconds / 3600)} h {Math.floor((h.uptimeSeconds % 3600) / 60)} min. Backup, restore and update steps: docs/OPERATIONS.md on the server.</p>
          </>
        )}
      </Async>
    </>
  );
}

export function EmailPage() {
  const tz = useTz();
  const { can } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'email'], queryFn: () => api.get<{ configured: boolean; messages: EmailMessageDto[] }>('/api/admin/email') });
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(true);
    setMsg(null);
    try {
      done(await fn());
      void qc.invalidateQueries({ queryKey: ['admin', 'email'] });
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Email" meta="Emails are queued in the local database and retried automatically if the mail server is unavailable." />
      <Async query={query}>
        {(d) => (
          <>
            {!d.configured && <Notice tone="warn">Outgoing email is not configured (SMTP_HOST, EMAIL_FROM_ADDRESS…). Messages wait in the queue below and will send once it is.</Notice>}
            {msg && <Notice tone={msg.tone} role="status">{msg.text}</Notice>}
            {can('settings:write') && (
              <section className="panel" aria-labelledby="test-h">
                <div className="panel__header"><h2 id="test-h">Test</h2></div>
                <div className="panel__body">
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.post<{ ok: boolean; detail: string }>('/api/admin/email/verify'), (r) => setMsg({ tone: r.ok ? 'ok' : 'error', text: r.detail }))}>Check SMTP connection</button>
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="test-to">Send test email to</label>
                      <input id="test-to" className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
                    </div>
                    <button type="button" className="btn btn--primary" disabled={busy || !to} onClick={() => run(() => api.post<EmailMessageDto>('/api/admin/email/test', { to }), (m) => setMsg(m.status === 'SENT' ? { tone: 'ok', text: `Sent to ${m.to}. Check the inbox (and spam folder).` } : { tone: 'warn', text: `Not sent yet: ${m.lastError ?? 'queued'}` }))}>Send test</button>
                  </div>
                </div>
              </section>
            )}
            <section className="panel" aria-labelledby="out-h">
              <div className="panel__header"><h2 id="out-h">Recent emails</h2></div>
              {d.messages.length === 0 ? <EmptyState title="No emails yet." /> : (
                <table className="table table--stack">
                  <thead><tr><th scope="col">Queued</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                  <tbody>
                    {d.messages.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Queued" className="nowrap">{dateTime(m.createdAt, tz)}</td>
                        <td data-label="To">{m.to}</td>
                        <td data-label="Subject" className="table__head-cell">{m.bookingId ? <Link to={`/admin/bookings/${m.bookingId}`}>{m.subject}</Link> : m.subject}{m.lastError && <div className="table__sub">{m.attempts} attempt(s): {m.lastError}</div>}</td>
                        <td data-label="Status"><Badge tone={m.status === 'SENT' ? 'ok' : m.status === 'FAILED' ? 'bad' : 'warn'} plain>{m.status.toLowerCase()}</Badge></td>
                        <td data-label="">{m.status !== 'SENT' && <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(() => api.post(`/api/admin/email/${m.id}/retry`), () => setMsg({ tone: 'ok', text: 'Retried.' }))}>Retry now</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </Async>
    </>
  );
}

export function StaffPage() {
  const tz = useTz();
  const { me } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => api.get<StaffUserDto[]>('/api/admin/staff') });
  const form = useForm({ name: '', email: '', role: 'STAFF' });
  const [invite, setInvite] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInvite(null);
    const input = form.validate(staffCreateSchema);
    if (!input) return;
    const res = await form.submit(() => api.post<{ inviteLink: string }>('/api/admin/staff', input));
    if (res) {
      setInvite(res.inviteLink);
      form.setValues({ name: '', email: '', role: 'STAFF' });
      void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    }
  }
  async function update(u: StaffUserDto, patch: Partial<{ role: string; disabled: boolean }>) {
    setMsg(null);
    try {
      await api.put(`/api/admin/staff/${u.id}`, { role: patch.role ?? u.role, disabled: patch.disabled ?? u.disabled });
      void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <>
      <PageHeader title="Staff accounts" meta="Admins manage settings, pricing and staff. Staff handle bookings, customers and payments." />
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="panel">
        <Async query={query}>
          {(list) => (
            <table className="table table--stack">
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td className="table__head-cell" data-label="Name">{u.name}{u.id === me?.user.id && <span className="muted small"> (you)</span>}</td>
                    <td data-label="Email">{u.email}</td>
                    <td data-label="Role">
                      <select className="select" aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === me?.user.id} onChange={(e) => update(u, { role: e.target.value })}>
                        <option value="ADMIN">Admin</option><option value="STAFF">Staff</option>
                      </select>
                    </td>
                    <td data-label="Status">
                      {u.disabled ? <Badge>Disabled</Badge> : !u.hasPassword ? <Badge tone="warn">Invited</Badge> : <Badge tone="ok">Active</Badge>}{' '}
                      {u.id !== me?.user.id && <button type="button" className="btn btn--small" onClick={() => update(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                    </td>
                    <td data-label="Last sign-in">{dateTime(u.lastLoginAt, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
      </div>
      <section className="panel" aria-labelledby="inv-h">
        <div className="panel__header"><h2 id="inv-h">Invite a staff member</h2><p>They choose their own password from a single-use link (valid 7 days).</p></div>
        <div className="panel__body">
          {invite && (
            <Notice tone="ok">
              Invitation emailed. If email isn't set up yet, give them this link in person (shown once):
              <div className="copy-field" style={{ marginTop: 6 }}><input className="input" readOnly value={invite} onFocus={(e) => e.target.select()} aria-label="Invitation link" /></div>
            </Notice>
          )}
          <form className="form" onSubmit={onInvite} noValidate>
            <FormError message={form.formError} />
            <div className="field-row">
              <TextField label="Name" {...form.field('name')} />
              <TextField label="Email" type="email" {...form.field('email')} />
            </div>
            <SelectField label="Role" options={[{ value: 'STAFF', label: 'Staff' }, { value: 'ADMIN', label: 'Admin' }]} {...form.field('role')} />
            <button type="submit" className="btn btn--primary" disabled={form.submitting}>Send invitation</button>
          </form>
        </div>
      </section>
    </>
  );
}

export function AuditPage() {
  const tz = useTz();
  const query = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.get<AuditEntryDto[]>('/api/admin/audit') });
  return (
    <>
      <PageHeader title="Activity log" meta="Administrative and security events (latest 300)." />
      <div className="panel">
        <Async query={query}>
          {(list) => list.length === 0 ? <EmptyState title="Nothing logged yet." /> : (
            <table className="table table--stack">
              <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">By</th><th scope="col">Target</th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Time" className="nowrap">{dateTime(a.createdAt, tz)}</td>
                    <td data-label="Event" className="table__head-cell mono small">{a.action}</td>
                    <td data-label="By">{a.actor ?? <span className="muted">System / customer</span>}</td>
                    <td data-label="Target">{a.targetType === 'booking' && a.targetId ? <Link to={`/admin/bookings/${a.targetId}`}>Booking</Link> : a.targetType ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
      </div>
    </>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  const form = useForm({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState<string | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const input = form.validate(changePasswordSchema);
    if (!input) return;
    const r = await form.submit(() => api.post<{ message: string }>('/api/auth/change-password', input));
    if (r) {
      setDone(r.message);
      form.setValues({ currentPassword: '', newPassword: '' });
    }
  }
  return (
    <>
      <PageHeader title="My account" meta={`${me?.user.name} · ${me?.user.email}`} />
      <section className="panel" aria-labelledby="pw-h">
        <div className="panel__header"><h2 id="pw-h">Change password</h2></div>
        <div className="panel__body">
          <form className="form" onSubmit={onSubmit} noValidate>
            {done && <Notice tone="ok">{done}</Notice>}
            <FormError message={form.formError} />
            <TextField label="Current password" type="password" autoComplete="current-password" {...form.field('currentPassword')} />
            <TextField label="New password" type="password" autoComplete="new-password" hint="At least 12 characters." {...form.field('newPassword')} />
            <button type="submit" className="btn btn--primary" disabled={form.submitting}>Change password</button>
          </form>
        </div>
      </section>
    </>
  );
}
