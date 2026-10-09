import type { ApiErrorBody } from '@habitat/shared';
import { apiUrl } from '../lib/base';

// Same client design as the ApexBook platform: CSRF double-submit, session-expiry event.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = 'habitat:session-expired';
const CSRF_COOKIES = ['__Host-habitat_csrf', '__Secure-habitat_csrf', 'habitat_csrf'];
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCsrf(): string | null {
  const jar = new Map(
    document.cookie
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))] as const;
      }),
  );
  for (const n of CSRF_COOKIES) if (jar.get(n)) return jar.get(n)!;
  return null;
}

async function ensureCsrf() {
  const t = readCsrf();
  if (t) return t;
  await fetch(apiUrl('/api/auth/csrf'), { credentials: 'same-origin' });
  return readCsrf() ?? '';
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method)) headers['X-CSRF-Token'] = await ensureCsrf();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the booking system. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return data as T;
  const err = (data as ApiErrorBody | null)?.error;
  if (res.status === 403 && err?.code === 'csrf_invalid' && !retried) return request<T>(method, path, body, true);
  if (res.status === 401 && path.startsWith('/api/admin')) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong. Please try again.', err?.fields);
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Upload a file as the raw request body (website images). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': file.type || 'application/octet-stream',
    'X-Filename': encodeURIComponent(file.name),
    'X-CSRF-Token': await ensureCsrf(),
  };
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method: 'POST', headers, credentials: 'same-origin', body: file });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the booking system. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return data as T;
  if (res.status === 413) throw new ApiError(413, 'too_large', 'That image is too big. Images can be up to 5 MB.');
  const err = (data as ApiErrorBody | null)?.error;
  throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Upload failed.');
}
