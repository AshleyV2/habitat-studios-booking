import { loginSchema, passwordSchema, type MeResponse } from '@habitat/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '../../api/client';
import { FormError, TextField } from '../../components/Field';
import { Notice } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useForm } from '../../hooks/useForm';
import { usePublicConfig } from '../public/PublicLayout';

function Frame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(`${title} · Admin`);
  const { data: cfg } = usePublicConfig();
  return (
    <main className="auth">
      <div className="auth__box">
        <div className="auth__brand">{cfg?.businessName ?? 'Booking'} admin</div>
        <p className="auth__tagline">Staff sign-in. Customers book at the <Link to="/">booking page</Link>.</p>
        <div className="auth__panel">
          <h1>{title}</h1>
          {children}
        </div>
        {footer && <div className="auth__footer">{footer}</div>}
      </div>
    </main>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/admin') && !n.startsWith('//') ? n : '/admin');

export function AdminLoginPage() {
  const { setMe, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm({ email: '', password: '' });
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = form.validate(loginSchema);
    if (!input) return;
    const me = await form.submit(() => api.post<MeResponse>('/api/auth/login', input));
    if (me) {
      setMe(me);
      navigate(safeNext(params.get('next')), { replace: true });
    }
  }
  return (
    <Frame title="Sign in" footer={<Link to="/admin/forgot-password">Forgotten your password?</Link>}>
      {sessionExpired && <Notice tone="warn">Your session ended. Please sign in again.</Notice>}
      {params.get('notice') === 'password' && <Notice tone="ok">Password saved. Sign in with your new password.</Notice>}
      <FormError message={form.formError} />
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Email" type="email" autoComplete="username" autoFocus {...form.field('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" {...form.field('password')} />
        <button type="submit" className="btn btn--primary btn--block" disabled={form.submitting}>{form.submitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Frame>
  );
}

export function AdminForgotPage() {
  const form = useForm({ email: '' });
  const [done, setDone] = useState<string | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = form.validate(z.object({ email: z.string().email('Enter a valid email') }));
    if (!input) return;
    const r = await form.submit(() => api.post<{ message: string }>('/api/auth/forgot-password', input));
    if (r) setDone(r.message);
  }
  return (
    <Frame title="Reset password" footer={<Link to="/admin/login">Back to sign in</Link>}>
      {done ? (
        <Notice tone="ok">{done}</Notice>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FormError message={form.formError} />
          <TextField label="Email" type="email" autoComplete="username" {...form.field('email')} />
          <button type="submit" className="btn btn--primary btn--block" disabled={form.submitting}>Send reset link</button>
        </form>
      )}
    </Frame>
  );
}

const resetSchema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function AdminResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const invite = params.get('invite') === '1';
  const form = useForm({ password: '', confirm: '' });
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = form.validate(resetSchema);
    if (!input) return;
    if (await form.submit(() => api.post('/api/auth/reset-password', { token, password: input.password }))) navigate('/admin/login?notice=password', { replace: true });
  }
  return (
    <Frame title={invite ? 'Set up your account' : 'Choose a new password'}>
      <FormError message={form.formError} />
      <form onSubmit={onSubmit} noValidate>
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 12 characters." {...form.field('password')} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" {...form.field('confirm')} />
        <button type="submit" className="btn btn--primary btn--block" disabled={form.submitting || !token}>Save password</button>
      </form>
    </Frame>
  );
}
