import {
  BLOCK_CATEGORIES,
  BLOCKS,
  COLOR_LABELS,
  contrastRatio,
  newId,
  RESERVED_SLUGS,
  SITE_FONTS,
  slugify,
  STYLE_FIELDS,
  THEME_PRESETS,
  type BlockType,
  type SiteBlock,
  type SiteDoc,
  type SiteField,
  type SitePage,
  type ThemeColors,
} from '@habitat/shared';
import { useState } from 'react';
import { DRAG_NEW } from './Canvas';
import { Icon } from '../icons';
import { ColorInput, FieldInput, type FieldContext } from './FieldInput';

type Update = (fn: (d: SiteDoc) => void, coalesceKey?: string) => void;

// ---------------------------------------------------------------------------
// Add a section
// ---------------------------------------------------------------------------

export function AddPanel({ onAdd, insertHint }: { onAdd: (t: BlockType) => void; insertHint: string }) {
  const [q, setQ] = useState('');
  const types = (Object.keys(BLOCKS) as BlockType[]).filter((t) => {
    const d = BLOCKS[t];
    return !q || `${d.label} ${d.description}`.toLowerCase().includes(q.toLowerCase());
  });
  return (
    <div className="wb-panel">
      <p className="wb-muted wb-small">Drag a section onto the page, or click to add it {insertHint}.</p>
      <input className="input" type="search" placeholder="Search sections" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sections" />
      {BLOCK_CATEGORIES.map((cat) => {
        const items = types.filter((t) => BLOCKS[t].category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="wb-library-group">
            <h3>{cat}</h3>
            <ul className="wb-blocklist">
              {items.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_NEW, t);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAdd(t)}
                    title={BLOCKS[t].description}
                  >
                    <span className="wb-blocklist__icon"><Icon name={t} size={18} /></span>
                    <span>
                      <strong>{BLOCKS[t].label}</strong>
                      <small>{BLOCKS[t].description}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section settings
// ---------------------------------------------------------------------------

const styleVisible = (f: SiteField, s: SiteBlock['style']) => {
  if (f.key === 'backgroundColor') return s.background === 'custom';
  if (f.key === 'backgroundImage' || f.key === 'overlay') return s.background === 'image';
  return true;
};

export function BlockInspector({ block, pageIndex, update, ctx, onClose }: { block: SiteBlock; pageIndex: number; update: Update; ctx: FieldContext; onClose: () => void }) {
  const [tab, setTab] = useState<'content' | 'design'>('content');
  const def = BLOCKS[block.type];
  const fields = def.fields as SiteField[];
  const patch = (fn: (b: SiteBlock) => void, key: string) =>
    update((d) => {
      const b = d.pages[pageIndex]?.blocks.find((x) => x.id === block.id);
      if (b) fn(b);
    }, `${block.id}:${key}`);
  return (
    <div className="wb-panel">
      <div className="wb-inspector__head">
        <div>
          <span className="wb-muted wb-small">Editing section</span>
          <h2>{def.label}</h2>
        </div>
        <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>Done</button>
      </div>
      <div className="wb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>Content</button>
        <button type="button" role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>Design</button>
      </div>
      {tab === 'content' ? (
        fields.length ? (
          fields.map((f) => <FieldInput key={`${block.id}-${f.key}`} field={f} value={block.props[f.key]} ctx={ctx} onChange={(v) => patch((b) => void (b.props[f.key] = v), f.key)} />)
        ) : (
          <p className="wb-muted">This section has no content settings. See Design.</p>
        )
      ) : (
        STYLE_FIELDS.filter((f) => styleVisible(f, block.style)).map((f) => (
          <FieldInput
            key={`${block.id}-s-${f.key}`}
            field={f}
            value={(block.style as Record<string, unknown>)[f.key]}
            ctx={ctx}
            onChange={(v) => patch((b) => void ((b.style as Record<string, unknown>)[f.key] = f.key === 'anchor' ? slugify(String(v)) : v), `s-${f.key}`)}
          />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline of the current page (accessible reordering)
// ---------------------------------------------------------------------------

export function OutlinePanel({ page, selectedId, onSelect, onAction }: { page: SitePage; selectedId: string | null; onSelect: (id: string) => void; onAction: (id: string, a: 'up' | 'down' | 'delete') => void }) {
  if (!page.blocks.length) return <p className="wb-muted wb-small">No sections yet.</p>;
  return (
    <ol className="wb-outline">
      {page.blocks.map((b, i) => (
        <li key={b.id} className={selectedId === b.id ? 'is-selected' : undefined}>
          <button type="button" className="wb-outline__name" onClick={() => onSelect(b.id)}>
            <Icon name={b.type} size={15} /> {BLOCKS[b.type].label}
            {typeof b.props.heading === 'string' && b.props.heading && <small> · {b.props.heading}</small>}
            {b.style.hidden && <small> (hidden)</small>}
          </button>
          <span className="wb-outline__tools">
            <button type="button" aria-label={`Move ${BLOCKS[b.type].label} up`} disabled={i === 0} onClick={() => onAction(b.id, 'up')}><Icon name="up" size={14} /></button>
            <button type="button" aria-label={`Move ${BLOCKS[b.type].label} down`} disabled={i === page.blocks.length - 1} onClick={() => onAction(b.id, 'down')}><Icon name="down" size={14} /></button>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function PagesPanel({ doc, pageIndex, selectPage, update }: { doc: SiteDoc; pageIndex: number; selectPage: (id: string) => void; update: Update }) {
  const [newTitle, setNewTitle] = useState('');
  const page = doc.pages[pageIndex]!;
  const slugTaken = (s: string, except?: string) => doc.pages.some((p) => p.slug === s && p.id !== except) || RESERVED_SLUGS.includes(s);
  const uniqueSlug = (base: string) => {
    let s = base || 'page';
    for (let n = 2; slugTaken(s); n++) s = `${base}-${n}`;
    return s;
  };
  const setPage = (fn: (p: SitePage) => void, key: string) =>
    update((d) => {
      const p = d.pages.find((x) => x.id === page.id);
      if (p) fn(p);
    }, `page-${page.id}-${key}`);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= doc.pages.length) return;
    update((d) => {
      [d.pages[i], d.pages[j]] = [d.pages[j]!, d.pages[i]!];
    });
  };
  const slugError = page.slug !== '' && (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(page.slug) ? 'Lowercase letters, numbers and dashes' : slugTaken(page.slug, page.id) ? 'Already used (or reserved by the booking system)' : null);

  return (
    <div className="wb-panel">
      <ol className="wb-pages">
        {doc.pages.map((p, i) => (
          <li key={p.id} className={i === pageIndex ? 'is-selected' : undefined}>
            <button type="button" className="wb-pages__name" onClick={() => selectPage(p.id)} aria-current={i === pageIndex}>
              {p.title}
              <small>/{p.slug}{!p.showInNav && ' · not in menu'}</small>
            </button>
            <span className="wb-outline__tools">
              <button type="button" aria-label={`Move ${p.title} up in the menu`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
              <button type="button" aria-label={`Move ${p.title} down in the menu`} disabled={i === doc.pages.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
            </span>
          </li>
        ))}
      </ol>
      <form
        className="wb-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          const p: SitePage = { id: newId(), slug: uniqueSlug(slugify(title)), title, navLabel: '', showInNav: true, seoTitle: '', seoDescription: '', blocks: [] };
          update((d) => void d.pages.push(p));
          selectPage(p.id);
          setNewTitle('');
        }}
      >
        <input className="input" placeholder="New page name, e.g. Prices" value={newTitle} maxLength={80} onChange={(e) => setNewTitle(e.target.value)} aria-label="New page name" />
        <button type="submit" className="btn btn--small">Add page</button>
      </form>

      <h3 className="wb-subhead">This page: {page.title}</h3>
      <div className="wb-field">
        <label className="wb-field__label" htmlFor="pg-title">Page title</label>
        <input id="pg-title" className="input" value={page.title} maxLength={80} onChange={(e) => setPage((p) => void (p.title = e.target.value), 'title')} />
      </div>
      <div className="wb-field">
        <label className="wb-field__label" htmlFor="pg-nav">Name in the menu</label>
        <input id="pg-nav" className="input" value={page.navLabel} placeholder={page.title} maxLength={40} onChange={(e) => setPage((p) => void (p.navLabel = e.target.value), 'nav')} />
      </div>
      <label className="wb-toggle">
        <input type="checkbox" checked={page.showInNav} onChange={(e) => setPage((p) => void (p.showInNav = e.target.checked), 'shownav')} />
        <span>Show in the menu</span>
      </label>
      {page.slug !== '' && (
        <div className="wb-field">
          <label className="wb-field__label" htmlFor="pg-slug">Address</label>
          <div className="wb-prefixed"><span>/</span><input id="pg-slug" className="input" value={page.slug} maxLength={50} onChange={(e) => setPage((p) => void (p.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')), 'slug')} /></div>
          {slugError && <p className="wb-field__error">{slugError}</p>}
        </div>
      )}
      <details className="wb-details">
        <summary>Search engines (Google)</summary>
        <div className="wb-field">
          <label className="wb-field__label" htmlFor="pg-seot">Title in search results</label>
          <input id="pg-seot" className="input" value={page.seoTitle} placeholder={page.title} maxLength={80} onChange={(e) => setPage((p) => void (p.seoTitle = e.target.value), 'seot')} />
        </div>
        <div className="wb-field">
          <label className="wb-field__label" htmlFor="pg-seod">Description <span className="wb-muted">{page.seoDescription.length}/300</span></label>
          <textarea id="pg-seod" className="textarea" rows={3} value={page.seoDescription} maxLength={300} onChange={(e) => setPage((p) => void (p.seoDescription = e.target.value), 'seod')} />
        </div>
      </details>
      <div className="wb-row">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            const copy: SitePage = { ...structuredClone(page), id: newId(), slug: uniqueSlug(page.slug ? `${page.slug}-copy` : 'home-copy'), title: `${page.title} (copy)`, showInNav: false };
            copy.blocks = copy.blocks.map((b) => ({ ...b, id: newId() }));
            update((d) => void d.pages.splice(pageIndex + 1, 0, copy));
            selectPage(copy.id);
          }}
        >
          Duplicate page
        </button>
        {page.slug !== '' && (
          <button
            type="button"
            className="btn btn--small btn--danger"
            onClick={() => {
              if (!window.confirm(`Delete the page “${page.title}”? You can undo this.`)) return;
              update((d) => void d.pages.splice(pageIndex, 1));
              selectPage(doc.pages[Math.max(0, pageIndex - 1)]!.id);
            }}
          >
            Delete page
          </button>
        )}
      </div>
      {page.slug === '' && <p className="wb-muted wb-small">This is your home page: it can't be deleted or moved to another address.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme, header, footer
// ---------------------------------------------------------------------------

const CONTRAST_PAIRS: [keyof ThemeColors, keyof ThemeColors, string][] = [
  ['text', 'background', 'Text on the page background'],
  ['onPrimary', 'primary', 'Button text on the main colour'],
  ['onDark', 'dark', 'Text on dark sections'],
  ['headerText', 'headerBg', 'Header text'],
  ['footerText', 'footerBg', 'Footer text'],
  ['text', 'surface', 'Text on panels'],
];

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export function ThemePanel({ doc, update, ctx }: { doc: SiteDoc; update: Update; ctx: FieldContext }) {
  const t = doc.theme;
  const warnings = CONTRAST_PAIRS.filter(([a, b]) => contrastRatio(t.colors[a], t.colors[b]) < 4.5);
  const setTheme = (fn: (d: SiteDoc) => void, key: string) => update(fn, `theme-${key}`);
  const sel = (key: keyof typeof t, label: string, options: { value: string; label: string }[]) => (
    <FieldInput field={{ key, label, kind: 'select', options, default: String(t[key]) }} value={t[key]} ctx={ctx} onChange={(v) => setTheme((d) => void ((d.theme as Record<string, unknown>)[key] = v), key)} />
  );
  const fontOptions = Object.entries(SITE_FONTS).map(([value, f]) => ({ value, label: f.label }));
  return (
    <div className="wb-panel">
      <h3 className="wb-subhead">Start from a style</h3>
      <ul className="wb-presets">
        {Object.entries(THEME_PRESETS).map(([key, p]) => (
          <li key={key}>
            <button type="button" onClick={() => update((d) => void (d.theme = structuredClone(p.theme)))} title={`Use ${p.label}`}>
              <span className="wb-presets__swatch" style={{ background: p.theme.colors.background }}>
                <i style={{ background: p.theme.colors.headerBg }} />
                <i style={{ background: p.theme.colors.primary }} />
                <i style={{ background: p.theme.colors.accent }} />
              </span>
              <span style={{ fontFamily: SITE_FONTS[p.theme.headingFont].stack }}>{p.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <details className="wb-details" open>
        <summary>Colours</summary>
        {warnings.length > 0 && (
          <div className="notice notice--warn wb-small">
            Hard to read: {warnings.map(([, , l]) => l.toLowerCase()).join('; ')}. Pick colours with more contrast.
          </div>
        )}
        {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((k) => (
          <div key={k} className="wb-field wb-field--inline">
            <span className="wb-field__label">{COLOR_LABELS[k]}</span>
            <ColorInput value={t.colors[k]} onChange={(v) => setTheme((d) => void (d.theme.colors[k] = String(v)), `c-${k}`)} />
          </div>
        ))}
      </details>

      <details className="wb-details" open>
        <summary>Fonts &amp; shapes</summary>
        {sel('headingFont', 'Headings font', fontOptions)}
        {sel('bodyFont', 'Text font', fontOptions)}
        {sel('headingCase', 'Headings', opts([['normal', 'Normal'], ['upper', 'CAPITALS']]))}
        {sel('textSize', 'Text size', opts([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]))}
        {sel('radius', 'Corners', opts([['none', 'Square'], ['s', 'Slight'], ['m', 'Rounded'], ['l', 'Very round']]))}
        {sel('buttonShape', 'Button shape', opts([['square', 'Like corners'], ['rounded', 'Rounded'], ['pill', 'Pill']]))}
        {sel('buttonStyle', 'Main buttons', opts([['solid', 'Filled'], ['outline', 'Outline']]))}
        {sel('maxWidth', 'Page width', opts([['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]))}
      </details>

      <HeaderFooterSettings doc={doc} update={update} ctx={ctx} />
    </div>
  );
}

function HeaderFooterSettings({ doc, update, ctx }: { doc: SiteDoc; update: Update; ctx: FieldContext }) {
  const field = (area: 'header' | 'footer' | 'social', f: SiteField) => (
    <FieldInput key={`${area}-${f.key}`} field={f} value={(doc[area] as Record<string, unknown>)[f.key]} ctx={ctx} onChange={(v) => update((d) => void ((d[area] as Record<string, unknown>)[f.key] = v), `${area}-${f.key}`)} />
  );
  return (
    <>
      <details className="wb-details">
        <summary>Header &amp; menu</summary>
        {field('header', { key: 'logo', label: 'Logo', kind: 'image' })}
        {doc.header.logo && field('header', { key: 'logoHeight', label: 'Logo height', kind: 'number', min: 20, max: 120, step: 2, unit: 'px', default: 40 })}
        {field('header', { key: 'showName', label: 'Show business name next to the logo', kind: 'toggle' })}
        {field('header', { key: 'layout', label: 'Layout', kind: 'select', options: opts([['left', 'Logo left'], ['center', 'Centred']]), default: 'left' })}
        {field('header', { key: 'sticky', label: 'Stay at the top when scrolling', kind: 'toggle' })}
        {field('header', { key: 'showBookButton', label: 'Show a booking button in the menu', kind: 'toggle' })}
        {doc.header.showBookButton && field('header', { key: 'bookLabel', label: 'Booking button text', kind: 'text', max: 30 })}
        {field('header', { key: 'extraLinks', label: 'Extra menu links', kind: 'list', itemLabel: 'link', max: 6, hint: 'Pages are added to the menu automatically (Pages tab).', fields: [{ key: 'label', label: 'Label', kind: 'text', max: 40, default: 'Link' }, { key: 'link', label: 'Link', kind: 'link', default: '' }] })}
        {field('header', { key: 'announcement', label: 'Announcement bar', kind: 'text', max: 200, hint: 'A strip above the header, e.g. “Closed on bank holiday Monday”. Leave empty to hide.' })}
        {doc.header.announcement && field('header', { key: 'announcementLink', label: 'Announcement link', kind: 'link' })}
      </details>
      <details className="wb-details">
        <summary>Footer</summary>
        {field('footer', { key: 'text', label: 'Footer text', kind: 'rich', max: 1000 })}
        {field('footer', { key: 'showContact', label: 'Show contact details', kind: 'toggle' })}
        {field('footer', { key: 'showHours', label: 'Show opening hours', kind: 'toggle' })}
        {field('footer', { key: 'showLinks', label: 'Show booking & policy links', kind: 'toggle' })}
        {field('footer', { key: 'showSocial', label: 'Show social links', kind: 'toggle' })}
      </details>
      <details className="wb-details">
        <summary>Social media</summary>
        {(['instagram', 'facebook', 'tiktok', 'youtube', 'x'] as const).map((k) =>
          field('social', { key: k, label: { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', x: 'X (Twitter)' }[k], kind: 'text', max: 300, placeholder: 'https://…' }),
        )}
      </details>
    </>
  );
}
