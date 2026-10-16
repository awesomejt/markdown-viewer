import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';

const entry = (path: string, kind: string, type = 'file') => ({
  root: 'r',
  path,
  type,
  kind,
  ref: path,
  line: 2,
});

const base = { root: 'r', open: null, entries: [], settings: {}, warnings: [], name: null };

const PROJECTS: Record<string, unknown> = {
  // open is a file: landing is that file, never a loop.
  'a.mdv.yaml': {
    ...base,
    path: 'a.mdv.yaml',
    name: 'Project A',
    open: { root: 'r', path: 'docs/start.md', kind: 'markdown' },
    entries: [entry('b.mdv.yaml', 'project'), entry('docs/start.md', 'markdown')],
    settings: { fontSize: 20 },
  },
  // Only another project file is listed: no Markdown to land on, so the home.
  'b.mdv.yaml': {
    ...base,
    path: 'b.mdv.yaml',
    name: 'Project B',
    entries: [entry('a.mdv.yaml', 'project'), entry('notes', 'other', 'dir')],
    settings: { fontSize: 22 },
  },
  'c.mdv.yaml': {
    ...base,
    path: 'c.mdv.yaml',
    entries: [entry('c1.md', 'markdown')],
    warnings: [{ code: 'missing', message: 'No such file', ref: 'gone.md', line: 7 }],
  },
  'plain.mdv.yaml': { ...base, path: 'plain.mdv.yaml', entries: [entry('p1.md', 'markdown')] },
};

let projectCalls: string[] = [];
let gates: Record<string, Promise<void>> = {};

beforeEach(() => {
  window.localStorage.clear();
  projectCalls = [];
  gates = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url, 'http://x');
      const path = u.searchParams.get('path') ?? '';
      switch (u.pathname) {
        case '/api/roots':
          return Response.json({ roots: [{ name: 'r', watch: 'poll', available: true }] });
        case '/api/prefs':
          return Response.json({ configured: false, settings: {}, warnings: [], error: null });
        case '/api/file':
          return new Response('# Hello\n\nversion: 1\n', {
            headers: { 'Content-Type': 'text/markdown' },
          });
        case '/api/project': {
          projectCalls.push(path);
          await gates[path];
          if (path.endsWith('dead.mdv.yaml')) {
            return Response.json(
              { error: { code: 'not_found', message: 'nope' } },
              { status: 404 },
            );
          }
          if (path === 'bad.mdv.yaml') {
            return Response.json(
              { error: { code: 'project_invalid', message: 'bad indent', line: 3 } },
              { status: 422 },
            );
          }
          if (path === 'slow.mdv.yaml') {
            return Response.json(
              { error: { code: 'fs_timeout', message: 'slow' } },
              { status: 504 },
            );
          }
          return Response.json(PROJECTS[path]);
        }
        case '/api/list':
          if (path === 'sub') {
            return Response.json({
              root: 'r',
              path: 'sub',
              truncated: false,
              entries: [
                {
                  name: 'zed.md',
                  type: 'file',
                  kind: 'markdown',
                  size: 1,
                  mtime: '2026-01-02T03:04:05Z',
                },
              ],
            });
          }
          return new Response('', { status: 404 });
        default:
          return new Response('', { status: 404 }); // listings: the kind falls back to the name
      }
    }),
  );
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const visited: string[] = [];
  router.subscribe((s) => visited.push(s.location.pathname + s.location.search));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, visited };
}

const where = (r: ReturnType<typeof renderAt>) =>
  r.router.state.location.pathname + r.router.state.location.search;
const fontSize = () => document.documentElement.style.getPropertyValue('--mdv-font-size');
const main = () => within(document.querySelector('main') as HTMLElement);
const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));

describe('entering a project', () => {
  it('redirects once to open and applies the project settings', async () => {
    const r = renderAt('/view/r/a.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/docs/start.md?project=r:a.mdv.yaml'));
    expect(await main().findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    await waitFor(() => expect(fontSize()).toBe('20px'));
    await settle();
    expect(r.visited).toEqual(['/view/r/docs/start.md?project=r:a.mdv.yaml']);
  });

  it('lands on the first Markdown entry when open is null', async () => {
    const r = renderAt('/view/r/c.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/c1.md?project=r:c.mdv.yaml'));
  });

  it('shows the project home when there is nothing to open, without a loop', async () => {
    const r = renderAt('/view/r/b.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/b.mdv.yaml?project=r:b.mdv.yaml'));
    expect(await main().findByRole('heading', { name: 'Project B' })).toBeInTheDocument();
    await settle();
    expect(r.visited).toEqual(['/view/r/b.mdv.yaml?project=r:b.mdv.yaml']);
    // Entries carry the project.
    expect(main().getByRole('link', { name: 'notes' })).toHaveAttribute(
      'href',
      '/browse/r/notes?project=r:b.mdv.yaml',
    );
  });

  it('switches when an included project file is opened, once, never at path == param', async () => {
    const r = renderAt('/view/r/b.mdv.yaml?project=r:b.mdv.yaml');
    expect(await main().findByRole('heading', { name: 'Project B' })).toBeInTheDocument();
    expect(r.visited).toEqual([]);
    await userEvent.click(main().getByRole('link', { name: 'a.mdv.yaml' }));
    await waitFor(() => expect(where(r)).toBe('/view/r/docs/start.md?project=r:a.mdv.yaml'));
    await settle();
    expect(r.visited.filter((v) => v.includes('project=r:a.mdv.yaml'))).toHaveLength(1);
    expect(r.visited).toHaveLength(2); // the click, then the single redirect
  });

  it('lands on the project home when the new project fails to load', async () => {
    const r = renderAt('/view/r/dead.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/dead.mdv.yaml?project=r:dead.mdv.yaml'));
    expect(await main().findByRole('link', { name: 'Close project' })).toBeInTheDocument();
  });

  it('shows the project home with title, source toggle and warnings', async () => {
    renderAt('/view/r/c.mdv.yaml?project=r:c.mdv.yaml');
    expect(await main().findByRole('heading', { name: 'c.mdv.yaml' })).toBeInTheDocument();
    expect(main().getByText('gone.md').tagName).toBe('CODE');
    expect(main().getByText(/line 7/)).toBeInTheDocument();
    await userEvent.click(main().getByRole('link', { name: 'Source' }));
    expect(await main().findByText(/version: 1/)).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Project' })).toHaveAttribute(
      'href',
      '/view/r/c.mdv.yaml?project=r:c.mdv.yaml',
    );
  });
});

describe('staying in a project', () => {
  it('drops the param on the explicit exits: the root list and Home', async () => {
    const r = renderAt('/view/r/plain.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/p1.md?project=r:plain.mdv.yaml'));
    expect(screen.getByRole('link', { name: 'r' })).toHaveAttribute('href', '/browse/r');
    await userEvent.click(screen.getByRole('link', { name: 'Markdown Viewer' }));
    await waitFor(() => expect(where(r)).toBe('/'));
  });

  it('ignores a malformed param (no project query)', async () => {
    renderAt('/browse/r?project=r:..%2Fx.mdv.yaml');
    await settle();
    expect(projectCalls).toEqual([]);
  });
});

describe('settings isolation', () => {
  it('never shows project A settings while B loads, and restores them on close', async () => {
    let release = () => {};
    const r = renderAt('/view/r/p1.md?project=r:a.mdv.yaml');
    await waitFor(() => expect(fontSize()).toBe('20px'));
    gates['b.mdv.yaml'] = new Promise<void>((res) => (release = res));
    await act(() => r.router.navigate('/view/r/b.mdv.yaml?project=r:b.mdv.yaml'));
    // B is pending: A's settings are gone, B's are not yet applied, the outlet is held.
    await waitFor(() => expect(fontSize()).toBe('16px'));
    expect(main().getByRole('status')).toBeInTheDocument();
    release();
    await waitFor(() => expect(fontSize()).toBe('22px'));
    await act(() => r.router.navigate('/browse/r'));
    await waitFor(() => expect(fontSize()).toBe('16px'));
  });
});

describe('initial error states', () => {
  it('dead project: message and a Close project link that drops only the param', async () => {
    renderAt('/view/r/x.md?ws=docs&project=r:dead.mdv.yaml');
    const close = await main().findByRole('link', { name: 'Close project' });
    expect(close).toHaveAttribute('href', '/view/r/x.md?ws=docs');
    expect(main().queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('Close project on the project file itself leaves it for the folder listing', async () => {
    renderAt('/view/r/sub/dead.mdv.yaml?project=r:sub/dead.mdv.yaml');
    const close = await main().findByRole('link', { name: 'Close project' });
    expect(close).toHaveAttribute('href', '/browse/r/sub');
    await userEvent.click(close);
    expect(await main().findByRole('link', { name: 'zed.md' })).toBeInTheDocument();
    expect(main().queryByRole('link', { name: 'Close project' })).toBeNull();
  });

  it('422: message, YAML line and Show source keeping the param', async () => {
    renderAt('/view/r/bad.mdv.yaml?project=r:bad.mdv.yaml');
    expect(await main().findByText('bad indent')).toBeInTheDocument();
    expect(main().getByText('YAML line 3')).toBeInTheDocument();
    const source = main().getByRole('link', { name: 'Show source' });
    expect(source).toHaveAttribute('href', '/view/r/bad.mdv.yaml?project=r:bad.mdv.yaml&source=1');
    await userEvent.click(source);
    expect(await main().findByText(/version: 1/)).toBeInTheDocument();
    expect(main().queryByText('YAML line 3')).toBeNull();
  });

  it('504: Retry refetches, and Close project is offered', async () => {
    renderAt('/browse/r?project=r:slow.mdv.yaml');
    const retry = await main().findByRole('button', { name: 'Retry' });
    expect(main().getByRole('link', { name: 'Close project' })).toHaveAttribute(
      'href',
      '/browse/r',
    );
    const before = projectCalls.length;
    await userEvent.click(retry);
    await waitFor(() => expect(projectCalls.length).toBeGreaterThan(before));
  });
});
