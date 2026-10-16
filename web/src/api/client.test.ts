import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  browseHref,
  encodePath,
  fileUrl,
  formatProject,
  getFile,
  getList,
  getRoots,
  makeProjectRef,
  parseProjectParam,
  renderD2,
  viewHref,
} from './client';
import { queryKeys, shouldRetry } from './hooks';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('href builders', () => {
  it('encodes each segment and keeps separators', () => {
    expect(encodePath('')).toBe('');
    expect(encodePath('a b/c#d/e?f/100%/héllo 日本')).toBe(
      'a%20b/c%23d/e%3Ff/100%25/h%C3%A9llo%20%E6%97%A5%E6%9C%AC',
    );
  });

  it('builds browse and view hrefs', () => {
    expect(browseHref('my root', '')).toBe('/browse/my%20root');
    expect(browseHref('r', 'docs/a b')).toBe('/browse/r/docs/a%20b');
    expect(viewHref('r', 'a#b/c?.md')).toBe('/view/r/a%23b/c%3F.md');
  });

  it('appends an encoded workspace', () => {
    expect(viewHref('r', 'x.md', { ws: 'my docs/sub' })).toBe('/view/r/x.md?ws=my%20docs%2Fsub');
    expect(browseHref('r', '', { ws: 'w' })).toBe('/browse/r?ws=w');
    expect(browseHref('r', 'a', { ws: '' })).toBe('/browse/r/a?ws=');
    expect(viewHref('r', 'x.md', { ws: '' })).toBe('/view/r/x.md?ws=');
    expect(viewHref('r', 'x.md', {})).toBe('/view/r/x.md');
  });

  it('builds file urls with query encoding', () => {
    expect(fileUrl('r', 'a b/c&d#e.png')).toBe('/api/file?root=r&path=a+b%2Fc%26d%23e.png');
    expect(fileUrl('r', 'a.png', '2026-01-02T03:04:05Z-10')).toBe(
      '/api/file?root=r&path=a.png&v=2026-01-02T03%3A04%3A05Z-10',
    );
  });
});

describe('project param', () => {
  const ref = { root: 'my-root', path: 'a b/c:d/100%/e.mdv.yaml' };
  const viaUrl = (value: string) => new URLSearchParams(`project=${value}`).get('project');

  it('formats as encoded root, colon, encoded path', () => {
    expect(formatProject({ root: 'r', path: 'a b/p.mdv.yml' })).toBe('r:a%20b/p.mdv.yml');
  });

  it('round-trips through the URL, including a colon and percent in the path', () => {
    expect(parseProjectParam(viaUrl(formatProject(ref)))).toEqual(ref);
    expect(
      parseProjectParam(viaUrl(formatProject({ root: 'r', path: '+x&y#z.MDV.YAML' }))),
    ).toEqual({ root: 'r', path: '+x&y#z.MDV.YAML' });
  });

  it('splits at the first colon only', () => {
    expect(parseProjectParam('r:a:b.mdv.yaml')).toEqual({ root: 'r', path: 'a:b.mdv.yaml' });
  });

  it('accepts both suffixes, any case, and the bare dotfile names', () => {
    expect(parseProjectParam('r:.mdv.yml')).toEqual({ root: 'r', path: '.mdv.yml' });
    expect(parseProjectParam('r:d/X.Mdv.Yaml')).not.toBeNull();
  });

  it('ignores a bad root, a bad suffix, a .. segment and malformed values', () => {
    expect(parseProjectParam(null)).toBeNull();
    expect(parseProjectParam('nocolon')).toBeNull();
    expect(parseProjectParam('Bad Root:p.mdv.yaml')).toBeNull();
    expect(parseProjectParam(':p.mdv.yaml')).toBeNull();
    expect(parseProjectParam('r:p.yaml')).toBeNull();
    expect(parseProjectParam('r:p.mdv.yaml.txt')).toBeNull();
    expect(parseProjectParam('r:../p.mdv.yaml')).toBeNull();
    expect(parseProjectParam('r:a/../b/p.mdv.yaml')).toBeNull();
    expect(makeProjectRef('r', '..a/p.mdv.yaml')).not.toBeNull();
  });
});

describe('NavScope hrefs', () => {
  const project = { root: 'r', path: 'd/p.mdv.yaml' };

  it('carries the project to links in its own root', () => {
    expect(viewHref('r', 'a b.md', { project })).toBe('/view/r/a%20b.md?project=r:d/p.mdv.yaml');
    expect(browseHref('r', '', { project })).toBe('/browse/r?project=r:d/p.mdv.yaml');
  });

  it('drops the project for a link to another root', () => {
    expect(viewHref('other', 'a.md', { project })).toBe('/view/other/a.md');
    expect(browseHref('other', '', { project, ws: 'x' })).toBe('/browse/other');
  });

  it('lets the project win over ws', () => {
    expect(viewHref('r', 'a.md', { project, ws: 'docs' })).toBe(
      '/view/r/a.md?project=r:d/p.mdv.yaml',
    );
  });
});

describe('requests', () => {
  it('fetches roots', async () => {
    const f = mockFetch(() => json({ roots: [{ name: 'a', watch: 'poll', available: true }] }));
    const res = await getRoots();
    expect(res.roots[0].name).toBe('a');
    expect(f.mock.calls[0][0]).toBe('/api/roots');
  });

  it('fetches a listing with encoded params', async () => {
    const f = mockFetch(() => json({ root: 'r', path: 'a b', truncated: false, entries: [] }));
    await getList('r', 'a b/#?%é');
    expect(f.mock.calls[0][0]).toBe('/api/list?root=r&path=a+b%2F%23%3F%25%C3%A9');
  });

  it('fetches file text, headers and force', async () => {
    const f = mockFetch(
      () =>
        new Response('# hi', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ETag: '"1-2-3"' },
        }),
    );
    const file = await getFile('r', 'a.md', { force: true });
    expect(file).toEqual({
      text: '# hi',
      contentType: 'text/plain; charset=utf-8',
      etag: '"1-2-3"',
    });
    expect(f.mock.calls[0][0]).toBe('/api/file?root=r&path=a.md&force=1');
  });

  it('defaults missing headers to empty strings', async () => {
    mockFetch(() => {
      const res = new Response('x');
      res.headers.delete('Content-Type');
      return res;
    });
    const file = await getFile('r', 'a.md');
    expect(file.etag).toBe('');
  });
});

describe('errors', () => {
  it('parses the error model', async () => {
    mockFetch(() => json({ error: { code: 'not_found', message: 'nope' } }, 404));
    const err = await getRoots().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'nope' });
  });

  it('surfaces 413 too_large from getFile', async () => {
    mockFetch(() => json({ error: { code: 'too_large', message: 'big' } }, 413));
    await expect(getFile('r', 'big.md')).rejects.toMatchObject({
      status: 413,
      code: 'too_large',
    });
  });

  it('survives non-JSON error bodies', async () => {
    mockFetch(
      () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(getList('r', '')).rejects.toMatchObject({
      status: 502,
      code: 'internal',
      message: 'Bad Gateway',
    });
  });

  it('survives JSON bodies of the wrong shape', async () => {
    mockFetch(() => json(null, 418));
    await expect(getRoots()).rejects.toMatchObject({ status: 418, code: 'unknown' });
    mockFetch(() => json({ error: 'x' }, 400));
    await expect(getRoots()).rejects.toMatchObject({ status: 400, code: 'unknown' });
  });

  it('uses the status when there is no status text', async () => {
    mockFetch(() => new Response('', { status: 503 }));
    await expect(getRoots()).rejects.toMatchObject({ message: 'HTTP 503' });
  });

  it('maps fetch failures to the network code', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(getRoots()).rejects.toMatchObject({ status: 0, code: 'network' });
    mockFetch(() => Promise.reject('weird'));
    await expect(getRoots()).rejects.toMatchObject({ code: 'network', message: 'Network error' });
  });

  it('rejects invalid JSON on success', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));
    await expect(getRoots()).rejects.toMatchObject({ code: 'internal' });
  });

  it('propagates aborts untouched and passes the signal', async () => {
    const ctrl = new AbortController();
    const f = mockFetch((_url, init) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return json({ roots: [] });
    });
    ctrl.abort();
    const err = await getRoots(ctrl.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
    expect(f.mock.calls[0][1]?.signal).toBe(ctrl.signal);
  });
});

describe('hooks helpers', () => {
  it('exposes stable query keys', () => {
    expect(queryKeys.roots()).toEqual(['roots']);
    expect(queryKeys.list('r', 'p')).toEqual(['list', 'r', 'p']);
    expect(queryKeys.file('r', 'p')).toEqual(['file', 'r', 'p', false]);
    expect(queryKeys.file('r', 'p', true)).toEqual(['file', 'r', 'p', true]);
  });

  it('never retries 4xx and retries others a limited number of times', () => {
    expect(shouldRetry(0, new ApiError(404, 'not_found', ''))).toBe(false);
    expect(shouldRetry(0, new ApiError(413, 'too_large', ''))).toBe(false);
    expect(shouldRetry(0, new ApiError(0, 'network', ''))).toBe(true);
    expect(shouldRetry(1, new ApiError(504, 'fs_timeout', ''))).toBe(true);
    expect(shouldRetry(2, new ApiError(500, 'internal', ''))).toBe(false);
    expect(shouldRetry(0, new Error('x'))).toBe(true);
  });
});

describe('renderD2', () => {
  it('POSTs source and theme and returns the SVG text', async () => {
    const fn = mockFetch(
      () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    );
    await expect(renderD2('a -> b', 'dark')).resolves.toBe('<svg/>');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('/api/render/d2');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ source: 'a -> b', theme: 'dark' });
  });

  it('sends a chosen layout', async () => {
    const fn = mockFetch(() => new Response('<svg/>'));
    await renderD2('a', 'light', undefined, 'elk');
    expect(JSON.parse(fn.mock.calls[0]![1]?.body as string)).toEqual({
      source: 'a',
      theme: 'light',
      layout: 'elk',
    });
  });

  it('parses the JSON error body into an ApiError', async () => {
    mockFetch(() => json({ error: { code: 'render_error', message: 'line 1' } }, 422));
    await expect(renderD2('x', 'light')).rejects.toMatchObject({
      status: 422,
      code: 'render_error',
      message: 'line 1',
    });
  });

  it('maps network failures and passes aborts through', async () => {
    mockFetch(() => {
      throw new TypeError('offline');
    });
    await expect(renderD2('x', 'light')).rejects.toMatchObject({ status: 0, code: 'network' });
    mockFetch(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(renderD2('x', 'light')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
