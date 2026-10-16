import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import { resetMdOnlyCache } from './mdOnly';
import { resetShowHiddenCache } from './showHidden';

const mtime = '2026-01-02T03:04:05Z';
const listing = (path: string, entries: object[], truncated = false) => ({
  root: 'r',
  path,
  truncated,
  entries,
});
const f = (name: string, kind: string) => ({ name, type: 'file', kind, size: 2048, mtime });

const bodies: Record<string, unknown> = {
  '': listing('', [
    { name: 'docs', type: 'dir', kind: 'other', size: 0, mtime },
    { name: '.git', type: 'dir', kind: 'other', size: 0, mtime },
    f('README.md', 'markdown'),
    f('data.bin', 'other'),
  ]),
  docs: listing('docs', [f('a.md', 'markdown')]),
  proj: listing('proj', [f('course.mdv.yaml', 'project'), f('notes.bin', 'other')]),
  empty: listing('empty', []),
  big: listing('big', [f('x.md', 'markdown')], true),
  many: listing(
    'many',
    Array.from({ length: 1000 }, (_, i) => f(`f${String(i).padStart(4, '0')}.md`, 'markdown')),
  ),
};

let prefsBody: unknown = { configured: false, settings: {}, warnings: [], error: null };

beforeEach(() => {
  prefsBody = { configured: false, settings: {}, warnings: [], error: null };
  window.localStorage.clear();
  resetShowHiddenCache();
  resetMdOnlyCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/roots')) {
        return Response.json({ roots: [{ name: 'r', watch: 'poll', available: true }] });
      }
      if (url.startsWith('/api/prefs')) return Response.json(prefsBody);
      const p = new URL(url, 'http://x').searchParams.get('path') ?? '';
      return p in bodies ? Response.json(bodies[p]) : new Response('', { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe('BrowseView', () => {
  it('lists entries, hides dot-files, links dirs and files', async () => {
    renderAt('/browse/r?ws=docs');
    const list = await screen.findByRole('list', { name: 'Entries' });
    expect(within(list).queryByText('.git')).toBeNull();
    expect(within(list).getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      '/browse/r/docs?ws=docs',
    );
    expect(within(list).getByRole('link', { name: 'README.md' })).toHaveAttribute(
      'href',
      '/view/r/README.md',
    );
    expect(within(list).getAllByText('2 KB')).toHaveLength(2);
  });

  it('filters by name and by markdown-only (persisted)', async () => {
    const user = userEvent.setup();
    renderAt('/browse/r');
    const list = await screen.findByRole('list', { name: 'Entries' });
    await user.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'DATA');
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Filter by name' }));
    await user.click(screen.getByRole('checkbox', { name: 'Markdown/diagrams only' }));
    expect(within(list).queryByText('data.bin')).toBeNull();
    expect(window.localStorage.getItem('mdv-md-only')).toBe('1');
  });

  it('shows a project icon for *.mdv.yaml entries, links to the view, and md-only keeps them', async () => {
    const user = userEvent.setup();
    renderAt('/browse/r/proj');
    const list = await screen.findByRole('list', { name: 'Entries' });
    const link = within(list).getByRole('link', { name: 'course.mdv.yaml' });
    expect(link).toHaveAttribute('href', '/view/r/proj/course.mdv.yaml');
    expect(link.parentElement?.querySelector('svg.kind-project')).not.toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Markdown/diagrams only' }));
    expect(within(list).getByRole('link', { name: 'course.mdv.yaml' })).toBeInTheDocument();
    expect(within(list).queryByText('notes.bin')).toBeNull();
    expect(screen.getByText('Markdown/diagrams only').closest('label')).toHaveAttribute(
      'title',
      expect.stringMatching(/project/i),
    );
  });

  it('Projects only keeps folders and project files, and is not persisted', async () => {
    const user = userEvent.setup();
    bodies['mixed'] = listing('mixed', [
      { name: 'sub', type: 'dir', kind: 'other', size: 0, mtime },
      f('course.mdv.yaml', 'project'),
      f('a.md', 'markdown'),
      f('b.bin', 'other'),
    ]);
    renderAt('/browse/r/mixed');
    const list = await screen.findByRole('list', { name: 'Entries' });
    const toggle = screen.getByRole('checkbox', { name: 'Projects only' });
    expect(toggle).not.toBeChecked();
    expect(toggle.closest('label')).toHaveAttribute(
      'title',
      'Show only project files (folders always stay)',
    );
    await user.click(toggle);
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['sub', 'course.mdv.yaml']);
    expect(window.localStorage.getItem('mdv-md-only')).toBeNull();
    expect(window.localStorage.getItem('mdv-projects-only')).toBeNull();
    await user.click(toggle);
    expect(within(list).getAllByRole('link')).toHaveLength(4);
    delete bodies['mixed'];
  });

  it('shows hidden files when toggled (persisted)', async () => {
    const user = userEvent.setup();
    renderAt('/browse/r');
    const list = await screen.findByRole('list', { name: 'Entries' });
    const toggle = screen.getByRole('checkbox', { name: 'Show hidden files' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(within(list).getByRole('link', { name: '.git' })).toHaveAttribute(
      'href',
      '/browse/r/.git',
    );
    expect(window.localStorage.getItem('mdv-show-hidden')).toBe('1');
    await user.click(toggle);
    expect(within(list).queryByText('.git')).toBeNull();
    expect(window.localStorage.getItem('mdv-show-hidden')).toBe('0');
  });

  it('restores a persisted show-hidden choice', async () => {
    window.localStorage.setItem('mdv-show-hidden', '1');
    renderAt('/browse/r');
    const list = await screen.findByRole('list', { name: 'Entries' });
    expect(within(list).getByRole('link', { name: '.git' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show hidden files' })).toBeChecked();
  });

  it('sorts by date and persists the choice', async () => {
    const user = userEvent.setup();
    bodies.sorted = listing('sorted', [
      { ...f('a.md', 'markdown'), mtime: '2026-01-01T00:00:00Z' },
      { ...f('b.md', 'markdown'), mtime: '2026-03-01T00:00:00Z' },
      { ...f('c.md', 'markdown'), mtime: '2026-02-01T00:00:00Z' },
    ]);
    renderAt('/browse/r/sorted');
    const list = await screen.findByRole('list', { name: 'Entries' });
    const order = () =>
      within(list)
        .getAllByRole('link')
        .map((l) => l.textContent);
    expect(order()).toEqual(['a.md', 'b.md', 'c.md']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'date');
    expect(order()).toEqual(['b.md', 'c.md', 'a.md']);
    expect(window.localStorage.getItem('mdv-sort')).toBe('date');
  });

  it('takes sort, show-hidden and Markdown-only from preferences; a device choice wins', async () => {
    prefsBody = {
      configured: true,
      settings: { sort: 'date', showHidden: true, markdownOnly: true },
      warnings: [],
      error: null,
    };
    const user = userEvent.setup();
    renderAt('/browse/r');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('date'),
    );
    expect(screen.getByRole('checkbox', { name: 'Show hidden files' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Markdown\/diagrams only/ })).toBeChecked();
    expect(window.localStorage.getItem('mdv-sort')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Show hidden files' }));
    expect(screen.getByRole('checkbox', { name: 'Show hidden files' })).not.toBeChecked();
    expect(window.localStorage.getItem('mdv-show-hidden')).toBe('0');
  });

  it('restores a persisted sort choice', async () => {
    window.localStorage.setItem('mdv-sort', 'date');
    renderAt('/browse/r');
    await screen.findByRole('list', { name: 'Entries' });
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('date');
  });

  it('resets the filter when navigating to another folder', async () => {
    const user = userEvent.setup();
    renderAt('/browse/r');
    await screen.findByRole('list', { name: 'Entries' });
    await user.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'do');
    await user.click(screen.getByRole('link', { name: 'docs' }));
    await screen.findByRole('link', { name: 'a.md' });
    expect(screen.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('');
  });

  it('shows the empty state', async () => {
    renderAt('/browse/r/empty');
    expect(await screen.findByText('This folder is empty.')).toBeInTheDocument();
  });

  it('shows a truncation notice', async () => {
    renderAt('/browse/r/big');
    expect(await screen.findByText(/only the first entries/)).toBeInTheDocument();
  });

  it('opens a workspace on the README, or on the folder, with ws set', async () => {
    const user = userEvent.setup();
    const router = renderAt('/browse/r');
    await user.click(await screen.findByRole('button', { name: 'Open as workspace' }));
    expect(router.state.location.pathname + router.state.location.search).toBe(
      '/view/r/README.md?ws=',
    );
  });

  it('opens a workspace on the folder when it has no README', async () => {
    const user = userEvent.setup();
    const router = renderAt('/browse/r/docs');
    await user.click(await screen.findByRole('button', { name: 'Open as workspace' }));
    expect(router.state.location.pathname + router.state.location.search).toBe(
      '/browse/r/docs?ws=docs',
    );
    expect(await screen.findByText(/Workspace:/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Exit workspace' }));
    expect(router.state.location.search).toBe('');
  });

  it('renders breadcrumbs with the current page marked', async () => {
    renderAt('/browse/r/docs');
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'r' })).toHaveAttribute('href', '/browse/r');
    expect(within(nav).getByText('docs')).toHaveAttribute('aria-current', 'page');
  });

  it('renders only the rows near the viewport for a long folder', async () => {
    // jsdom has no layout: give every element a row's height so the virtualizer measures something.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(45);
    renderAt('/browse/r/many');
    const list = await screen.findByRole('list', { name: 'Entries' });
    const rows = await within(list).findAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]).toHaveAttribute('aria-posinset', '1');
    expect(rows[0]).toHaveAttribute('aria-setsize', '1000');
    expect(within(list).queryByRole('link', { name: 'f0999.md' })).not.toBeInTheDocument();

    // The filter reaches every entry; a short result renders as a plain list.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'f0999');
    const only = within(screen.getByRole('list', { name: 'Entries' })).getByRole('listitem');
    expect(only).not.toHaveAttribute('aria-setsize');
    expect(within(only).getByRole('link', { name: 'f0999.md' })).toHaveAttribute(
      'href',
      '/view/r/many/f0999.md',
    );
  });
});
