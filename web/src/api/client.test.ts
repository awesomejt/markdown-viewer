import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  browseHref,
  encodePath,
  fileUrl,
  getFile,
  getList,
  getRoots,
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
    expect(viewHref('r', 'x.md', 'my docs/sub')).toBe('/view/r/x.md?ws=my%20docs%2Fsub');
    expect(browseHref('r', '', 'w')).toBe('/browse/r?ws=w');
  });

  it('builds file urls with query encoding', () => {
    expect(fileUrl('r', 'a b/c&d#e.png')).toBe('/api/file?root=r&path=a+b%2Fc%26d%23e.png');
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
