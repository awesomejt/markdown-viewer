import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import { resetMdOnlyCache } from '../browse/mdOnly';
import { resetShowHiddenCache } from '../browse/showHidden';

const mtime = '2026-01-02T03:04:05Z';
const ent = (name: string, type: string, kind = 'other') => ({ name, type, kind, size: 1, mtime });
const bodies: Record<string, object[]> = {
  dir: [
    ent('sub', 'dir'),
    ent('a.md', 'file', 'markdown'),
    ent('b.md', 'file', 'markdown'),
    ent('c.txt', 'file', 'text'),
  ],
  other: [ent('keep.txt', 'file', 'text'), ent('x.md', 'file', 'markdown')],
};

beforeEach(() => {
  window.localStorage.clear();
  resetShowHiddenCache();
  resetMdOnlyCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/roots')) {
        return Response.json({ roots: [{ name: 'r', watch: 'poll', available: true }] });
      }
      if (url.startsWith('/api/list')) {
        const p = new URL(url, 'http://x').searchParams.get('path') ?? '';
        return Response.json({ root: 'r', path: p, truncated: false, entries: bodies[p] ?? [] });
      }
      return new Response('# T');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

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

const sidebar = () => screen.getByRole('navigation', { name: 'Sidebar' });

describe('FolderFiles', () => {
  it('lists sibling files, marks the current one and offers a workspace', async () => {
    renderAt('/view/r/dir/a.md');
    const list = await within(sidebar()).findByRole('list', { name: 'In this folder' });
    expect(within(list).getByRole('link', { name: 'a.md' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(list).getByRole('link', { name: 'b.md' })).toHaveAttribute(
      'href',
      '/view/r/dir/b.md',
    );
    expect(within(list).getByRole('link', { name: 'c.txt' })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: 'sub' })).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'Open as workspace' })).toHaveAttribute(
      'href',
      '/view/r/dir/a.md?ws=dir',
    );
    // The root list still renders below.
    expect(await within(sidebar()).findByRole('link', { name: 'r' })).toBeInTheDocument();
  });

  it('hides non-Markdown siblings when Markdown-only is on', async () => {
    window.localStorage.setItem('mdv-md-only', '1');
    resetMdOnlyCache();
    renderAt('/view/r/dir/a.md');
    const list = await within(sidebar()).findByRole('list', { name: 'In this folder' });
    expect(within(list).getByRole('link', { name: 'b.md' })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: 'c.txt' })).not.toBeInTheDocument();
  });

  it('keeps the current file even when Markdown-only would hide it', async () => {
    window.localStorage.setItem('mdv-md-only', '1');
    resetMdOnlyCache();
    renderAt('/view/r/other/keep.txt');
    const list = await within(sidebar()).findByRole('list', { name: 'In this folder' });
    expect(within(list).getByRole('link', { name: 'keep.txt' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(list).getByRole('link', { name: 'x.md' })).toBeInTheDocument();
  });

  it('navigates to a sibling without ws', async () => {
    const router = renderAt('/view/r/dir/a.md');
    await userEvent.click(await within(sidebar()).findByRole('link', { name: 'b.md' }));
    expect(router.state.location.pathname).toBe('/view/r/dir/b.md');
    expect(router.state.location.search).toBe('');
  });

  it('is absent in a workspace and on browse routes', async () => {
    renderAt('/view/r/dir/a.md?ws=dir');
    await within(sidebar()).findByRole('link', { name: 'b.md' });
    expect(screen.queryByRole('heading', { name: 'In this folder' })).not.toBeInTheDocument();
  });
});
