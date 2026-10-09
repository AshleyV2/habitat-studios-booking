/**
 * The path the app is served under ('' at a domain root, '/book' under a path).
 * The server injects it into index.html from PUBLIC_URL; nothing is hard-coded.
 */
export const BASE_PATH = (document.querySelector('meta[name="habitat-base-path"]')?.getAttribute('content') ?? '').replace(/\/+$/, '');

export const apiUrl = (path: string) => `${BASE_PATH}${path}`;
