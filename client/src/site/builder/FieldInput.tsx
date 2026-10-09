import { listItemDefaults, siteLinkSchema, type SiteField, type SiteImage, type SitePage } from '@habitat/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { imageUrl } from '../links';

export interface FieldContext {
  pages: SitePage[];
  /** Section link names on the current page (#anchor targets). */
  anchors: string[];
  pickImage: (onPick: (img: SiteImage) => void) => void;
}

type OnChange = (value: unknown) => void;

/** One setting, rendered from its description in shared/site.ts. */
export function FieldInput({ field, value, onChange, ctx }: { field: SiteField; value: unknown; onChange: OnChange; ctx: FieldContext }) {
  const id = useId();
  const label = (
    <label htmlFor={id} className="wb-field__label">
      {field.label}
    </label>
  );
  const hint = field.hint ? <p className="wb-field__hint">{field.hint}</p> : null;

  switch (field.kind) {
    case 'text':
      return (
        <div className="wb-field">
          {label}
          <input id={id} className="input" value={String(value ?? '')} maxLength={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </div>
      );
    case 'textarea':
      return (
        <div className="wb-field">
          {label}
          <textarea id={id} className="textarea" rows={4} value={String(value ?? '')} maxLength={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </div>
      );
    case 'rich':
      return <RichInput id={id} field={field} value={String(value ?? '')} onChange={onChange} label={label} hint={hint} ctx={ctx} />;
    case 'select':
      if (field.options.length <= 4) {
        return (
          <div className="wb-field">
            <span className="wb-field__label" id={id}>{field.label}</span>
            <div className="wb-segmented" role="radiogroup" aria-labelledby={id}>
              {field.options.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : undefined} onClick={() => onChange(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
            {hint}
          </div>
        );
      }
      return (
        <div className="wb-field">
          {label}
          <select id={id} className="select" value={String(value ?? field.default)} onChange={(e) => onChange(e.target.value)}>
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hint}
        </div>
      );
    case 'toggle':
      return (
        <div className="wb-field wb-field--toggle">
          <label className="wb-toggle">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            <span>{field.label}</span>
          </label>
          {hint}
        </div>
      );
    case 'number': {
      const n = typeof value === 'number' ? value : field.default;
      return (
        <div className="wb-field">
          <label htmlFor={id} className="wb-field__label">
            {field.label} <span className="wb-muted">{n}{field.unit ?? ''}</span>
          </label>
          <input id={id} type="range" min={field.min} max={field.max} step={field.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} />
          {hint}
        </div>
      );
    }
    case 'color': {
      const v = String(value ?? '');
      return (
        <div className="wb-field">
          {label}
          <ColorInput id={id} value={v} onChange={onChange} allowEmpty />
          {hint}
        </div>
      );
    }
    case 'image':
      return (
        <div className="wb-field">
          <span className="wb-field__label">{field.label}</span>
          <ImageInput value={(value as SiteImage | null) ?? null} onChange={onChange} ctx={ctx} />
          {hint}
        </div>
      );
    case 'link':
      return (
        <div className="wb-field">
          {label}
          <LinkInput id={id} value={String(value ?? '')} onChange={onChange} ctx={ctx} />
          {hint}
        </div>
      );
    case 'list':
      return <ListInput field={field} value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} onChange={onChange} ctx={ctx} />;
  }
}

// ---------------------------------------------------------------------------

export function ColorInput({ id, value, onChange, allowEmpty }: { id?: string; value: string; onChange: OnChange; allowEmpty?: boolean }) {
  const [text, setText] = useState(value);
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  const hex = useRef<HTMLInputElement>(null);
  // Follow outside changes (undo, presets) unless the person is typing in the box.
  useEffect(() => {
    if (document.activeElement !== hex.current) setText(value);
  }, [value]);
  return (
    <div className="wb-color">
      <input type="color" aria-label="Pick a colour" value={valid ? value : '#ffffff'} onChange={(e) => { onChange(e.target.value); setText(e.target.value); }} />
      <input
        id={id ? `${id}-hex` : undefined}
        ref={hex}
        className="input wb-color__hex"
        value={text}
        placeholder={allowEmpty ? 'None' : '#000000'}
        onChange={(e) => {
          const t = e.target.value.trim();
          setText(t);
          if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase());
          else if (allowEmpty && t === '') onChange('');
        }}
      />
      {allowEmpty && value && <button type="button" className="wb-linkbtn" onClick={() => { onChange(''); setText(''); }}>Clear</button>}
    </div>
  );
}

function ImageInput({ value, onChange, ctx }: { value: SiteImage | null; onChange: OnChange; ctx: FieldContext }) {
  const url = imageUrl(value?.src);
  return (
    <div className="wb-image">
      <button type="button" className="wb-image__preview" onClick={() => ctx.pickImage((img) => onChange({ ...img, alt: value?.alt ?? img.alt }))}>
        {url ? <img src={url} alt="" /> : <span>Choose image</span>}
      </button>
      {value && (
        <>
          <div className="wb-image__actions">
            <button type="button" className="wb-linkbtn" onClick={() => ctx.pickImage((img) => onChange({ ...img, alt: value.alt }))}>Replace</button>
            <button type="button" className="wb-linkbtn wb-linkbtn--danger" onClick={() => onChange(null)}>Remove</button>
          </div>
          <input className="input" placeholder="Describe the image (for screen readers & Google)" value={value.alt} maxLength={200} onChange={(e) => onChange({ ...value, alt: e.target.value })} aria-label="Image description" />
        </>
      )}
    </div>
  );
}

function LinkInput({ id, value, onChange, ctx }: { id: string; value: string; onChange: OnChange; ctx: FieldContext }) {
  const options = [
    { value: '', label: 'No link' },
    ...ctx.pages.map((p) => ({ value: `/${p.slug}`, label: `Page: ${p.title}` })),
    { value: '/book', label: 'Booking page' },
    ...ctx.anchors.map((a) => ({ value: `#${a}`, label: `Section: #${a}` })),
  ];
  const known = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(!known);
  const valid = siteLinkSchema.safeParse(value).success;
  return (
    <div className="wb-link">
      <select
        id={id}
        className="select"
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') {
            setCustom(true);
            if (known) onChange('https://');
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__custom">Web address, email or phone…</option>
      </select>
      {custom && (
        <>
          <input className="input" value={value} placeholder="https://… or mailto:… or tel:…" onChange={(e) => onChange(e.target.value.trim())} aria-label="Link address" />
          {!valid && <p className="wb-field__error">Use https://…, mailto:…, tel:…, /page or #section</p>}
        </>
      )}
    </div>
  );
}

const TOOLBAR: { label: ReactNode; title: string; wrap?: [string, string]; line?: string }[] = [
  { label: <strong>B</strong>, title: 'Bold', wrap: ['**', '**'] },
  { label: <em style={{ fontFamily: 'Georgia, serif' }}>I</em>, title: 'Italic', wrap: ['*', '*'] },
  { label: <Icon name="link" size={15} />, title: 'Link', wrap: ['[', '](https://)'] },
  { label: <Icon name="listBullet" size={15} />, title: 'Bullet list', line: '- ' },
  { label: <Icon name="listNumber" size={15} />, title: 'Numbered list', line: '1. ' },
  { label: <Icon name="heading" size={15} />, title: 'Subheading', line: '## ' },
  { label: <Icon name="quote" size={15} />, title: 'Quote', line: '> ' },
];

function RichInput({ id, field, value, onChange, label, hint }: { id: string; field: SiteField & { max?: number }; value: string; onChange: OnChange; label: ReactNode; hint: ReactNode; ctx: FieldContext }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function apply(t: (typeof TOOLBAR)[number]) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    let next: string;
    let caret: [number, number];
    if (t.wrap) {
      const sel = value.slice(a, b) || (t.title === 'Link' ? 'link text' : 'text');
      next = value.slice(0, a) + t.wrap[0] + sel + t.wrap[1] + value.slice(b);
      caret = [a + t.wrap[0].length, a + t.wrap[0].length + sel.length];
    } else {
      const lineStart = value.lastIndexOf('\n', a - 1) + 1;
      const lineEnd = value.indexOf('\n', b) === -1 ? value.length : value.indexOf('\n', b);
      const lines = value.slice(lineStart, lineEnd).split('\n').map((l) => (l.startsWith(t.line!) ? l.slice(t.line!.length) : t.line + l));
      next = value.slice(0, lineStart) + lines.join('\n') + value.slice(lineEnd);
      caret = [lineStart, lineStart + lines.join('\n').length];
    }
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret[0], caret[1]);
    });
  }
  return (
    <div className="wb-field">
      {label}
      <div className="wb-rich-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR.map((t) => (
          <button key={t.title} type="button" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(t)}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea id={id} ref={ref} className="textarea wb-rich" rows={6} value={value} maxLength={field.max} onChange={(e) => onChange(e.target.value)} />
      {hint ?? <p className="wb-field__hint">Blank line = new paragraph. **bold**, *italic*, [text](link), “- ” for lists.</p>}
    </div>
  );
}

function ListInput({ field, value, onChange, ctx }: { field: Extract<SiteField, { kind: 'list' }>; value: Record<string, unknown>[]; onChange: OnChange; ctx: FieldContext }) {
  const [open, setOpen] = useState<number | null>(value.length === 1 ? 0 : null);
  const set = (i: number, item: Record<string, unknown>) => onChange(value.map((v, j) => (j === i ? item : v)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    setOpen(j);
  };
  const titleOf = (item: Record<string, unknown>, i: number) => {
    const f = field.fields.find((x) => x.kind === 'text' || x.kind === 'textarea');
    const t = f ? String(item[f.key] ?? '').trim() : '';
    return t || `${field.itemLabel[0]!.toUpperCase()}${field.itemLabel.slice(1)} ${i + 1}`;
  };
  return (
    <div className="wb-field">
      <span className="wb-field__label">
        {field.label} <span className="wb-muted">{value.length}/{field.max}</span>
      </span>
      <ol className="wb-list">
        {value.map((item, i) => {
          const img = field.fields.find((x) => x.kind === 'image');
          const thumb = img ? imageUrl((item[img.key] as SiteImage | null)?.src) : null;
          return (
            <li key={i} className={open === i ? 'is-open' : undefined}>
              <div className="wb-list__head">
                <button type="button" className="wb-list__title" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  {thumb && <img src={thumb} alt="" />}
                  <span>{titleOf(item, i)}</span>
                </button>
                <div className="wb-list__tools">
                  <button type="button" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
                  <button type="button" title="Move down" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
                  <button type="button" title="Duplicate" aria-label="Duplicate" disabled={value.length >= field.max} onClick={() => onChange([...value.slice(0, i + 1), structuredClone(item), ...value.slice(i + 1)])}><Icon name="copy" size={14} /></button>
                  <button type="button" title="Delete" aria-label="Delete" className="wb-danger" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }}><Icon name="trash" size={14} /></button>
                </div>
              </div>
              {open === i && (
                <div className="wb-list__body">
                  {field.fields.map((f) => (
                    <FieldInput key={f.key} field={f} value={item[f.key]} onChange={(v) => set(i, { ...item, [f.key]: v })} ctx={ctx} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {value.length < field.max && (
        <div className="wb-list__add">
          <button type="button" className="btn btn--small" onClick={() => { onChange([...value, listItemDefaults(field)]); setOpen(value.length); }}>
            + Add {field.itemLabel}
          </button>
          {field.fields.some((f) => f.kind === 'image') && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() =>
                ctx.pickImage((img) => {
                  const key = field.fields.find((f) => f.kind === 'image')!.key;
                  onChange([...value, { ...listItemDefaults(field), [key]: img }]);
                })
              }
            >
              + Add from images
            </button>
          )}
        </div>
      )}
      {field.hint && <p className="wb-field__hint">{field.hint}</p>}
    </div>
  );
}
