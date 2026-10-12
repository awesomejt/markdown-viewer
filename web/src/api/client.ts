import type { FileContent, Listing, RootsResponse } from './types';

/** Error codes the client itself produces, in addition to the server's. */
export const NETWORK_CODE = 'network';
export const UNKNOWN_CODE = 'unknown';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Encode each path segment, keeping `/` separators. `""` stays `""`. */
export function encodePath(path: string): string {
  if (path === '') return '';
  return path.split('/').map(encodeURIComponent).join('/');
}

/** `ws === ''` is the root folder as workspace (`?ws=`); `undefined` means no workspace. */
function withWorkspace(href: string, ws?: string): string {
  return ws !== undefined ? `${href}?ws=${encodeURIComponent(ws)}` : href;
}

export function browseHref(root: string, path: string, ws?: string): string {
  const base = `/browse/${encodeURIComponent(root)}`;
  return withWorkspace(path ? `${base}/${encodePath(path)}` : base, ws);
}

export function viewHref(root: string, path: string, ws?: string): string {
  const base = `/view/${encodeURIComponent(root)}`;
  return withWorkspace(path ? `${base}/${encodePath(path)}` : base, ws);
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/**
 * URL of the raw file body, for `<img src>` and downloads. `version` (ignored by the server)
 * changes the URL when the file changes, so a live `<img>` reloads instead of reusing its cache.
 */
export function fileUrl(root: string, path: string, version?: string): string {
  return `/api/file?${query(version === undefined ? { root, path } : { root, path, v: version })}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = res.status >= 500 ? 'internal' : UNKNOWN_CODE;
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const body: unknown = JSON.parse(await res.text());
    const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (typeof err?.code === 'string') code = err.code;
    if (typeof err?.message === 'string') message = err.message;
  } catch {
    // Non-JSON body (proxy error page, empty body): keep the fallbacks.
  }
  return new ApiError(res.status, code, message);
}

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    // Let callers distinguish cancellation from a real network failure.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, NETWORK_CODE, e instanceof Error ? e.message : 'Network error');
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, signal);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'internal', 'Invalid response from server');
  }
}

export function getRoots(signal?: AbortSignal): Promise<RootsResponse> {
  return getJSON<RootsResponse>('/api/roots', signal);
}

export function getList(root: string, path: string, signal?: AbortSignal): Promise<Listing> {
  return getJSON<Listing>(`/api/list?${query({ root, path })}`, signal);
}

export async function getFile(
  root: string,
  path: string,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<FileContent> {
  const params: Record<string, string> = { root, path };
  if (opts.force) params.force = '1';
  const res = await request(`/api/file?${query(params)}`, opts.signal);
  return {
    text: await res.text(),
    contentType: res.headers.get('Content-Type') ?? '',
    etag: res.headers.get('ETag') ?? '',
  };
}

/** D2 layout engine; empty uses the source's `d2-config` layout-engine, else dagre. */
export type D2Layout = '' | 'dagre' | 'elk';

/** Renders D2 source on the server; returns the SVG text. Throws ApiError on any non-200. */
export async function renderD2(
  source: string,
  theme: 'light' | 'dark',
  signal?: AbortSignal,
  layout: D2Layout = '',
): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/render/d2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layout ? { source, theme, layout } : { source, theme }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, NETWORK_CODE, e instanceof Error ? e.message : 'Network error');
  }
  if (!res.ok) throw await parseError(res);
  return res.text();
}
