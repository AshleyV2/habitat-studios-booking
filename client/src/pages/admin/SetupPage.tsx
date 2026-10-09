import { setupSchema, type MeResponse } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '../../api/client';
import { FormError, SelectField, TextField } from '../../components/Field';
import { Notice } from '../../components/States';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useForm } from '../../hooks/useForm';

export const useSetupStatus = () =>
  useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<{ required: boolean; businessName?: string; timezone?: string }>('/api/auth/setup'), staleTime: 30_000 });

/** While a fresh installation has no administrator, every page goes to the setup page. */
export function SetupGate({ children }: { children: ReactNode }) {
  const { data } = useSetupStatus();
  const { pathname, search } = useLocation();
  if (data?.required && pathname !== '/setup') return <Navigate to={`/setup${search}`} replace />;
  return <>{children}</>;
}

const TIMEZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
const businessStep = setupSchema.pick({ token: true, businessName: true, timezone: true, contactEmail: true, contactPhone: true });
const accountStep = setupSchema
  .pick({ adminName: true, adminEmail: true, password: true })
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function SetupPage() {
  useDocumentTitle('Set up your booking system');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setMe } = useAuth();
  const status = useSetupStatus();
  const [step, setStep] = useState<1 | 2>(1);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = useForm({
    token: params.get('token') ?? '',
    businessName: '',
    timezone: TIMEZONES.includes(browserTz) ? browserTz : 'Europe/London',
    contactEmail: '',
    contactPhone: '',
    adminName: '',
    adminEmail: '',
    password: '',
    confirm: '',
  });
  const hasLinkToken = Boolean(params.get('token'));
  // Fill in the defaults the instance was created with, once they arrive.
  const defaults = status.data;
  const [prefilled, setPrefilled] = useState(false);
  if (defaults?.required && !prefilled) {
    setPrefilled(true);
    form.setValues((v) => ({
      ...v,
      businessName: v.businessName || defaults.businessName || '',
      timezone: defaults.timezone && TIMEZONES.includes(defaults.timezone) ? defaults.timezone : v.timezone,
    }));
  }

  if (status.data && !status.data.required) {
    return (
      <Shell title="Already set up">
        <p>This booking system has been set up.</p>
        <Link to="/admin/login" className="btn btn--primary btn--block">Sign in</Link>
      </Shell>
    );
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (form.validate(businessStep)) {
      form.setFormError(null);
      setStep(2);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (!form.validate(accountStep)) return;
    const input = form.validate(setupSchema);
    if (!input) {
      setStep(1);
      return;
    }
    const me = await form.submit(() => api.post<MeResponse>('/api/auth/setup', input));
    if (me) {
      setMe(me);
      queryClient.setQueryData(['setup-status'], { required: false });
      await queryClient.invalidateQueries({ queryKey: ['public-config'] });
      navigate('/admin?welcome=1', { replace: true });
    } else if (form.errors.token) {
      setStep(1);
    }
  }

  return (
    <Shell title={step === 1 ? 'Your business' : 'Your administrator account'} step={step}>
      <FormError message={form.formError} />
      {step === 1 ? (
        <form onSubmit={next} noValidate>
          <p className="muted">Welcome! A couple of details and your booking system is ready to configure.</p>
          {!hasLinkToken && <TextField label="Setup code" hint="From the setup link you were sent" autoComplete="off" {...form.field('token')} />}
          {hasLinkToken && form.errors.token && <Notice tone="error">{form.errors.token}</Notice>}
          <TextField label="Business name" hint="Shown on your booking site and emails" autoFocus {...form.field('businessName')} />
          <SelectField label="Timezone" options={TIMEZONES.map((t) => ({ value: t, label: t.replace('_', ' ') }))} {...form.field('timezone')} />
          <TextField label="Contact email for customers" type="email" optional {...form.field('contactEmail')} />
          <TextField label="Contact phone" type="tel" optional {...form.field('contactPhone')} />
          <button type="submit" className="btn btn--primary btn--block">Next</button>
        </form>
      ) : (
        <form onSubmit={finish} noValidate>
          <p className="muted">This is the account you'll sign in with to run {form.values.businessName || 'the business'}. You can add staff later.</p>
          <TextField label="Your name" autoComplete="name" autoFocus {...form.field('adminName')} />
          <TextField label="Email" type="email" autoComplete="username" {...form.field('adminEmail')} />
          <TextField label="Password" type="password" autoComplete="new-password" hint="At least 12 characters" {...form.field('password')} />
          <TextField label="Confirm password" type="password" autoComplete="new-password" {...form.field('confirm')} />
          <button type="submit" className="btn btn--primary btn--block" disabled={form.submitting}>{form.submitting ? 'Setting up…' : 'Finish setup'}</button>
          <button type="button" className="btn btn--ghost btn--block" style={{ marginTop: 8 }} onClick={() => setStep(1)}>Back</button>
        </form>
      )}
    </Shell>
  );
}

function Shell({ title, step, children }: { title: string; step?: 1 | 2; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__box">
        <div className="auth__brand">Booking system setup</div>
        <p className="auth__tagline">{step ? `Step ${step} of 2` : ' '}</p>
        <div className="auth__panel">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
