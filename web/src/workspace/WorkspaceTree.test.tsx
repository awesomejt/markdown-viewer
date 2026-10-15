import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import { resetMdOnlyCache } from '../browse/mdOnly';
import { resetShowHiddenCache } from '../browse/showHidden';
import { LiveProvider } from '../live/LiveProvider';

const mtime = '2026-01-02T03:04:05Z';
const ent = (name: string, type: string, kind = 'other') => ({ name, type, kind, size: 1, mtime });
const bodies: Record<string, object[]> = {
  '': [
    ent('docs', 'dir'),
    ent('.git', 'dir'),
    ent('top.md', 'file', 'markdown'),
    ent('notes.txt', 'file', 'text'),
    ent('pic.png', 'file', 'image'),
  ],
  docs: [ent('sub', 'dir'), ent('a.md', 'file', 'markdown')],
  'docs/sub': [ent('deep.md', 'file', 'markdown')],
  many: Array.from({ length: 450 }, (_, i) =>
    ent(`n${String(i).padStart(3, '0')}.md`, 'file', 'markdown'),
  ),
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

function renderAt(path: string, live = false) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = <RouterProvider router={router} />;
  render(
    <QueryClientProvider client={client}>
      {live ? <LiveProvider>{app}</LiveProvider> : app}
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

  it('follows the browse view show-hidden toggle', async () => {
    renderAt('/browse/r?ws=');
    await within(tree()).findByRole('link', { name: 'top.md' });
    expect(within(tree()).queryByRole('link', { name: '.git' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show hidden files' }));
    expect(within(tree()).getByRole('link', { name: '.git' })).toBeInTheDocument();
  });

  it('follows the browse view markdown-only toggle', async () => {
    renderAt('/browse/r?ws=');
    await within(tree()).findByRole('link', { name: 'top.md' });
    expect(within(tree()).getByRole('link', { name: 'notes.txt' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Markdown/diagrams only' }));
    expect(within(tree()).queryByRole('link', { name: 'notes.txt' })).not.toBeInTheDocument();
    expect(within(tree()).queryByRole('link', { name: 'pic.png' })).not.toBeInTheDocument();
    expect(within(tree()).getByRole('link', { name: 'docs' })).toBeInTheDocument();
    expect(within(tree()).getByRole('link', { name: 'top.md' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Markdown/diagrams only' }));
    expect(within(tree()).getByRole('link', { name: 'notes.txt' })).toBeInTheDocument();
  });

  it('keeps the viewed non-Markdown file when markdown-only is on', async () => {
    window.localStorage.setItem('mdv-md-only', '1');
    renderAt('/view/r/notes.txt?ws=');
    await within(tree()).findByRole('link', { name: 'top.md' });
    expect(
      within(tree()).getByRole('link', { name: 'notes.txt', current: 'page' }),
    ).toBeInTheDocument();
    expect(within(tree()).queryByRole('link', { name: 'pic.png' })).not.toBeInTheDocument();
  });

  it('keeps the roots list without ws', async () => {
    renderAt('/browse/r');
    expect(await screen.findByRole('heading', { name: 'Roots' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  });

  it('watches every shown folder at low priority while it is expanded', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'EventSource',
      class {
        readyState = 0;
        onopen = null;
        onerror = null;
        constructor(url: string) {
          urls.push(url);
        }
        addEventListener() {}
        close() {}
      },
    );
    const params = () => new URL(urls.at(-1) ?? '/', 'http://x').searchParams;
    // Tree folders go out as low-priority `lsub`; the viewed file is a normal `sub`.
    const subs = () => [...params().getAll('sub'), ...params().getAll('lsub')];
    renderAt('/view/r/top.md?ws=', true);
    await within(tree()).findByRole('link', { name: 'top.md' });
    // The viewed file comes first: tree folders only fill the slots it leaves.
    await waitFor(() => expect(subs()).toEqual(['r:top.md', 'r:']));
    await userEvent.click(screen.getByRole('button', { name: 'Expand docs' }));
    await waitFor(() => expect(subs()).toEqual(['r:top.md', 'r:', 'r:docs']));
    await userEvent.click(screen.getByRole('button', { name: 'Collapse docs' }));
    await waitFor(() => expect(subs()).toEqual(['r:top.md', 'r:']));
  });

  it('pages a long folder and always shows the current file', async () => {
    renderAt('/view/r/many/n300.md?ws=many');
    const current = await within(tree()).findByRole('link', { name: 'n300.md', current: 'page' });
    expect(current).toBeInTheDocument();
    expect(within(tree()).queryByRole('link', { name: 'n301.md' })).not.toBeInTheDocument();
    await userEvent.click(within(tree()).getByRole('button', { name: 'Show more (149 left)' }));
    expect(within(tree()).getByRole('link', { name: 'n449.md' })).toBeInTheDocument();
    expect(within(tree()).queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('shows the first page of a long folder', async () => {
    renderAt('/browse/r/many?ws=many');
    await within(tree()).findByRole('link', { name: 'n199.md' });
    expect(within(tree()).queryByRole('link', { name: 'n200.md' })).not.toBeInTheDocument();
    await userEvent.click(within(tree()).getByRole('button', { name: 'Show more (250 left)' }));
    expect(within(tree()).getByRole('link', { name: 'n399.md' })).toBeInTheDocument();
    expect(within(tree()).getByRole('button', { name: 'Show more (50 left)' })).toBeInTheDocument();
  });
});
