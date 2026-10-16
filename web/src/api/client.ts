import type { FileContent, Listing, PrefsResponse, ProjectResponse, RootsResponse } from './types';

/** Error codes the client itself produces, in addition to the server's. */
export const NETWORK_CODE = 'network';
export const UNKNOWN_CODE = 'unknown';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** YAML line of a `project_invalid` error, when the server knows it. */
  readonly line?: number;

  constructor(status: number, code: string, message: string, line?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.line = line;
  }
}

/** Encode each path segment, keeping `/` separators. `""` stays `""`. */
export function encodePath(path: string): string {
  if (path === '') return '';
  return path.split('/').map(encodeURIComponent).join('/');
}

/** A project file: the root it lives in and its path relative to that root. */
export interface ProjectRef {
  root: string;
  path: string;
}

/** Where navigation links stay: a workspace folder or an open project (never both). */
export interface NavScope {
  /** `''` is the root folder as workspace (`?ws=`); `undefined` means no workspace. */
  ws?: string;
  project?: ProjectRef;
}

const ROOT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isProjectPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.mdv.yaml') || lower.endsWith('.mdv.yml');
}

/** A valid ref (root name pattern, project file suffix, no `..` segment) or `null`. */
export function makeProjectRef(root: string, path: string): ProjectRef | null {
  if (!ROOT_NAME_RE.test(root) || !isProjectPath(path)) return null;
  if (path.split('/').includes('..')) return null;
  return { root, path };
}

/** The `?project=` value: `encodeURIComponent(root) + ':' + encodePath(path)` (the SSE `sub` form). */
export function formatProject(ref: ProjectRef): string {
  return `${encodeURIComponent(ref.root)}:${encodePath(ref.path)}`;
}

/**
 * Parse the value of `?project=` as returned by `URLSearchParams.get` (the URL-level escapes are
 * already decoded). Split at the first `:`; anything invalid is ignored (`null`).
 */
export function parseProjectParam(value: string | null): ProjectRef | null {
  if (value === null) return null;
  const i = value.indexOf(':');
  if (i < 0) return null;
  return makeProjectRef(value.slice(0, i), value.slice(i + 1));
}

/**
 * Append the scope query. `project` wins over `ws`; a project is carried only to links in its own
 * root (a link to another root is an exit), and then `ws` is dropped as well.
 */
function withScope(href: string, root: string, scope?: NavScope): string {
  if (scope?.project) {
    return scope.project.root === root ? `${href}?project=${formatProject(scope.project)}` : href;
  }
  return scope?.ws !== undefined ? `${href}?ws=${encodeURIComponent(scope.ws)}` : href;
}

export function browseHref(root: string, path: string, scope?: NavScope): string {
  const base = `/browse/${encodeURIComponent(root)}`;
  return withScope(path ? `${base}/${encodePath(path)}` : base, root, scope);
}

export function viewHref(root: string, path: string, scope?: NavScope): string {
  const base = `/view/${encodeURIComponent(root)}`;
  return withScope(path ? `${base}/${encodePath(path)}` : base, root, scope);
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
  let line: number | undefined;
  try {
    const body: unknown = JSON.parse(await res.text());
    const err = (body as { error?: { code?: unknown; message?: unknown; line?: unknown } } | null)
      ?.error;
    if (typeof err?.code === 'string') code = err.code;
    if (typeof err?.message === 'string') message = err.message;
    if (typeof err?.line === 'number') line = err.line;
  } catch {
    // Non-JSON body (proxy error page, empty body): keep the fallbacks.
  }
  return new ApiError(res.status, code, message, line);
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

export function getPrefs(signal?: AbortSignal): Promise<PrefsResponse> {
  return getJSON<PrefsResponse>('/api/prefs', signal);
}

export function getProject(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<ProjectResponse> {
  return getJSON<ProjectResponse>(`/api/project?${query({ root, path })}`, signal);
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
