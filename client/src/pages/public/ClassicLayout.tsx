import { DAY_NAMES } from '@habitat/shared';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { usePublicConfig } from './queries';

const closeLabel = (t: string) => (t === '24:00' ? 'midnight' : t);

/**
 * The original studio's custom-built website shell (kept exactly as designed). Used while the
 * install's original site is live; see PublicLayout.
 */
export function ClassicLayout() {
  const { data: cfg } = usePublicConfig();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  const name = cfg?.businessName ?? 'Book a room';
  const tel = cfg?.contactPhone?.replace(/\s/g, '');

  return (
    <div className="site">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="site-brand">{name}</Link>
          <button type="button" className="site-menu-btn" aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <nav id="site-nav" className={`site-nav${menuOpen ? ' site-nav--open' : ''}`} aria-label="Site">
            <NavLink to="/" end>Home</NavLink>
            {cfg?.aboutText && <NavLink to="/about">About</NavLink>}
            <NavLink to="/rooms">Our rooms</NavLink>
            <NavLink to="/gallery">Gallery</NavLink>
            <a href="#contact">Contact</a>
            <NavLink to="/book" className="site-nav__book">Book now</NavLink>
          </nav>
        </div>
      </header>
      <main id="content" className="site-main">
        <Outlet />
      </main>
      {cfg && (
        <footer className="site-footer" id="contact">
          <div className="site-footer__inner" style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div>
              <h2>{cfg.businessName}</h2>
              {cfg.address && <p style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{cfg.address}</p>}
              {cfg.address && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.address.replace(/\n/g, ', '))}`} target="_blank" rel="noopener noreferrer">
                  Directions ↗
                </a>
              )}
            </div>
            <div>
              <h2>Contact</h2>
              <ul>
                {cfg.contactEmail && <li><a href={`mailto:${cfg.contactEmail}`}>{cfg.contactEmail}</a></li>}
                {cfg.contactPhone && <li><a href={`tel:${tel}`}>{cfg.contactPhone}</a></li>}
                {cfg.instagramUrl && <li><a href={cfg.instagramUrl} target="_blank" rel="noopener noreferrer">Instagram ↗</a></li>}
                {cfg.facebookUrl && <li><a href={cfg.facebookUrl} target="_blank" rel="noopener noreferrer">Facebook ↗</a></li>}
              </ul>
            </div>
            {cfg.openingHours.some((h) => h.isOpen) && (
              <div>
                <h2>Opening hours</h2>
                <table className="hours-table">
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const h = cfg.openingHours.find((x) => x.dayOfWeek === d)!;
                      return (
                        <tr key={d}>
                          <td>{DAY_NAMES[d]!.slice(0, 3)}</td>
                          <td>{h.isOpen ? `${h.openTime}–${closeLabel(h.closeTime)}` : 'Closed'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <h2>Info</h2>
              <ul>
                <li><Link to="/book">Book a room</Link></li>
                {cfg.bookingTerms && <li><Link to="/terms">Terms &amp; conditions</Link></li>}
                {cfg.cancellationPolicy && <li><Link to="/refunds">Refund policy</Link></li>}
                {cfg.privacyPolicy && <li><Link to="/privacy">Privacy policy</Link></li>}
              </ul>
            </div>
          </div>
          <div className="site-footer__legal">© {new Date().getFullYear()} {cfg.businessName}</div>
        </footer>
      )}
    </div>
  );
}
