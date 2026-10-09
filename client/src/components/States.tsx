import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const forbidden = error instanceof ApiError && error.status === 403;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong while loading this page.';
  return (
    <div className="notice notice--error" role="alert">
      <div>
        <strong>{notFound ? 'Not found' : forbidden ? 'Access denied' : 'Could not load'}</strong>
        <div>{notFound ? 'This record does not exist or you do not have access to it.' : message}</div>
        {onRetry && !notFound && !forbidden && (
          <button type="button" className="link-button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  role,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'error';
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`notice${tone === 'info' ? '' : ` notice--${tone}`}`} role={role}>
      <div>{children}</div>
    </div>
  );
}

/** Render a query's loading/error states, then its data. */
export function Async<T>({
  query,
  children,
  loadingLabel,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <Loading label={loadingLabel} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}
