import { DAY_NAMES, type PublicConfig, type SiteDoc } from '@habitat/shared';
import { useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { imageUrl, SiteLink, SiteNavContext } from './links';
import { RichText } from './richtext';
import { themeClass, themeStyle } from './theme';

const closeLabel = (t: string) => (t === '24:00' ? 'midnight' : t);

const SOCIAL_LABELS: Record<keyof SiteDoc['social'], string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', x: 'X' };

/** Header, menu, footer and theme around a page. Used by the live site and the builder canvas. */
export function SiteShell({ doc, cfg, currentPath, children }: { doc: SiteDoc; cfg: PublicConfig; currentPath?: string; children: ReactNode }) {
  const { editor } = useContext(SiteNavContext);
  const location = useLocation();
  const path = currentPath ?? location.pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const h = doc.header;
  const logo = imageUrl(h.logo?.src);
  const nav = doc.pages.filter((p) => p.showInNav).map((p) => ({ label: p.navLabel || p.title, link: `/${p.slug}` }));
  const links = [...nav, ...h.extraLinks];
  const social = (Object.keys(SOCIAL_LABELS) as (keyof SiteDoc['social'])[]).filter((k) => doc.social[k]);
  const tel = cfg.contactPhone?.replace(/\s/g, '');
  const isCurrent = (link: string) => link === path || (link !== '/' && path.startsWith(`${link}/`));

  return (
    <div className={themeClass(doc.theme)} style={themeStyle(doc.theme)}>
      {!editor && <a className="skip-link" href="#content">Skip to content</a>}
      {h.announcement && (
        <div className="sb-announcement" role="status">
          {h.announcementLink ? <SiteLink to={h.announcementLink}>{h.announcement}</SiteLink> : h.announcement}
        </div>
      )}
      <header className={`sb-header sb-header--${h.layout}${h.sticky ? ' sb-header--sticky' : ''}`}>
        <div className="sb-header__inner">
          <SiteLink to="/" className="sb-brand" ariaLabel={`${cfg.businessName} home`}>
            {logo && <img src={logo} alt={h.showName ? '' : cfg.businessName} style={{ height: h.logoHeight }} />}
            {(h.showName || !logo) && <span>{cfg.businessName}</span>}
          </SiteLink>
          <button type="button" className="sb-menu-btn" aria-expanded={menuOpen} aria-controls="sb-nav" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <nav id="sb-nav" className={`sb-nav${menuOpen ? ' sb-nav--open' : ''}`} aria-label="Site">
            {links.map((l, i) => (
              <SiteLink key={`${l.link}-${i}`} to={l.link} className={isCurrent(l.link) ? 'is-current' : undefined}>
                {l.label}
              </SiteLink>
            ))}
            {h.showBookButton && (
              <SiteLink to="/book" className="sb-btn sb-btn--primary sb-nav__book">
                {h.bookLabel}
              </SiteLink>
            )}
          </nav>
        </div>
      </header>
      <main id="content" className="sb-main">
        {children}
      </main>
      <footer className="sb-footer" id="footer">
        <div className="sb-footer__inner">
          <div>
            <h2>{cfg.businessName}</h2>
            <RichText text={doc.footer.text} />
            {doc.footer.showContact && cfg.address && <p style={{ whiteSpace: 'pre-line' }}>{cfg.address}</p>}
          </div>
          {doc.footer.showContact && (cfg.contactEmail || cfg.contactPhone || (doc.footer.showSocial && social.length > 0)) && (
            <div>
              <h2>Contact</h2>
              <ul>
                {cfg.contactEmail && <li><SiteLink to={`mailto:${cfg.contactEmail}`}>{cfg.contactEmail}</SiteLink></li>}
                {cfg.contactPhone && <li><SiteLink to={`tel:${tel}`}>{cfg.contactPhone}</SiteLink></li>}
                {doc.footer.showSocial && social.map((k) => <li key={k}><SiteLink to={doc.social[k]}>{SOCIAL_LABELS[k]} ↗</SiteLink></li>)}
              </ul>
            </div>
          )}
          {doc.footer.showHours && cfg.openingHours.some((x) => x.isOpen) && (
            <div>
              <h2>Opening hours</h2>
              <table className="sb-footer__hours">
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const oh = cfg.openingHours.find((x) => x.dayOfWeek === d);
                    return (
                      <tr key={d}>
                        <td>{DAY_NAMES[d]!.slice(0, 3)}</td>
                        <td>{oh?.isOpen ? `${oh.openTime}–${closeLabel(oh.closeTime)}` : 'Closed'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {doc.footer.showLinks && (
            <div>
              <h2>Info</h2>
              <ul>
                <li><SiteLink to="/book">Book a room</SiteLink></li>
                {cfg.bookingTerms && <li><SiteLink to="/terms">Terms &amp; conditions</SiteLink></li>}
                {cfg.cancellationPolicy && <li><SiteLink to="/refunds">Refund policy</SiteLink></li>}
                {cfg.privacyPolicy && <li><SiteLink to="/privacy">Privacy policy</SiteLink></li>}
              </ul>
            </div>
          )}
        </div>
        <div className="sb-footer__legal">© {new Date().getFullYear()} {cfg.businessName}</div>
      </footer>
    </div>
  );
}
