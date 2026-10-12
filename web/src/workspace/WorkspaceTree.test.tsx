import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';

const mtime = '2026-01-02T03:04:05Z';
const ent = (name: string, type: string, kind = 'other') => ({ name, type, kind, size: 1, mtime });
const bodies: Record<string, object[]> = {
  '': [ent('docs', 'dir'), ent('.git', 'dir'), ent('top.md', 'file', 'markdown')],
  docs: [ent('sub', 'dir'), ent('a.md', 'file', 'markdown')],
  'docs/sub': [ent('deep.md', 'file', 'markdown')],
};

beforeEach(() => {
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

const tree = () => screen.getByRole('navigation', { name: 'Sidebar' });

describe('WorkspaceTree', () => {
  it('auto-expands ancestors and marks the current file', async () => {
    renderAt('/view/r/docs/sub/deep.md?ws=');
    const current = await within(tree()).findByRole('link', { name: 'deep.md', current: 'page' });
    expect(current).toHaveAttribute('href', '/view/r/docs/sub/deep.md?ws=');
    expect(tree()).toHaveTextContent('top.md');
    expect(tree()).not.toHaveTextContent('.git');
  });

  it('lazy-loads a folder on expand and navigates keeping ws', async () => {
    const router = renderAt('/browse/r?ws=');
    await within(tree()).findByRole('link', { name: 'top.md' });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('path=docs'));
    await userEvent.click(screen.getByRole('button', { name: 'Expand docs' }));
    await userEvent.click(await within(tree()).findByRole('link', { name: 'a.md' }));
    expect(router.state.location.pathname).toBe('/view/r/docs/a.md');
    expect(router.state.location.search).toBe('?ws=');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse docs' }));
    expect(within(tree()).queryByRole('link', { name: 'a.md' })).not.toBeInTheDocument();
  });

  it('keeps the roots list without ws', async () => {
    renderAt('/browse/r');
    expect(await screen.findByRole('heading', { name: 'Roots' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  });
});
