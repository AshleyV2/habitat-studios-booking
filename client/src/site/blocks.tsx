import { DAY_NAMES, EQUIPMENT_PRICING_LABELS, type PublicConfig, type PublicEquipment, type PublicRoom, type SiteBlock, type SiteImage } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { useContext, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api/client';
import { dayOfWeek, money, planSummary, roomFromPrice } from '../lib/format';
import { imageUrl, SiteLink, SiteNavContext } from './links';
import { Icon } from './icons';
import { InlineText, RichText } from './richtext';

// ---------------------------------------------------------------------------
// Live data used by some blocks
// ---------------------------------------------------------------------------

export const usePublicRooms = () => useQuery({ queryKey: ['public-rooms'], queryFn: () => api.get<PublicRoom[]>('/api/public/rooms'), staleTime: 60_000 });
const usePublicEquipment = () => useQuery({ queryKey: ['public-equipment-list'], queryFn: () => api.get<PublicEquipment[]>('/api/public/equipment-list'), staleTime: 60_000 });

const closeLabel = (t: string) => (t === '24:00' ? 'midnight' : t);

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? (v as P[]) : []);
const image = (v: unknown) => (v && typeof v === 'object' && 'src' in v ? (v as SiteImage) : null);

function Img({ img, className, sizes, eager }: { img: SiteImage | null; className?: string; sizes?: string; eager?: boolean }) {
  const url = imageUrl(img?.src);
  const { editor } = useContext(SiteNavContext);
  // Placeholders only show in the builder; visitors never see an empty frame.
  if (!url) return editor ? <div className={`sb-img-placeholder ${className ?? ''}`} aria-hidden>Choose an image</div> : null;
  return <img className={className} src={url} alt={img?.alt ?? ''} loading={eager ? 'eager' : 'lazy'} sizes={sizes} />;
}

function Buttons({ items }: { items: P[] }) {
  const buttons = items.filter((b) => str(b.label));
  if (!buttons.length) return null;
  return (
    <div className="sb-buttons">
      {buttons.map((b, i) => (
        <SiteLink key={i} to={str(b.link)} className={`sb-btn sb-btn--${str(b.style) || 'primary'}`}>
          {str(b.label)}
        </SiteLink>
      ))}
    </div>
  );
}

function Heading({ eyebrow, heading, level = 2, size }: { eyebrow?: string; heading?: string; level?: 1 | 2; size?: string }) {
  if (!eyebrow && !heading) return null;
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <>
      {eyebrow && <p className="sb-eyebrow">{eyebrow}</p>}
      {heading && <H className={`sb-heading sb-heading--${size ?? 'l'}`}><InlineText text={heading} /></H>}
    </>
  );
}

function OpeningHours({ cfg, highlightToday }: { cfg: PublicConfig; highlightToday?: boolean }) {
  const today = dayOfWeek(cfg.today);
  return (
    <table className="sb-hours">
      <tbody>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const h = cfg.openingHours.find((x) => x.dayOfWeek === d);
          return (
            <tr key={d} className={highlightToday && d === today ? 'is-today' : undefined}>
              <th scope="row">{DAY_NAMES[d]}</th>
              <td>{h?.isOpen ? `${h.openTime}–${closeLabel(h.closeTime)}` : 'Closed'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function videoEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

const mapEmbed = (address: string) => `https://www.google.com/maps?q=${encodeURIComponent(address.replace(/\n/g, ', '))}&output=embed`;

// ---------------------------------------------------------------------------
// Block contents
// ---------------------------------------------------------------------------

function BlockBody({ block, cfg, level }: { block: SiteBlock; cfg: PublicConfig; level: 1 | 2 }) {
  const p = block.props as P;
  switch (block.type) {
    case 'hero': {
      const today = cfg.openingHours.find((h) => h.dayOfWeek === dayOfWeek(cfg.today));
      return (
        <div className={`sb-hero sb-hero--${str(p.height) || 'l'}`}>
          <Heading eyebrow={str(p.eyebrow)} />
          <h1 className="sb-heading sb-heading--hero"><InlineText text={str(p.heading)} /></h1>
          <RichText text={str(p.text)} className="sb-lede" />
          <Buttons items={list(p.buttons)} />
          {p.showToday === true && (
            <p className="sb-hero__hours">
              {today?.isOpen ? `Open today ${today.openTime}–${closeLabel(today.closeTime)}` : 'Closed today'}
              {!cfg.onlineBooking.available && cfg.onlineBooking.reason ? ` · ${cfg.onlineBooking.reason}` : ''}
            </p>
          )}
        </div>
      );
    }
    case 'heading':
      return (
        <div>
          <Heading eyebrow={str(p.eyebrow)} heading={str(p.heading)} level={level} size={str(p.size)} />
          <RichText text={str(p.text)} className="sb-lede" />
        </div>
      );
    case 'text':
      return <RichText text={str(p.text)} className={`${p.columns === '2' ? 'sb-cols-2' : ''} ${p.large ? 'sb-lede' : ''}`} />;
    case 'buttons':
      return <Buttons items={list(p.buttons)} />;
    case 'spacer':
      return <div style={{ height: Number(p.size) || 48 }} aria-hidden />;
    case 'divider':
      return <hr className="sb-divider" />;
    case 'image': {
      const img = <Img img={image(p.image)} className={`sb-image sb-shape--${str(p.shape) || 'auto'}`} />;
      return (
        <figure className="sb-figure">
          {str(p.link) ? <SiteLink to={str(p.link)}>{img}</SiteLink> : img}
          {str(p.caption) && <figcaption>{str(p.caption)}</figcaption>}
        </figure>
      );
    }
    case 'imageText':
      return (
        <div className={`sb-split sb-split--${str(p.imageSide) === 'right' ? 'right' : 'left'}${image(p.image) ? '' : ' sb-split--noimg'}`}>
          <Img img={image(p.image)} className="sb-split__img" />
          <div className="sb-split__text">
            <Heading eyebrow={str(p.eyebrow)} heading={str(p.heading)} />
            <RichText text={str(p.text)} />
            <Buttons items={list(p.buttons)} />
          </div>
        </div>
      );
    case 'gallery': {
      const imgs = list(p.images);
      return (
        <div>
          <Heading heading={str(p.heading)} />
          {imgs.length === 0 ? (
            <p className="sb-empty">Add photos to this gallery.</p>
          ) : (
            <ul className={`sb-gallery sb-gallery--${str(p.layout) || 'grid'}`} style={{ '--sb-cols': Number(p.columns) || 3 } as CSSProperties}>
              {imgs.map((g, i) => (
                <li key={i}>
                  <figure>
                    <Img img={image(g.image)} />
                    {str(g.caption) && <figcaption>{str(g.caption)}</figcaption>}
                  </figure>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case 'video': {
      const src = videoEmbed(str(p.url));
      return (
        <div>
          <Heading heading={str(p.heading)} />
          {src ? (
            <div className="sb-video">
              <iframe src={src} title={str(p.caption) || str(p.heading) || 'Video'} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          ) : (
            <p className="sb-empty">Paste a YouTube or Vimeo link in the video settings.</p>
          )}
          {str(p.caption) && <p className="sb-caption">{str(p.caption)}</p>}
        </div>
      );
    }
    case 'logos': {
      const items = list(p.items);
      return (
        <div>
          <Heading heading={str(p.heading)} />
          {items.length === 0 ? (
            <p className="sb-empty">Add logos.</p>
          ) : (
            <ul className={`sb-logos${p.grayscale ? ' sb-logos--grey' : ''}`}>
              {items.map((l, i) => (
                <li key={i}>{str(l.link) ? <SiteLink to={str(l.link)}><Img img={image(l.image)} /></SiteLink> : <Img img={image(l.image)} />}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case 'features': {
      const items = list(p.items);
      return (
        <div>
          <Heading eyebrow={str(p.eyebrow)} heading={str(p.heading)} />
          <RichText text={str(p.intro)} className="sb-lede" />
          <ul className={`sb-features${p.cards ? ' sb-features--cards' : ''}`} style={{ '--sb-cols': Number(p.columns) || 3 } as CSSProperties}>
            {items.map((f, i) => (
              <li key={i}>
                {image(f.image) ? <Img img={image(f.image)} className="sb-feature__img" /> : str(f.icon) ? <Icon name={str(f.icon)} size={32} className="sb-feature__icon" /> : null}
                <h3>{str(f.link) ? <SiteLink to={str(f.link)}>{str(f.title)}</SiteLink> : str(f.title)}</h3>
                <RichText text={str(f.text)} />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'stats':
      return (
        <div>
          <Heading heading={str(p.heading)} />
          <ul className="sb-stats">
            {list(p.items).map((s, i) => (
              <li key={i}>
                <strong>{str(s.value)}</strong>
                <span>{str(s.label)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'testimonials':
      return (
        <div>
          <Heading heading={str(p.heading)} />
          <div className="sb-quotes">
            {list(p.items).map((q, i) => (
              <figure key={i} className="sb-quote">
                <blockquote>“{str(q.quote).replace(/^[“"]|[”"]$/g, '')}”</blockquote>
                {(str(q.author) || str(q.role)) && (
                  <figcaption>
                    {str(q.author)}
                    {str(q.role) && <span>{str(q.role)}</span>}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      );
    case 'faq':
      return (
        <div>
          <Heading heading={str(p.heading)} />
          <div className="sb-faq">
            {list(p.items).map((f, i) => (
              <details key={i}>
                <summary>{str(f.q)}</summary>
                <RichText text={str(f.a)} />
              </details>
            ))}
          </div>
        </div>
      );
    case 'cta':
      return (
        <div className="sb-cta">
          <Heading heading={str(p.heading)} size="l" />
          <RichText text={str(p.text)} className="sb-lede" />
          <Buttons items={list(p.buttons)} />
        </div>
      );
    case 'rooms':
      return <RoomsBlock p={p} cfg={cfg} />;
    case 'equipment':
      return <EquipmentBlock p={p} cfg={cfg} />;
    case 'hours':
      return (
        <div>
          <Heading heading={str(p.heading)} />
          <OpeningHours cfg={cfg} highlightToday={p.highlightToday === true} />
        </div>
      );
    case 'contact': {
      const tel = cfg.contactPhone?.replace(/\s/g, '');
      return (
        <div className={`sb-contact${p.showMap && cfg.address ? ' sb-contact--map' : ''}`}>
          <div>
            <Heading heading={str(p.heading)} />
            <RichText text={str(p.intro)} />
            <ul className="sb-contact__list">
              {cfg.address && (
                <li>
                  <span className="sb-contact__label">Address</span>
                  <span style={{ whiteSpace: 'pre-line' }}>{cfg.address}</span>
                  <SiteLink to={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.address.replace(/\n/g, ', '))}`}>Get directions ↗</SiteLink>
                </li>
              )}
              {cfg.contactPhone && <li><span className="sb-contact__label">Phone</span><SiteLink to={`tel:${tel}`}>{cfg.contactPhone}</SiteLink></li>}
              {cfg.contactEmail && <li><span className="sb-contact__label">Email</span><SiteLink to={`mailto:${cfg.contactEmail}`}>{cfg.contactEmail}</SiteLink></li>}
            </ul>
            {p.showHours === true && cfg.openingHours.some((h) => h.isOpen) && (
              <>
                <h3 className="sb-subheading">Opening hours</h3>
                <OpeningHours cfg={cfg} highlightToday />
              </>
            )}
          </div>
          {p.showMap === true && cfg.address && (
            <div className="sb-map">
              <iframe src={mapEmbed(cfg.address)} title={`Map: ${cfg.address.replace(/\n/g, ', ')}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
          )}
        </div>
      );
    }
    case 'map': {
      const address = str(p.address) || cfg.address || '';
      if (!address) return <p className="sb-empty">Add your address in Settings (or in this block) to show a map.</p>;
      return (
        <div className="sb-map" style={{ height: Number(p.height) || 380 }}>
          <iframe src={mapEmbed(address)} title={`Map: ${address.replace(/\n/g, ', ')}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      );
    }
    default:
      return null;
  }
}

function RoomsBlock({ p, cfg }: { p: P; cfg: PublicConfig }) {
  const rooms = usePublicRooms();
  const showPrices = p.showPrices !== false;
  const showBook = p.showBook !== false;
  return (
    <div>
      <Heading eyebrow={str(p.eyebrow)} heading={str(p.heading)} />
      <RichText text={str(p.intro)} className="sb-lede" />
      {rooms.isPending ? (
        <p className="sb-empty">Loading rooms…</p>
      ) : !rooms.data?.length ? (
        <p className="sb-empty">Your rooms appear here once they're added in Admin › Rooms.</p>
      ) : p.layout === 'detailed' ? (
        <div className="sb-rooms-detailed">
          {rooms.data.map((r) => {
            const from = roomFromPrice(r, cfg);
            return (
              <article key={r.id} className="sb-room-detail">
                {r.imageUrl && <img className="sb-room-detail__img" src={r.imageUrl} alt={r.name} loading="lazy" />}
                <div>
                  <h3>{r.name}</h3>
                  <ul className="sb-room-detail__facts">
                    {r.capacity && <li>Up to {r.capacity} people</li>}
                    {showPrices && r.ratePlans.map((pl) => <li key={pl.id}><strong>{pl.name}</strong>: {planSummary(pl, cfg.currency)}</li>)}
                    {showPrices && r.ratePlans.length === 0 && r.priceRules.map((pr) => (
                      <li key={pr.label}>{pr.label}: {money(pr.hourlyRatePence, cfg.currency)}/h ({pr.daysOfWeek.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ')} {pr.startTime}–{closeLabel(pr.endTime)})</li>
                    ))}
                  </ul>
                  {r.description && <RichText text={r.description} />}
                  <div className="sb-room-detail__foot">
                    {showPrices && <span>from <strong>{money(from.pence, cfg.currency)}</strong> {from.unit}</span>}
                    {showBook && <SiteLink to={`/book?room=${r.id}`} className="sb-btn sb-btn--primary">Book {r.name}</SiteLink>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <ul className="sb-rooms">
          {rooms.data.map((r) => {
            const from = roomFromPrice(r, cfg);
            return (
              <li key={r.id} className="sb-room">
                {r.imageUrl ? <img className="sb-room__img" src={r.imageUrl} alt={r.name} loading="lazy" /> : <div className="sb-room__img sb-img-placeholder" aria-hidden>{r.name}</div>}
                <div className="sb-room__body">
                  <h3>{r.name}</h3>
                  <p className="sb-muted">
                    {r.capacity ? `Up to ${r.capacity} people` : ''}
                    {r.capacity && showPrices ? ' · ' : ''}
                    {showPrices ? `from ${money(from.pence, cfg.currency)} ${from.unit}` : ''}
                  </p>
                  {showBook && <SiteLink to={`/book?room=${r.id}`} className="sb-btn sb-btn--secondary">Book {r.name}</SiteLink>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EquipmentBlock({ p, cfg }: { p: P; cfg: PublicConfig }) {
  const kit = usePublicEquipment();
  return (
    <div>
      <Heading heading={str(p.heading)} />
      <RichText text={str(p.intro)} className="sb-lede" />
      {!kit.data?.length ? (
        <p className="sb-empty">{kit.isPending ? 'Loading…' : 'Hire equipment appears here once added in Admin › Equipment.'}</p>
      ) : (
        <table className="sb-table">
          <tbody>
            {kit.data.map((e) => (
              <tr key={e.id}>
                <th scope="row">
                  {e.name}
                  {e.description && <span className="sb-table__sub">{e.description}</span>}
                </th>
                <td>{money(e.pricePence, cfg.currency)} {EQUIPMENT_PRICING_LABELS[e.pricing]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The section wrapper: background, spacing, width, alignment
// ---------------------------------------------------------------------------

export function blockSectionProps(block: SiteBlock): { className: string; style: CSSProperties; id?: string } {
  const s = block.style;
  const bgImg = s.background === 'image' ? imageUrl(s.backgroundImage?.src) : null;
  const darkText = s.background === 'dark' || s.background === 'image';
  const style: CSSProperties = {};
  if (s.background === 'custom' && s.backgroundColor) style.background = s.backgroundColor;
  if (bgImg) style.backgroundImage = `linear-gradient(rgba(0,0,0,${(s.overlay ?? 40) / 100}), rgba(0,0,0,${(s.overlay ?? 40) / 100})), url("${bgImg}")`;
  const cls = [
    'sb-section',
    `sb-section--${block.type}`,
    `sb-bg--${s.background === 'image' && !bgImg ? 'dark' : s.background}`,
    darkText ? 'sb-on-dark' : '',
    s.background === 'primary' ? 'sb-on-primary' : '',
    `sb-pad--${s.padding}`,
    `sb-align--${s.align}`,
    s.hideOnMobile ? 'sb-hide-mobile' : '',
  ];
  return { className: cls.filter(Boolean).join(' '), style, id: s.anchor || undefined };
}

export function BlockView({ block, cfg, first, children }: { block: SiteBlock; cfg: PublicConfig; first?: boolean; children?: ReactNode }) {
  const { className, style, id } = blockSectionProps(block);
  return (
    <section className={className} style={style} id={id}>
      <div className={`sb-inner sb-w--${block.style.width}`}>
        <BlockBody block={block} cfg={cfg} level={first ? 1 : 2} />
      </div>
      {children}
    </section>
  );
}

