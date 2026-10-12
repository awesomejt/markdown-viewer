import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import {
  clearRecent,
  parseRecent,
  pushRecent,
  RECENT_MAX,
  recordRecent,
  resetRecentCache,
  useRecent,
  type RecentItem,
} from './recent';

const KEY = 'mdv-recent';
const file = (path: string, ws?: string): RecentItem =>
  ws === undefined ? { root: 'r', path, type: 'file' } : { root: 'r', path, type: 'file', ws };

beforeEach(() => {
  window.localStorage.clear();
  resetRecentCache();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pushRecent', () => {
  it('puts the item first, de-duplicates, and caps the list', () => {
    let list: RecentItem[] = [];
    for (let i = 0; i < RECENT_MAX + 2; i++) list = pushRecent(list, file(`f${i}.md`));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].path).toBe(`f${RECENT_MAX + 1}.md`);
    list = pushRecent(list, file('f5.md', 'ws'));
    expect(list[0]).toEqual(file('f5.md', 'ws'));
    expect(list.filter((r) => r.path === 'f5.md')).toHaveLength(1);
  });

  it('keeps a folder and a file with the same path apart', () => {
    const list = pushRecent([file('a')], { root: 'r', path: 'a', type: 'dir' });
    expect(list).toHaveLength(2);
  });
});

describe('parseRecent', () => {
  it('drops malformed data', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent('{"root":"r"}')).toEqual([]);
    const raw = JSON.stringify([
      { root: 'r', path: 'a.md', type: 'file', extra: 1 },
      { root: '', path: 'x', type: 'file' },
      { root: 'r', path: 'x', type: 'link' },
      { root: 'r', path: 'd', type: 'dir', ws: 7 },
      { root: 'r', path: 'd', type: 'dir', ws: '' },
      null,
    ]);
    expect(parseRecent(raw)).toEqual([file('a.md'), { root: 'r', path: 'd', type: 'dir', ws: '' }]);
  });
});

describe('recent store', () => {
  it('records, persists, shares between hooks and clears', () => {
    const a = renderHook(() => useRecent());
    const b = renderHook(() => useRecent());
    act(() => recordRecent(file('a.md')));
    act(() => recordRecent(file('b.md')));
    expect(b.result.current[0].map((r) => r.path)).toEqual(['b.md', 'a.md']);
    expect(parseRecent(window.localStorage.getItem(KEY))).toHaveLength(2);
    act(() => a.result.current[1]());
    expect(b.result.current[0]).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('does not rewrite storage when the newest item is opened again', () => {
    recordRecent(file('a.md'));
    const set = vi.spyOn(Storage.prototype, 'setItem');
    recordRecent(file('a.md'));
    expect(set).not.toHaveBeenCalled();
    recordRecent(file('a.md', 'ws'));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('follows changes from other tabs', () => {
    const { result } = renderHook(() => useRecent());
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify([file('x.md')]));
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(result.current[0]).toEqual([file('x.md')]);
    act(() => {
      window.localStorage.removeItem(KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    });
    expect(result.current[0]).toEqual([file('x.md')]);
  });

  it('works in memory when storage is unavailable', () => {
    for (const m of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error('blocked');
      });
    }
    const { result } = renderHook(() => useRecent());
    expect(result.current[0]).toEqual([]);
    act(() => recordRecent(file('a.md')));
    expect(result.current[0]).toEqual([file('a.md')]);
    act(() => clearRecent());
    expect(result.current[0]).toEqual([]);
  });
});

describe('recording and the recent list', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/roots')) {
          return Response.json({ roots: [{ name: 'r', available: true }] });
        }
        if (url.startsWith('/api/list')) {
          const p = new URL(url, 'http://x').searchParams.get('path') ?? '';
          const entries =
            p === 'docs'
              ? [
                  {
                    name: 'n.txt',
                    type: 'file',
                    kind: 'text',
                    size: 4,
                    mtime: '2026-01-02T03:04:05Z',
                  },
                ]
              : [];
          return Response.json({ root: 'r', path: p, truncated: false, entries });
        }
        return new Response('text');
      }),
    );
  });

  function renderAt(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it('records opened files and folders, not missing files or the root', async () => {
    renderAt('/view/r/docs/n.txt?ws=docs');
    await screen.findByText('text');
    await waitFor(() => expect(window.localStorage.getItem(KEY)).not.toBeNull());
    cleanup();

    // Outside a workspace the sidebar lists recent items under the roots.
    renderAt('/browse/r/docs');
    await screen.findByRole('link', { name: 'n.txt' });
    const sidebar = await screen.findByRole('list', { name: 'Recent' });
    expect(within(sidebar).getByRole('link', { name: /^n\.txt/ })).toHaveAttribute(
      'href',
      '/view/r/docs/n.txt?ws=docs',
    );
    cleanup();
    renderAt('/browse/r');
    await screen.findByText('This folder is empty.');
    cleanup();
    renderAt('/view/r/docs/missing.md');
    await screen.findByRole('heading', { name: 'Recent' });
    cleanup();

    expect(parseRecent(window.localStorage.getItem(KEY))).toEqual([
      { root: 'r', path: 'docs', type: 'dir' },
      { root: 'r', path: 'docs/n.txt', type: 'file', ws: 'docs' },
    ]);
  });

  it('lists recent items on the home page only once, and clears them', async () => {
    recordRecent({ root: 'r', path: 'docs', type: 'dir' });
    recordRecent(file('docs/n.txt'));
    renderAt('/');
    const list = await screen.findByRole('list', { name: 'Recent' });
    expect(screen.getAllByRole('list', { name: 'Recent' })).toHaveLength(1);
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/view/r/docs/n.txt',
      '/browse/r/docs',
    ]);
    expect(links[0]).toHaveTextContent('n.txt');
    expect(links[0]).toHaveTextContent('r/docs');
    await userEvent.click(screen.getByRole('button', { name: 'Clear recent' }));
    expect(screen.queryByRole('list', { name: 'Recent' })).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
