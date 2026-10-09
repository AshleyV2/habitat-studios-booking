import { EQUIPMENT_PRICING_LABELS, type PublicEquipment, type PublicRoom } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { dayOfWeek, money, roomFromPrice } from '../../lib/format';
import { usePublicConfig } from './queries';
import { SITE_IMAGES } from './site-images';

const closeLabel = (t: string) => (t === '24:00' ? 'midnight' : t);
const firstParagraph = (t: string) => t.split(/\n\s*\n/)[0] ?? t;

export const usePublicRooms = () => useQuery({ queryKey: ['public-rooms'], queryFn: () => api.get<PublicRoom[]>('/api/public/rooms') });

/**
 * Home page. All text is the studio's own, from Admin › Settings › Website; rooms,
 * prices, equipment and hours come from the booking data. Empty sections are hidden.
 */
export function ClassicHomePage() {
  const { data: cfg } = usePublicConfig();
  const rooms = usePublicRooms();
  const kit = useQuery({ queryKey: ['public-equipment-list'], queryFn: () => api.get<PublicEquipment[]>('/api/public/equipment-list') });
  useDocumentTitle(cfg ? `Home | ${cfg.businessName}` : 'Home');
  if (!cfg) return <p className="pub-muted">Loading…</p>;

  const today = cfg.openingHours.find((h) => h.dayOfWeek === dayOfWeek(cfg.today));

  return (
    <>
      <section className="hero hero--photo band-dark bleed" aria-labelledby="home-title">
        <img className="hero__bg" src={SITE_IMAGES.hero} alt="" />
        <div className="hero__content">
          {cfg.announcement && <div className="pub-notice pub-notice--warn" role="status" style={{ marginBottom: 28, color: '#111' }}>{cfg.announcement}</div>}
          <h1 id="home-title" className="hero__title">{cfg.homeHeadline ?? `Welcome to ${cfg.businessName}`}</h1>
          {cfg.tagline && <p className="hero__tagline">{cfg.tagline}</p>}
          {cfg.address && <p className="hero__place">{cfg.address.split('\n').join(', ')}</p>}
          <div className="home-actions">
            <Link to="/book" className="pub-btn pub-btn--light">Book now</Link>
            <Link to="/rooms" className="pub-btn pub-btn--quiet">Our rooms</Link>
          </div>
          <p className="hero__hours">
            {today?.isOpen ? `Open today ${today.openTime}–${closeLabel(today.closeTime)}` : 'Closed today'}
            {!cfg.onlineBooking.available && ` · ${cfg.onlineBooking.reason}`}
          </p>
        </div>
      </section>

      {cfg.homeIntro && (
        <section className="split" aria-labelledby="place-title">
          <h2 id="place-title" className="big-heading">The place to rehearse</h2>
          <div>
            <p className="prose page-lede">{cfg.homeIntro}</p>
            <Link to="/book" className="pub-btn" style={{ marginTop: 18 }}>Book now</Link>
          </div>
        </section>
      )}

      {cfg.aboutText && (
        <section className="split split--photo band-dark bleed" aria-labelledby="story-title">
          <img className="photo split__img" src={SITE_IMAGES.story} alt={`Inside ${cfg.businessName}`} loading="lazy" />
          <div>
            <p className="eyebrow">Get to know us</p>
            <h2 id="story-title" className="big-heading">Our story</h2>
            <p className="prose">{firstParagraph(cfg.aboutText)}</p>
            <Link to="/about" className="pub-btn pub-btn--quiet" style={{ marginTop: 18 }}>Read more</Link>
          </div>
        </section>
      )}

      {rooms.data && rooms.data.length > 0 && (
        <section style={{ padding: '56px 0 16px' }} aria-labelledby="rooms-title">
          <div className="home-section__head">
            <h2 id="rooms-title" className="big-heading">Our rooms</h2>
            <Link to="/rooms">All room details →</Link>
          </div>
          <ul className="room-cards">
            {rooms.data.map((r) => {
              const from = roomFromPrice(r, cfg);
              return (
                <li key={r.id} className="room-card">
                  {r.imageUrl && <img className="photo room-card__img" src={r.imageUrl} alt={r.name} loading="lazy" />}
                  <div className="room-card__body">
                    <h3>{r.name}</h3>
                    <p className="home-room__meta">
                      {r.capacity ? `Up to ${r.capacity} people · ` : ''}from {money(from.pence, cfg.currency)} {from.unit}
                    </p>
                    <Link to={`/book?room=${r.id}`} className="pub-btn pub-btn--quiet">Book {r.name}</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {kit.data && kit.data.length > 0 && (
        <section style={{ padding: '40px 0 16px' }} aria-labelledby="kit-title">
          <div className="home-section__head">
            <h2 id="kit-title" className="big-heading" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Equipment hire</h2>
            <span className="pub-muted">Add it when you book</span>
          </div>
          <table className="home-table">
            <tbody>
              {kit.data.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{e.name}{e.description && <span className="home-table__sub">{e.description}</span>}</th>
                  <td>{money(e.pricePence, cfg.currency)} {EQUIPMENT_PRICING_LABELS[e.pricing]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={{ padding: '48px 0 8px' }} aria-labelledby="clients-title">
        <h2 id="clients-title" className="big-heading" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Our clients</h2>
        <ul className="client-logos">
          {SITE_IMAGES.clients.map((c) => (
            <li key={c.src}><img src={c.src} alt={c.name} loading="lazy" /></li>
          ))}
        </ul>
      </section>

      {cfg.featuredQuote && (
        <figure className="quote band-dark bleed" style={{ marginTop: 48 }}>
          <p className="eyebrow">Clients</p>
          <blockquote>“{cfg.featuredQuote.replace(/^[“"]|[”"]$/g, '')}”</blockquote>
          {cfg.featuredQuoteAuthor && <figcaption>{cfg.featuredQuoteAuthor}</figcaption>}
        </figure>
      )}

      <section style={{ padding: '48px 0 8px' }} aria-labelledby="gallery-title">
        <div className="home-section__head">
          <h2 id="gallery-title" className="big-heading" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>Gallery</h2>
          <Link to="/gallery">See all →</Link>
        </div>
        <ul className="gallery gallery--strip">
          {SITE_IMAGES.gallery.slice(0, 4).map((src) => (
            <li key={src}><img className="photo" src={src} alt="" loading="lazy" /></li>
          ))}
        </ul>
      </section>

      <section className="home-cta" style={{ marginTop: 48 }} aria-label="Book now">
        <p>Ready to play?</p>
        <Link to="/book" className="pub-btn pub-btn--light">Book a room</Link>
      </section>
    </>
  );
}
