import type { SiteImage } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadFile } from '../../api/client';
import { imageUrl } from '../links';

interface Asset {
  id: string;
  src: string;
  filename: string;
  size: number;
  createdAt: string;
}

/** Photos that ship with the app (the original studio's; hidden on cloud instances). */
const BUILTIN = [
  'hero', 'story', 'about', 'communal',
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `gallery-${n}`),
  'room-1', 'room-2', 'room-3',
  'client-happy-mondays', 'client-badly-drawn-boy', 'client-airbourne', 'client-nm', 'client-fs', 'client-ab',
].map((n) => `site/${n}.jpg`);

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/**
 * Pick or upload an image. Uploading: drop files anywhere on the dialog or use the button;
 * several at once is fine. Deleting is offered only from here, with a warning if in use.
 */
export function ImageLibrary({ open, onClose, onPick, builtin, inUse }: { open: boolean; onClose: () => void; onPick?: (img: SiteImage) => void; builtin: boolean; inUse: Set<string> }) {
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: ['site-assets'], queryFn: () => api.get<Asset[]>('/api/admin/site/assets'), enabled: open });
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function upload(files: FileList | File[]) {
    setError(null);
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return setError('Only image files can be uploaded.');
    setUploading((n) => n + list.length);
    const failures: string[] = [];
    let last: Asset | null = null;
    for (const f of list) {
      try {
        last = await uploadFile<Asset>('/api/admin/site/assets', f);
      } catch (err) {
        failures.push(`${f.name}: ${err instanceof ApiError ? err.message : 'failed'}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await qc.invalidateQueries({ queryKey: ['site-assets'] });
    if (failures.length) setError(failures.join(' '));
    // One image uploaded while choosing: use it straight away.
    if (onPick && list.length === 1 && last) onPick({ src: last.src, alt: '' });
  }

  async function remove(a: Asset) {
    const msg = inUse.has(a.src) ? `“${a.filename}” is used on your website. Delete it anyway? It will disappear from those sections.` : `Delete “${a.filename}”?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/api/admin/site/assets/${a.id}`);
      await qc.invalidateQueries({ queryKey: ['site-assets'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  }

  return (
    <dialog
      ref={dialog}
      className={`wb-dialog wb-library${dragOver ? ' is-dragover' : ''}`}
      onClose={onClose}
      onCancel={onClose}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="wb-dialog__head">
        <h2>{onPick ? 'Choose an image' : 'Images'}</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>Close</button>
      </div>
      <div className="wb-library__upload">
        <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading ? `Uploading ${uploading}…` : 'Upload images'}
        </button>
        <span className="wb-muted">or drag photos here · JPEG, PNG, WebP or GIF, up to 5 MB each</span>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <div className="wb-library__body">
        <h3>Your uploads</h3>
        {assets.isPending ? (
          <p className="wb-muted">Loading…</p>
        ) : !assets.data?.length ? (
          <p className="wb-muted">Nothing uploaded yet.</p>
        ) : (
          <ul className="wb-library__grid">
            {assets.data.map((a) => (
              <li key={a.id}>
                <button type="button" className="wb-thumb" onClick={() => onPick?.({ src: a.src, alt: '' })} disabled={!onPick} title={a.filename}>
                  <img src={imageUrl(a.src) ?? ''} alt="" loading="lazy" />
                </button>
                <div className="wb-thumb__meta">
                  <span title={a.filename}>{a.filename}</span>
                  <span className="wb-muted">{kb(a.size)}{inUse.has(a.src) ? ' · in use' : ''}</span>
                  <button type="button" className="wb-linkbtn wb-linkbtn--danger" onClick={() => void remove(a)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {builtin && onPick && (
          <>
            <h3>Included photos</h3>
            <ul className="wb-library__grid">
              {BUILTIN.map((src) => (
                <li key={src}>
                  <button type="button" className="wb-thumb" onClick={() => onPick({ src, alt: '' })} title={src}>
                    <img src={imageUrl(src) ?? ''} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </dialog>
  );
}
