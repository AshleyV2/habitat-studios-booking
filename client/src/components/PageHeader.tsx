import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  meta,
  actions,
  crumbs,
  documentTitle,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Tab title; defaults to `title` when it is a string. */
  documentTitle?: string;
}) {
  const t = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useDocumentTitle(t ? `${t} · Admin` : undefined);
  return (
    <div className="page-header">
      <div>
        {crumbs && crumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((c) => (
                <li key={c.label}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
        )}
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {meta && <div className="page-header__meta">{meta}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
