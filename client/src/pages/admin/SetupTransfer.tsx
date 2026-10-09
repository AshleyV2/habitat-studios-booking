import { SETUP_FILE_FORMAT } from '@habitat/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { api, ApiError, uploadFile } from '../../api/client';
import { Notice } from '../../components/States';

type Photo = { id: string; filename: string; mime: string; size: number; data?: string };
type SetupFileJson = {
  format: string;
  version: number;
  exportedAt: string;
  from: { businessName: string; publicUrl: string; version: string };
  rooms: { name: string }[];
  equipment: unknown[];
  promoCodes: unknown[];
  closures: unknown[];
  website: { assets: Photo[]; published: unknown };
  [key: string]: unknown;
};
type ImportResult = { rooms: number; equipment: number; promoCodes: number; closures: number; photos: number; hiddenRooms: number; toEnterAgain: string[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Copy this installation's setup to another one (e.g. moving a cloud site onto the studio's own
 * server): download a setup file here, import it there. Bookings, customers, staff and secrets stay put.
 */
export function SetupTransfer() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<SetupFileJson | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function download() {
    setError(null);
    setBusy('Preparing the file…');
    try {
      const data = await api.get<SetupFileJson & { settings: { businessName: string } }>('/api/admin/settings/transfer/export');
      const slug = data.settings.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'booking';
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-setup-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the setup file.');
    } finally {
      setBusy(null);
    }
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    setConfirmed(false);
    setFile(null);
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as SetupFileJson;
      if (parsed?.format !== SETUP_FILE_FORMAT) throw new Error('not a setup file');
      setFile(parsed);
    } catch {
      setError('That file is not a booking setup file. Use the file downloaded with “Download setup file”.');
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    try {
      // Photos first (one request each, to stay within upload limits), then the setup that uses them.
      const photos = file.website.assets;
      for (const [i, p] of photos.entries()) {
        setBusy(`Uploading website photos (${i + 1} of ${photos.length})…`);
        await uploadFile(`/api/admin/settings/transfer/photos/${encodeURIComponent(p.id)}`, new File([base64ToBytes(p.data ?? '')], p.filename, { type: p.mime }));
      }
      setBusy('Importing the setup…');
      const setup = { ...file, website: { ...file.website, assets: photos.map(({ data: _data, ...rest }) => rest) } };
      setResult(await api.post<ImportResult>('/api/admin/settings/transfer/import', { setup, confirm: true }));
      setFile(null);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The import did not finish. Nothing was replaced; try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-transfer" aria-labelledby="transfer-h">
      <h3 id="transfer-h">Move to another server</h3>
      <p className="small muted">
        Copy this booking system’s setup to another installation, for example moving a cloud site onto the studio’s own server. Download the file here, then import it in
        the new installation’s Settings › Server.
      </p>
      <p className="small">
        <strong>Included:</strong> business and booking settings, website texts, opening hours, rooms and prices, equipment, promo codes, upcoming closures, and the website
        with its photos. <strong>Not included:</strong> bookings, customers, payments, staff logins, and passwords or keys (Stripe, the email password, the monitoring key),
        which are entered again on the new installation. To move bookings and customers as well, restore a backup on the new server instead (see docs/OPERATIONS.md).
      </p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void download()} disabled={busy !== null}>
          Download setup file
        </button>
        <label className="btn btn--ghost" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
          Import a setup file…
          <input type="file" accept="application/json,.json" onChange={(e) => void choose(e)} disabled={busy !== null} hidden />
        </label>
      </div>

      {busy && <Notice tone="info" role="status">{busy}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {file && !busy && (
        <div className="notice notice--warn settings-confirm" role="alert">
          <p style={{ marginTop: 0 }}>
            <strong>Import the setup of {file.from.businessName}</strong> ({file.from.publicUrl}, saved {new Date(file.exportedAt).toLocaleString('en-GB')})?
          </p>
          <ul>
            <li>
              Replaces this installation’s settings and website texts, opening hours, and upcoming closures ({plural(file.closures.length, 'closure')} in the file).
            </li>
            <li>
              Replaces the rooms ({file.rooms.map((r) => r.name).join(', ') || 'none'}), {plural(file.equipment.length, 'equipment item')} and{' '}
              {plural(file.promoCodes.length, 'promo code')}. Ones here that aren’t in the file are removed, or hidden if bookings use them.
            </li>
            <li>{file.website.published ? 'Publishes the website from the file' : 'Copies the website draft from the file'} ({plural(file.website.assets.length, 'photo')}).</li>
            <li>Bookings, customers, payments and staff logins here are not changed.</li>
          </ul>
          <label className="checkbox" style={{ margin: '10px 0' }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I understand this replaces the current setup</span>
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn--danger" disabled={!confirmed} onClick={() => void runImport()}>
              Import and replace
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setFile(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <Notice tone="ok" role="status">
          <div>
            <strong>Imported:</strong> {plural(result.rooms, 'room')}, {plural(result.equipment, 'equipment item')}, {plural(result.promoCodes, 'promo code')},{' '}
            {plural(result.closures, 'upcoming closure')} and {plural(result.photos, 'website photo')}.
            {result.hiddenRooms > 0 && ` ${plural(result.hiddenRooms, 'room')} with existing bookings ${result.hiddenRooms === 1 ? 'was' : 'were'} hidden rather than removed.`}
            <div style={{ marginTop: 8 }}>Now enter again on this installation:</div>
            <ul style={{ margin: '4px 0 0' }}>
              {result.toEnterAgain.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </Notice>
      )}
    </section>
  );
}
