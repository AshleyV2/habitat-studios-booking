import type { SiteDoc } from '@habitat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';

export interface DraftResponse {
  doc: SiteDoc;
  revision: number;
  updatedAt: string;
  publishedAt: string | null;
  unpublishedChanges: boolean;
  builtinImages: boolean;
  originalSiteLive: boolean;
  hasOriginalSite: boolean;
}

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

const HISTORY_LIMIT = 100;
/** Edits closer together than this (e.g. typing) are one undo step. */
const COALESCE_MS = 800;
const AUTOSAVE_MS = 1200;

/**
 * The builder's document state: undo/redo history and autosave with conflict detection.
 * `update` takes a function that mutates a copy of the document.
 */
export function useSiteEditor(initial: DraftResponse) {
  const [hist, setHist] = useState<{ doc: SiteDoc; past: SiteDoc[]; future: SiteDoc[] }>({ doc: initial.doc, past: [], future: [] });
  const doc = hist.doc;
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ publishedAt: initial.publishedAt, unpublishedChanges: initial.unpublishedChanges, builtinImages: initial.builtinImages, originalSiteLive: initial.originalSiteLive, hasOriginalSite: initial.hasOriginalSite });
  const revision = useRef(initial.revision);
  const savedJson = useRef(JSON.stringify(initial.doc));
  const lastEdit = useRef<{ at: number; key: string } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const update = useCallback((fn: (d: SiteDoc) => void, coalesceKey?: string) => {
    // Decide outside the state updater (which React may run twice) whether this edit merges
    // into the previous undo step.
    const now = Date.now();
    const l = lastEdit.current;
    const coalesce = Boolean(coalesceKey && l && l.key === coalesceKey && now - l.at < COALESCE_MS);
    lastEdit.current = { at: now, key: coalesceKey ?? '' };
    setHist((h) => {
      const next = structuredClone(h.doc);
      fn(next);
      return coalesce ? { ...h, doc: next } : { doc: next, past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.doc], future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    setHist((h) => (h.past.length ? { doc: h.past[h.past.length - 1]!, past: h.past.slice(0, -1), future: [h.doc, ...h.future] } : h));
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setHist((h) => (h.future.length ? { doc: h.future[0]!, past: [...h.past, h.doc], future: h.future.slice(1) } : h));
  }, []);

  /** Replace everything (after publish/restore/discard): no undo across server actions. */
  const load = useCallback((r: DraftResponse) => {
    revision.current = r.revision;
    savedJson.current = JSON.stringify(r.doc);
    lastEdit.current = null;
    setHist({ doc: r.doc, past: [], future: [] });
    setSaveState('saved');
    setSaveError(null);
    setMeta({ publishedAt: r.publishedAt, unpublishedChanges: r.unpublishedChanges, builtinImages: r.builtinImages, originalSiteLive: r.originalSiteLive, hasOriginalSite: r.hasOriginalSite });
  }, []);

  const saveNow = useCallback(async () => {
    const json = JSON.stringify(docRef.current);
    if (json === savedJson.current) return true;
    setSaveState('saving');
    try {
      const r = await api.put<DraftResponse>('/api/admin/site/draft', { revision: revision.current, doc: docRef.current });
      revision.current = r.revision;
      savedJson.current = json;
      setMeta({ publishedAt: r.publishedAt, unpublishedChanges: r.unpublishedChanges, builtinImages: r.builtinImages, originalSiteLive: r.originalSiteLive, hasOriginalSite: r.hasOriginalSite });
      setSaveError(null);
      setSaveState(JSON.stringify(docRef.current) === json ? 'saved' : 'unsaved');
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setSaveState('conflict');
      else setSaveState('error');
      setSaveError(err instanceof ApiError ? err.message : 'Could not save.');
      return false;
    }
  }, []);

  // Autosave shortly after the last change.
  useEffect(() => {
    if (JSON.stringify(doc) === savedJson.current) return;
    if (saveState === 'conflict') return;
    setSaveState((s) => (s === 'saving' ? s : 'unsaved'));
    const t = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(docRef.current) !== savedJson.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return { doc, update, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, saveState, saveError, saveNow, load, meta };
}
