import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { BlockView } from '../../site/blocks';
import { SiteShell } from '../../site/SiteShell';
import { ClassicLayout } from './ClassicLayout';
import { ClassicHomePage } from './ClassicHome';
import { AboutPage, ClassicPolicyPage, GalleryPage, RoomsPage } from './ClassicPages';
import { usePublicConfig, usePublicSite } from './queries';
import { PolicyPage } from './SitePages';

export { usePublicConfig, usePublicSite } from './queries';

const ModeContext = createContext<'classic' | 'builder'>('classic');

/**
 * The public website. Either the install's original custom-built site (kept exactly as it was
 * designed) or, once the studio publishes from Admin › Website, the website builder's site.
 */
export function PublicLayout() {
  const { data: cfg } = usePublicConfig();
  const site = usePublicSite();
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  if (!site.data) return site.isError ? <ModeContext.Provider value="classic"><ClassicLayout /></ModeContext.Provider> : <div className="site-loading" aria-busy="true" />;
  if (site.data.mode === 'classic') {
    return (
      <ModeContext.Provider value="classic">
        <ClassicLayout />
      </ModeContext.Provider>
    );
  }
  if (!cfg) return <div className="site-loading" aria-busy="true" />;
  return (
    <ModeContext.Provider value="builder">
      <SiteShell doc={site.data.doc} cfg={cfg}>
        <Outlet />
      </SiteShell>
    </ModeContext.Provider>
  );
}

/** Booking pages keep their own layout; on a builder site they sit in a centred column. */
export function Contained({ children }: { children: ReactNode }) {
  return useContext(ModeContext) === 'builder' ? <div className="sb-contained">{children}</div> : <>{children}</>;
}

function NotFoundNotice() {
  return (
    <Contained>
      <div className="pub-notice">
        <h1 className="site-title" style={{ fontSize: '1.6rem' }}>Page not found</h1>
        <Link to="/">Go to the home page</Link>
      </div>
    </Contained>
  );
}

/** The home page: the original design, or the builder's home page. */
export function HomeRoute() {
  return useContext(ModeContext) === 'classic' ? <ClassicHomePage /> : <BuilderPage slug="" />;
}

/** Any other page address. */
export function SlugRoute() {
  const { slug = '' } = useParams();
  const mode = useContext(ModeContext);
  if (mode === 'classic') {
    if (slug === 'about') return <AboutPage />;
    if (slug === 'rooms') return <RoomsPage />;
    if (slug === 'gallery') return <GalleryPage />;
    return <NotFoundNotice />;
  }
  return <BuilderPage slug={slug} />;
}

export function PolicyRoute({ kind }: { kind: 'terms' | 'refunds' | 'privacy' }) {
  return useContext(ModeContext) === 'classic' ? <ClassicPolicyPage kind={kind} /> : <PolicyPage kind={kind} />;
}

export function NotFoundRoute() {
  return <NotFoundNotice />;
}

function BuilderPage({ slug }: { slug: string }) {
  const { data: cfg } = usePublicConfig();
  const { data: site } = usePublicSite();
  const doc = site?.mode === 'builder' ? site.doc : null;
  const page = doc?.pages.find((p) => p.slug === slug);
  useDocumentTitle(cfg ? (page ? `${page.seoTitle || page.title} | ${cfg.businessName}` : `Page not found | ${cfg.businessName}`) : undefined);
  useEffect(() => {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', page?.seoDescription ?? '');
  }, [page]);
  if (!cfg || !doc) return null;
  if (!page) return <NotFoundNotice />;
  return (
    <>
      {page.blocks
        .filter((b) => !b.style.hidden)
        .map((b, i) => (
          <BlockView key={b.id} block={b} cfg={cfg} first={i === 0} />
        ))}
    </>
  );
}
