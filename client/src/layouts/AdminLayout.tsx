import type { Permission } from '@habitat/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Loading } from '../components/States';
import { useAuth } from '../hooks/useAuth';
import { usePublicConfig } from '../pages/public/PublicLayout';

const NAV: { section: string; items: { to: string; label: string; perm: Permission; end?: boolean }[] }[] = [
  {
    section: 'Day to day',
    items: [
      { to: '/admin', label: 'Dashboard', perm: 'dashboard:read', end: true },
      { to: '/admin/calendar', label: 'Calendar', perm: 'bookings:read' },
      { to: '/admin/bookings', label: 'Bookings', perm: 'bookings:read', end: true },
      { to: '/admin/bookings/new', label: 'New booking', perm: 'bookings:write' },
      { to: '/admin/customers', label: 'Customers', perm: 'customers:read' },
      { to: '/admin/payments', label: 'Payments', perm: 'payments:read' },
    ],
  },
  {
    section: 'Studio setup',
    items: [
      { to: '/admin/website', label: 'Website', perm: 'website:write' },
      { to: '/admin/rooms', label: 'Rooms & pricing', perm: 'rooms:write' },
      { to: '/admin/promo-codes', label: 'Promo codes', perm: 'rooms:write' },
      { to: '/admin/equipment', label: 'Equipment', perm: 'equipment:write' },
      { to: '/admin/hours', label: 'Opening hours & closures', perm: 'hours:write' },
      { to: '/admin/settings', label: 'Settings', perm: 'settings:write' },
    ],
  },
  {
    section: 'System',
    items: [
      { to: '/admin/email', label: 'Email', perm: 'system:read' },
      { to: '/admin/health', label: 'System health', perm: 'system:read' },
      { to: '/admin/staff', label: 'Staff accounts', perm: 'staff:manage' },
      { to: '/admin/audit', label: 'Activity log', perm: 'audit:read' },
      { to: '/admin/account', label: 'My account', perm: 'dashboard:read' },
    ],
  },
];

function Links() {
  const { can } = useAuth();
  return (
    <>
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.section}>
            <div className="sidebar__section">{g.section}</div>
            <ul>
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.end} className="nav-link">{i.label}</NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** Admin shell (ApexBook design system). Guards are for navigation only; the API enforces access. */
export function AdminLayout() {
  const { me, loading, logout } = useAuth();
  const { data: cfg } = usePublicConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    setOpen(false);
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => document.getElementById('page-title')?.focus(), 0);
    return () => clearTimeout(t);
  }, [location.pathname]);

  if (loading) return <Loading label="Loading…" />;
  if (!me) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  const signOut = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };
  const footer = (
    <div className="sidebar__footer">
      <div className="sidebar__user">{me.user.name}</div>
      <div className="sidebar__email">{me.user.email} · {me.user.role === 'ADMIN' ? 'Admin' : 'Staff'}</div>
      <button type="button" className="btn btn--nav btn--small" onClick={signOut}>Sign out</button>
    </div>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Admin navigation">
        <Link to="/admin" className="sidebar__brand">{cfg?.businessName ?? 'Booking admin'}</Link>
        <div className="sidebar__org">Booking admin</div>
        <nav className="sidebar__nav" aria-label="Admin"><Links /></nav>
        {footer}
      </aside>
      <div className="main">
        <header className="topbar">
          <Link to="/admin" className="sidebar__brand">{cfg?.businessName ?? 'Admin'}</Link>
          <button type="button" className="topbar__toggle" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Menu'}
          </button>
        </header>
        {open && (
          <div className="mobile-nav" id="mobile-nav">
            <nav className="sidebar__nav" aria-label="Admin"><Links /></nav>
            {footer}
          </div>
        )}
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
