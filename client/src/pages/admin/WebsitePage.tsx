import { imagesInDoc, newBlock, newId, type BlockType, type SiteImage } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { BASE_PATH } from '../../lib/base';
import { Canvas, type Device } from '../../site/builder/Canvas';
import type { FieldContext } from '../../site/builder/FieldInput';
import { ImageLibrary } from '../../site/builder/ImageLibrary';
import { AddPanel, BlockInspector, OutlinePanel, PagesPanel, ThemePanel } from '../../site/builder/Panels';
import { useSiteEditor, type DraftResponse } from '../../site/builder/useSiteEditor';
import { Icon } from '../../site/icons';
import { usePublicConfig } from '../public/PublicLayout';

const timeAgo = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

/** Admin › Website: the drag-and-drop builder. Loads the draft, then hands it to the editor. */
export function WebsitePage() {
  useDocumentTitle('Website · Admin');
  const draft = useQuery({ queryKey: ['site-draft'], queryFn: () => api.get<DraftResponse>('/api/admin/site/draft'), staleTime: Infinity, refetchOnWindowFocus: false });
  const { data: cfg } = usePublicConfig();
  if (draft.isError) return <div className="notice notice--error" style={{ margin: 24 }}>{draft.error instanceof ApiError ? draft.error.message : 'Could not load the website.'}</div>;
  if (!draft.data || !cfg) return <div className="wb-loading">Loading the website builder…</div>;
  return <Builder initial={draft.data} cfg={cfg} />;
}

type LeftTab = 'add' | 'pages' | 'theme' | 'outline';

function Builder({ initial, cfg }: { initial: DraftResponse; cfg: NonNullable<ReturnType<typeof usePublicConfig>['data']> }) {
  const ed = useSiteEditor(initial);
  const { doc, update } = ed;
  const [params, setParams] = useSearchParams();
  const pageIndex = Math.min(Math.max(0, doc.pages.findIndex((p) => p.id === params.get('page'))), doc.pages.length - 1);
  const page = doc.pages[pageIndex] ?? doc.pages[0]!;
  // Pages are chosen by id (a page just added isn't in this render's doc yet).
  const selectPage = useCallback((id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('page', id); return n; }, { replace: true }), [setParams]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [left, setLeft] = useState<LeftTab>('add');
  const [device, setDevice] = useState<Device>('desktop');
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [library, setLibrary] = useState<{ open: boolean; onPick?: (img: SiteImage) => void }>({ open: false });
  const [dialog, setDialog] = useState<'publish' | 'history' | null>(null);
  const [toast, setToast] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const selected = page.blocks.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !page.blocks.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [page, selectedId]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const ctx: FieldContext = useMemo(
    () => ({
      pages: doc.pages,
      anchors: page.blocks.map((b) => b.style.anchor).filter(Boolean),
      pickImage: (onPick) => setLibrary({ open: true, onPick: (img) => { onPick(img); setLibrary({ open: false }); } }),
    }),
    [doc.pages, page.blocks],
  );

  // --- Block operations -------------------------------------------------------------
  const insert = (type: BlockType, index: number) => {
    const b = newBlock(type);
    update((d) => void d.pages[pageIndex]!.blocks.splice(index, 0, b));
    setSelectedId(b.id);
    setInsertAt(null);
    setLeft('add');
  };
  const move = (id: string, to: number) =>
    update((d) => {
      const blocks = d.pages[pageIndex]!.blocks;
      const from = blocks.findIndex((b) => b.id === id);
      if (from < 0) return;
      const [b] = blocks.splice(from, 1);
      blocks.splice(to > from ? to - 1 : to, 0, b!);
    });
  const action = (id: string, a: 'up' | 'down' | 'duplicate' | 'delete' | 'hide') => {
    const i = page.blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    if (a === 'up' && i > 0) move(id, i - 1);
    if (a === 'down' && i < page.blocks.length - 1) move(id, i + 2);
    if (a === 'duplicate') {
      const copy = { ...structuredClone(page.blocks[i]!), id: newId() };
      update((d) => void d.pages[pageIndex]!.blocks.splice(i + 1, 0, copy));
      setSelectedId(copy.id);
    }
    if (a === 'hide') update((d) => void (d.pages[pageIndex]!.blocks[i]!.style.hidden = !d.pages[pageIndex]!.blocks[i]!.style.hidden));
    if (a === 'delete') {
      update((d) => void d.pages[pageIndex]!.blocks.splice(i, 1));
      setSelectedId(null);
      setToast({ tone: 'ok', text: 'Section deleted. Press Ctrl+Z to undo.' });
    }
  };
  const nextIndex = insertAt ?? (selected ? page.blocks.indexOf(selected) + 1 : page.blocks.length);

  // --- Keyboard shortcuts -------------------------------------------------------------
  const keyRef = useRef({ ed, selectedId, action });
  keyRef.current = { ed, selectedId, action };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const k = keyRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) k.ed.redo();
        else k.ed.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        k.ed.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void k.ed.saveNow();
      } else if (!typing && k.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        k.action(k.selectedId, 'delete');
      } else if (e.key === 'Escape' && !typing) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Publish / history --------------------------------------------------------------
  async function serverAction(path: string, body: object, ok: string) {
    if (!(await ed.saveNow()) && ed.saveState !== 'saved') return false;
    try {
      const r = await api.post<DraftResponse>(path, body);
      ed.load(r);
      setToast({ tone: 'ok', text: ok });
      return true;
    } catch (err) {
      setToast({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong.' });
      return false;
    }
  }

  const saveLabel = { saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved: retrying on next change', conflict: 'Changed elsewhere' }[ed.saveState];
  const inUse = useMemo(() => imagesInDoc(doc), [doc]);

  return (
    <div className="wb">
      <header className="wb-top">
        <Link to="/admin" className="wb-top__back" title="Back to admin" aria-label="Back to admin"><Icon name="back" size={18} /></Link>
        <div className="wb-top__page">
          <label htmlFor="wb-page" className="visually-hidden">Page</label>
          <select id="wb-page" className="select" value={page.id} onChange={(e) => { selectPage(e.target.value); setSelectedId(null); }}>
            {doc.pages.map((p) => <option key={p.id} value={p.id}>{p.title} (/{p.slug})</option>)}
          </select>
        </div>
        <div className="wb-segmented wb-devices" role="radiogroup" aria-label="Preview size">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={device === d} className={device === d ? 'is-on' : undefined} onClick={() => setDevice(d)} title={d}>
              <Icon name={d === 'mobile' ? 'phone' : d} size={15} /> {{ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone' }[d]}
            </button>
          ))}
        </div>
        <div className="wb-top__tools">
          <button type="button" className="btn btn--small btn--ghost" onClick={ed.undo} disabled={!ed.canUndo} title="Undo (Ctrl+Z)"><Icon name="undo" size={15} /> Undo</button>
          <button type="button" className="btn btn--small btn--ghost" onClick={ed.redo} disabled={!ed.canRedo} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" size={15} /> Redo</button>
          <span className={`wb-save wb-save--${ed.saveState}`} role="status">{saveLabel}</span>
          <button type="button" className="btn btn--small" onClick={() => setLibrary({ open: true })}>Images</button>
          <button type="button" className="btn btn--small" onClick={() => setDialog('history')}>History</button>
          <a className="btn btn--small" href={`${BASE_PATH}/admin/website/preview?page=${page.id}`} target="_blank" rel="noopener" onClick={() => void ed.saveNow()}><Icon name="external" size={14} /> Preview</a>
          <button type="button" className="btn btn--small btn--primary" onClick={() => setDialog('publish')} disabled={ed.saveState === 'conflict'}>
            Publish{ed.meta.unpublishedChanges || ed.saveState !== 'saved' ? ' •' : ''}
          </button>
        </div>
      </header>

      {ed.saveState === 'conflict' && (
        <div className="notice notice--error wb-banner" role="alert">
          {ed.saveError} <button type="button" className="btn btn--small" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      {ed.meta.originalSiteLive && (
        <div className="notice wb-original-note" role="status">
          Your live website is still your original custom-designed site. Work here is a draft until you publish, which replaces the original site. You can switch back at any time from History.
        </div>
      )}
      {toast && <div className={`notice notice--${toast.tone === 'ok' ? 'ok' : 'error'} wb-toast`} role="status">{toast.text}</div>}

      <div className="wb-body">
        <aside className="wb-left" aria-label="Builder tools">
          <div className="wb-tabs" role="tablist">
            {(['add', 'pages', 'theme', 'outline'] as LeftTab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={left === t} onClick={() => setLeft(t)}>
                {{ add: 'Add', pages: 'Pages', theme: 'Design', outline: 'Layers' }[t]}
              </button>
            ))}
          </div>
          {left === 'add' && <AddPanel onAdd={(t) => insert(t, nextIndex)} insertHint={insertAt !== null ? 'at the chosen spot' : selected ? 'below the selected section' : 'at the end of the page'} />}
          {left === 'pages' && <PagesPanel doc={doc} pageIndex={pageIndex} selectPage={(id) => { selectPage(id); setSelectedId(null); }} update={update} />}
          {left === 'theme' && <ThemePanel doc={doc} update={update} ctx={ctx} />}
          {left === 'outline' && (
            <div className="wb-panel">
              <OutlinePanel page={page} selectedId={selectedId} onSelect={setSelectedId} onAction={(id, a) => action(id, a)} />
            </div>
          )}
        </aside>

        <main className={`wb-stage wb-stage--${device}`} aria-label="Page preview">
          <Canvas
            doc={doc}
            page={page}
            cfg={cfg}
            device={device}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onInsert={insert}
            onMove={move}
            onAction={action}
            onAddAt={(i) => { setInsertAt(i); setLeft('add'); setSelectedId(null); }}
            onNavigate={(path) => {
              const slug = path.replace(/^\//, '').split(/[?#]/)[0] ?? '';
              const i = doc.pages.findIndex((p) => p.slug === slug);
              if (i >= 0) { selectPage(doc.pages[i]!.id); setSelectedId(null); }
            }}
          />
        </main>

        <aside className="wb-right" aria-label="Section settings">
          {selected ? (
            <BlockInspector block={selected} pageIndex={pageIndex} update={update} ctx={ctx} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="wb-panel wb-empty-inspector">
              <h2>Edit your website</h2>
              <ol>
                <li><strong>Click a section</strong> on the page to change its text, photos and colours.</li>
                <li><strong>Drag sections</strong> from “Add” onto the page, or drag a section’s handle to move it.</li>
                <li>Change colours, fonts, logo and menu in <button type="button" className="wb-linkbtn" onClick={() => setLeft('theme')}>Design</button>.</li>
                <li>Everything saves as you go. Visitors only see it after you press <strong>Publish</strong>.</li>
              </ol>
              <p className="wb-muted wb-small">Last published: {timeAgo(ed.meta.publishedAt)}</p>
            </div>
          )}
        </aside>
      </div>

      <ImageLibrary open={library.open} onClose={() => setLibrary({ open: false })} onPick={library.onPick} builtin={ed.meta.builtinImages} inUse={inUse} />
      {dialog === 'publish' && <PublishDialog onClose={() => setDialog(null)} onPublish={async (note) => { if (await serverAction('/api/admin/site/publish', { note }, 'Published: your website is live.')) setDialog(null); }} />}
      {dialog === 'history' && (
        <HistoryDialog
          onClose={() => setDialog(null)}
          onRestore={async (id) => { if (await serverAction(`/api/admin/site/versions/${id}/restore`, {}, 'Restored into your draft. Publish to make it live.')) setDialog(null); }}
          onDiscard={async () => { if (window.confirm('Throw away all changes since the last publish?') && (await serverAction('/api/admin/site/discard', {}, 'Unpublished changes discarded.'))) setDialog(null); }}
          originalLive={ed.meta.originalSiteLive}
          hasOriginal={ed.meta.hasOriginalSite}
          onUseOriginal={async () => { if (window.confirm('Put your original custom-designed website back live? Your builder work stays here as a draft.') && (await serverAction('/api/admin/site/use-original', {}, 'Your original website is live again.'))) setDialog(null); }}
          onReset={async () => { if (window.confirm('Replace your draft with a fresh starter website built from your Settings? (Your live site is unchanged until you publish.)') && (await serverAction('/api/admin/site/reset', {}, 'Draft reset to the starter website.'))) setDialog(null); }}
        />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="wb-dialog" onClose={onClose} onCancel={onClose}>
      <div className="wb-dialog__head">
        <h2>{title}</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>Close</button>
      </div>
      {children}
    </dialog>
  );
}

function PublishDialog({ onClose, onPublish }: { onClose: () => void; onPublish: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Publish your website" onClose={onClose}>
      <p>Everyone visiting your site will see this version straight away. You can go back to an earlier version from History at any time.</p>
      <div className="wb-field">
        <label className="wb-field__label" htmlFor="pub-note">What changed? <span className="wb-muted">(optional, for your history)</span></label>
        <input id="pub-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. New summer prices" />
      </div>
      <div className="wb-row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={async () => { setBusy(true); await onPublish(note); setBusy(false); }}>{busy ? 'Publishing…' : 'Publish now'}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function HistoryDialog({ onClose, onRestore, onDiscard, onReset, onUseOriginal, originalLive, hasOriginal }: { onClose: () => void; onRestore: (id: string) => void; onDiscard: () => void; onReset: () => void; onUseOriginal: () => void; originalLive: boolean; hasOriginal: boolean }) {
  const versions = useQuery({ queryKey: ['site-versions'], queryFn: () => api.get<{ id: string; note: string | null; publishedAt: string; publishedBy: string | null; live: boolean }[]>('/api/admin/site/versions') });
  return (
    <Modal title="Website history" onClose={onClose}>
      <p className="wb-muted">Your last 30 published versions. Restoring copies a version into your draft so you can check it before publishing.</p>
      {versions.isPending ? (
        <p>Loading…</p>
      ) : !versions.data?.length ? (
        <p>Nothing published yet. Visitors currently see the starter website.</p>
      ) : (
        <ul className="wb-history">
          {versions.data.map((v) => (
            <li key={v.id}>
              <div>
                <strong>{timeAgo(v.publishedAt)}</strong> {v.live && !originalLive && <span className="badge badge--ok">Live</span>}
                <div className="wb-muted wb-small">{v.note || 'No note'}{v.publishedBy ? ` · ${v.publishedBy}` : ''}</div>
              </div>
              <button type="button" className="btn btn--small" onClick={() => onRestore(v.id)}>Restore</button>
            </li>
          ))}
        </ul>
      )}
      <div className="wb-row" style={{ marginTop: 16 }}>
        {hasOriginal && !originalLive && <button type="button" className="btn btn--small" onClick={onUseOriginal}>Switch back to the original website</button>}
        <button type="button" className="btn btn--small" onClick={onDiscard}>Discard unpublished changes</button>
        <button type="button" className="btn btn--small btn--danger" onClick={onReset}>Start again from the starter site</button>
      </div>
    </Modal>
  );
}
