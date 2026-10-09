import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BASE_PATH } from '../lib/base';

/**
 * In the builder, links must not navigate away from the editor. The builder provides an
 * `onNavigate` that switches the page being edited instead (or does nothing).
 */
export const SiteNavContext = createContext<{ editor: boolean; onNavigate?: (path: string) => void }>({ editor: false });

export function SiteLink({ to, className, children, style, ariaLabel }: { to: string; className?: string; children: ReactNode; style?: CSSProperties; ariaLabel?: string }) {
  const { editor, onNavigate } = useContext(SiteNavContext);
  if (!to) return <span className={className} style={style}>{children}</span>;
  const external = /^(https?:|mailto:|tel:)/i.test(to);
  if (editor) {
    return (
      <a
        href={external ? to : `${BASE_PATH}${to}`}
        className={className}
        style={style}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault();
          if (!external && to.startsWith('/')) onNavigate?.(to);
        }}
      >
        {children}
      </a>
    );
  }
  if (external) {
    const newTab = /^https?:/i.test(to);
    return (
      <a href={to} className={className} style={style} aria-label={ariaLabel} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  }
  if (to.startsWith('#')) return <a href={to} className={className} style={style} aria-label={ariaLabel}>{children}</a>;
  return <Link to={to} className={className} style={style} aria-label={ariaLabel}>{children}</Link>;
}

/** URL for a website image: an uploaded one, or one shipped with the app. */
export function imageUrl(src: string | undefined | null): string | null {
  if (!src) return null;
  if (src.startsWith('asset:')) return `${BASE_PATH}/api/public/site/assets/${encodeURIComponent(src.slice(6))}`;
  if (/^site\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(src)) return `${BASE_PATH}/${src}`;
  return null;
}
