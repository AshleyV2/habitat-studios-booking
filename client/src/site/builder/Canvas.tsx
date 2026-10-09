import { BLOCKS, type BlockType, type PublicConfig, type SiteDoc, type SitePage } from '@habitat/shared';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BlockView } from '../blocks';
import { SiteNavContext } from '../links';
import { Icon } from '../icons';
import { SiteShell } from '../SiteShell';

export type Device = 'desktop' | 'tablet' | 'mobile';
export const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '820px', mobile: '390px' };

export const DRAG_NEW = 'application/x-wb-new';
const DRAG_MOVE = 'application/x-wb-move';

/**
 * Renders children inside an iframe (same origin, no URL), copying the app's stylesheets in
 * and keeping them in sync, so the page is laid out at the chosen device width with real
 * media queries, and the editor's own styles never leak into it.
 */
function Frame({ width, title, children }: { width: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const iframe = ref.current;
    const d = iframe?.contentDocument;
    if (!d) return;
    d.open();
    d.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="wb-frame-body"></body></html>');
    d.close();
    const copy = () => {
      d.head.querySelectorAll('[data-wb-copied]').forEach((n) => n.remove());
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
        const c = n.cloneNode(true) as HTMLElement;
        c.setAttribute('data-wb-copied', '');
        d.head.appendChild(c);
      });
    };
    copy();
    const mo = new MutationObserver(copy);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    // Keyboard shortcuts (undo, delete…) pressed inside the preview reach the editor, except
    // while typing in the page (e.g. a form on the booking page).
    const forward = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const ev = new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, cancelable: true });
      window.dispatchEvent(ev);
      if (ev.defaultPrevented) e.preventDefault();
    };
    d.defaultView?.addEventListener('keydown', forward);
    setBody(d.body);
    return () => {
      mo.disconnect();
      d.defaultView?.removeEventListener('keydown', forward);
    };
  }, []);
  return (
    <iframe ref={ref} title={title} className="wb-frame" style={{ width }}>
      {body && createPortal(children, body)}
    </iframe>
  );
}

interface CanvasProps {
  doc: SiteDoc;
  page: SitePage;
  cfg: PublicConfig;
  device: Device;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onInsert: (type: BlockType, index: number) => void;
  onMove: (id: string, index: number) => void;
  onAction: (id: string, action: 'up' | 'down' | 'duplicate' | 'delete' | 'hide') => void;
  onAddAt: (index: number) => void;
  onNavigate: (path: string) => void;
}

export function Canvas(props: CanvasProps) {
  const { doc, page, cfg, device, selectedId, onSelect } = props;
  const [drop, setDrop] = useState<number | null>(null);
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    const clear = () => {
      setDrop(null);
      dragging.current = null;
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  // Keep the selected section in view when it is chosen from the side panel.
  useEffect(() => {
    if (!selectedId) return;
    const frame = document.querySelector<HTMLIFrameElement>('.wb-frame');
    frame?.contentDocument?.querySelector(`[data-wb-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_NEW) || e.dataTransfer.types.includes(DRAG_MOVE);

  function overBlock(e: DragEvent<HTMLDivElement>, index: number) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_MOVE) ? 'move' : 'copy';
    const r = e.currentTarget.getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? index : index + 1;
    if (at !== drop) setDrop(at);
  }

  function dropAt(e: DragEvent, index: number) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.dataTransfer.getData(DRAG_NEW);
    const m = e.dataTransfer.getData(DRAG_MOVE);
    if (t && t in BLOCKS) props.onInsert(t as BlockType, index);
    else if (m) props.onMove(m, index);
    setDrop(null);
  }

  const line = (i: number) => (drop === i ? <div className="wb-drop-line" aria-hidden /> : null);

  return (
    <Frame width={DEVICE_WIDTH[device]} title={`Preview of ${page.title}`}>
      <SiteNavContext.Provider value={{ editor: true, onNavigate: props.onNavigate }}>
        <div
          className="wb-canvas-root"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-wb-id]')) onSelect(null);
          }}
        >
          <SiteShell doc={doc} cfg={cfg} currentPath={`/${page.slug}`}>
            {page.blocks.map((b, i) => {
              const def = BLOCKS[b.type];
              return (
                <div key={b.id}>
                  {line(i)}
                  <div
                    data-wb-id={b.id}
                    className={`wb-block${selectedId === b.id ? ' is-selected' : ''}${b.style.hidden ? ' is-hidden' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(b.id);
                    }}
                    onDragOver={(e) => overBlock(e, i)}
                    onDrop={(e) => dropAt(e, drop ?? i)}
                  >
                    <BlockView block={b} cfg={cfg} first={i === 0} />
                    <div className="wb-block__bar" onClick={(e) => e.stopPropagation()}>
                      <span
                        className="wb-block__handle"
                        draggable
                        title="Drag to move"
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_MOVE, b.id);
                          e.dataTransfer.effectAllowed = 'move';
                          dragging.current = b.id;
                          onSelect(b.id);
                        }}
                      >
                        <Icon name="grip" size={14} /> {def.label}
                        {b.style.hidden && ' (hidden)'}
                      </span>
                      <button type="button" title="Move up" disabled={i === 0} onClick={() => props.onAction(b.id, 'up')}><Icon name="up" size={15} /></button>
                      <button type="button" title="Move down" disabled={i === page.blocks.length - 1} onClick={() => props.onAction(b.id, 'down')}><Icon name="down" size={15} /></button>
                      <button type="button" title="Duplicate" onClick={() => props.onAction(b.id, 'duplicate')}><Icon name="copy" size={15} /></button>
                      <button type="button" title={b.style.hidden ? 'Show' : 'Hide'} onClick={() => props.onAction(b.id, 'hide')}><Icon name={b.style.hidden ? 'eyeOff' : 'eye'} size={15} /></button>
                      <button type="button" title="Delete" className="wb-danger" onClick={() => props.onAction(b.id, 'delete')}><Icon name="trash" size={15} /></button>
                    </div>
                    <button type="button" className="wb-block__add" title="Add a section below" onClick={(e) => { e.stopPropagation(); props.onAddAt(i + 1); }}><Icon name="plus" size={16} /></button>
                  </div>
                </div>
              );
            })}
            {line(page.blocks.length)}
            <div
              className={`wb-dropzone${drop === page.blocks.length ? ' is-active' : ''}`}
              onDragOver={(e) => {
                if (!accepts(e)) return;
                e.preventDefault();
                setDrop(page.blocks.length);
              }}
              onDrop={(e) => dropAt(e, page.blocks.length)}
            >
              {page.blocks.length === 0 ? 'This page is empty. Drag a section here from the left, or ' : 'Drag a section here, or '}
              <button type="button" className="wb-linkbtn" onClick={() => props.onAddAt(page.blocks.length)}>add one</button>.
            </div>
          </SiteShell>
        </div>
      </SiteNavContext.Provider>
    </Frame>
  );
}
