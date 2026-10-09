import { DAY_NAMES } from '@habitat/shared';
import { Link } from 'react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { money, planSummary, roomFromPrice } from '../../lib/format';
import { usePublicRooms } from './ClassicHome';
import { usePublicConfig } from './queries';
import { SITE_IMAGES } from './site-images';

const closeLabel = (t: string) => (t === '24:00' ? 'midnight' : t);

function Missing() {
  return (
    <div className="pub-notice">
      This page hasn't been written yet. <Link to="/">Back to the home page</Link>
    </div>
  );
}

export function AboutPage() {
  const { data: cfg } = usePublicConfig();
  useDocumentTitle(cfg ? `About | ${cfg.businessName}` : 'About');
  if (!cfg) return null;
  if (!cfg.aboutText) return <Missing />;
  return (
    <>
      <section className="hero band-dark bleed">
        <p className="eyebrow">About</p>
        <h1 className="hero__title">Our story</h1>
      </section>
      <section className="split split--photo" style={{ alignItems: 'start' }}>
        <img className="photo split__img" src={SITE_IMAGES.about} alt={`${cfg.businessName}`} loading="lazy" />
        <div>
          <p className="prose page-lede">{cfg.aboutText}</p>
          <Link to="/book" className="pub-btn" style={{ marginTop: 28 }}>Book a room</Link>
        </div>
      </section>
    </>
  );
}

/** Our rooms: the studio's intro, the communal area, then every bookable room from the database. */
export function RoomsPage() {
  const { data: cfg } = usePublicConfig();
  const rooms = usePublicRooms();
  useDocumentTitle(cfg ? `Our Rooms | ${cfg.businessName}` : 'Our Rooms');
  if (!cfg) return null;
  return (
    <>
      <section className="hero band-dark bleed">
        <p className="eyebrow">Our spaces</p>
        <h1 className="hero__title">Our rooms</h1>
        {cfg.roomsIntro && <p className="prose" style={{ color: '#d6d6d6', maxWidth: '68ch' }}>{cfg.roomsIntro}</p>}
      </section>

      <section style={{ padding: '24px 0 40px' }} aria-label="Rehearsal rooms">
        {rooms.isPending ? (
          <p className="pub-muted">Loading rooms…</p>
        ) : !rooms.data?.length ? (
          <div className="pub-notice">There are no rooms open for online booking right now. <Link to="/contact">Get in touch</Link> and we will help you find a slot.</div>
        ) : (
          rooms.data.map((r, i) => {
            const from = roomFromPrice(r, cfg);
            return (
              <article key={r.id} className={`room-feature${r.imageUrl ? ' room-feature--photo' : ''}`} aria-labelledby={`room-${r.id}`}>
                {r.imageUrl ? (
                  <img className="photo room-feature__img" src={r.imageUrl} alt={r.name} loading="lazy" />
                ) : (
                  <div className="room-feature__num" aria-hidden>{String(i + 1).padStart(2, '0')}</div>
                )}
                <div>
                  <h3 id={`room-${r.id}`}>{r.name}</h3>
                  <ul className="room-feature__facts">
                    {r.capacity && <li>Up to {r.capacity} people</li>}
                    {r.ratePlans.map((p) => (
                      <li key={p.id}>
                        <strong>{p.name}</strong>: {planSummary(p, cfg.currency)}
                        {p.latestEndTime && ` (until ${p.latestEndTime})`}
                      </li>
                    ))}
                    {r.ratePlans.length === 0 &&
                      r.priceRules.map((p) => (
                        <li key={p.label}>{p.label}: {money(p.hourlyRatePence, cfg.currency)}/h ({p.daysOfWeek.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ')} {p.startTime}–{closeLabel(p.endTime)})</li>
                      ))}
                  </ul>
                  {r.description && <p className="prose">{r.description}</p>}
                  <div className="room-feature__price">
                    <span>from <strong>{money(from.pence, cfg.currency)}</strong> <span className="pub-muted">{from.unit}</span></span>
                    <Link to={`/book?room=${r.id}`} className="pub-btn">Book {r.name}</Link>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {cfg.communalText && (
        <section className="split split--photo band-dark bleed" aria-labelledby="communal-title">
          <img className="photo split__img" src={SITE_IMAGES.communal} alt="The communal area" loading="lazy" />
          <div>
            <h2 id="communal-title" className="big-heading" style={{ fontSize: 'clamp(1.8rem, 4.5vw, 2.8rem)' }}>Communal area</h2>
            <p className="prose">{cfg.communalText}</p>
          </div>
        </section>
      )}
    </>
  );
}

export function GalleryPage() {
  const { data: cfg } = usePublicConfig();
  useDocumentTitle(cfg ? `Gallery | ${cfg.businessName}` : 'Gallery');
  return (
    <>
      <section className="hero band-dark bleed">
        <p className="eyebrow">Gallery</p>
        <h1 className="hero__title">In the studio</h1>
      </section>
      <ul className="gallery" style={{ padding: '32px 0 48px' }}>
        {SITE_IMAGES.gallery.map((src) => (
          <li key={src}><img className="photo" src={src} alt="" loading="lazy" /></li>
        ))}
      </ul>
      {cfg?.instagramUrl && (
        <p style={{ textAlign: 'center', marginBottom: 40 }}>
          <a className="pub-btn pub-btn--quiet" href={cfg.instagramUrl} target="_blank" rel="noopener noreferrer">More on Instagram ↗</a>
        </p>
      )}
    </>
  );
}

export function ClassicPolicyPage({ kind }: { kind: 'terms' | 'refunds' | 'privacy' }) {
  const { data: cfg } = usePublicConfig();
  const title = { terms: 'Terms & Conditions', refunds: 'Refund Policy', privacy: 'Privacy Policy' }[kind];
  useDocumentTitle(cfg ? `${title} | ${cfg.businessName}` : title);
  if (!cfg) return null;
  const text = kind === 'terms' ? cfg.bookingTerms : kind === 'refunds' ? cfg.cancellationPolicy : cfg.privacyPolicy;
  if (!text) return <Missing />;
  return (
    <section className="policy" style={{ padding: '24px 0 40px' }}>
      <h1 className="big-heading">{title}</h1>
      <p className="prose">{text}</p>
    </section>
  );
}
