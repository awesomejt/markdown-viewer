import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import { useLiveSubscription } from '../live/LiveProvider';
import { resetRecentCache } from '../recent/recent';
import { parseRecentProjects, resetRecentProjectsCache } from '../recent/recentProjects';

vi.mock('../live/LiveProvider', async (orig) => ({
  ...(await orig<typeof import('../live/LiveProvider')>()),
  useLiveSubscription: vi.fn(),
}));

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
  // Sidebar fixture: a folder entry, a file entry, an unknown style, a server warning.
  's.mdv.yaml': {
    ...base,
    path: 's.mdv.yaml',
    name: 'Sidebar project',
    open: { root: 'r', path: 'docs/start.md', kind: 'markdown' },
    entries: [entry('sub', 'other', 'dir'), entry('docs/start.md', 'markdown')],
    settings: { fontSize: 24, style: 'fancy' },
    warnings: [{ code: 'missing', message: 'No such file', ref: 'gone.md', line: 7 }],
  },
  'plain.mdv.yaml': { ...base, path: 'plain.mdv.yaml', entries: [entry('p1.md', 'markdown')] },
};

let projectCalls: string[] = [];
/** Per project path: answer with this instead of the table (keep-last-good transitions). */
let overrides: Record<string, () => Response> = {};
let gates: Record<string, Promise<void>> = {};

beforeEach(() => {
  window.localStorage.clear();
  projectCalls = [];
  overrides = {};
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
          if (overrides[path]) return overrides[path]();
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
  vi.mocked(useLiveSubscription).mockClear();
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

  it('fetches the project once when entering through its file route', async () => {
    const r = renderAt('/view/r/a.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/docs/start.md?project=r:a.mdv.yaml'));
    await main().findByRole('heading', { name: 'Hello' });
    await settle();
    expect(projectCalls).toEqual(['a.mdv.yaml']);
  });
});

describe('project live subscription', () => {
  const projectSubs = (path: string) =>
    vi
      .mocked(useLiveSubscription)
      .mock.calls.filter(([root, p]) => root === 'r' && p === path)
      .map(([, , low]) => low);

  it('is low priority before the project loads and normal after', async () => {
    let release = () => {};
    gates['plain.mdv.yaml'] = new Promise<void>((res) => (release = res));
    renderAt('/view/r/p1.md?project=r:plain.mdv.yaml');
    await waitFor(() => expect(projectCalls).toEqual(['plain.mdv.yaml']));
    expect(projectSubs('plain.mdv.yaml')).toEqual([true]);
    release();
    await sidebar().findByRole('region', { name: 'Project' });
    await waitFor(() => expect(projectSubs('plain.mdv.yaml').at(-1)).toBe(false));
  });
});

describe('staying in a project', () => {
  it('drops the param on the explicit exit Home', async () => {
    const r = renderAt('/view/r/plain.mdv.yaml');
    await waitFor(() => expect(where(r)).toBe('/view/r/p1.md?project=r:plain.mdv.yaml'));
    // The project section replaces the root list; Close project is an explicit exit.
    expect(await screen.findByRole('region', { name: 'Project' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'r' })).toBeNull();
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

const sidebar = () => within(screen.getByRole('navigation', { name: 'Sidebar' }));
const errorResponse = (status: number, code: string, line?: number) => () =>
  Response.json({ error: { code, message: code, ...(line ? { line } : {}) } }, { status });

describe('project sidebar', () => {
  const url = '/view/r/docs/start.md?project=r:s.mdv.yaml';

  it('shows title, links, entries, the current item and folder disclosure', async () => {
    renderAt(url);
    expect(await sidebar().findByRole('heading', { name: 'Sidebar project' })).toBeInTheDocument();
    expect(sidebar().getByRole('heading', { name: 'Project', level: 2 })).toBeInTheDocument();
    expect(sidebar().getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      '/view/r/s.mdv.yaml?project=r:s.mdv.yaml&source=1',
    );
    expect(sidebar().getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/view/r/docs/start.md?project=r:s.mdv.yaml',
    );
    expect(sidebar().queryByRole('link', { name: 'r' })).toBeNull();
    // The current file is marked, the project scope is carried (never ws).
    const current = sidebar().getByRole('link', { name: 'docs/start.md' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('href', '/view/r/docs/start.md?project=r:s.mdv.yaml');
    expect(sidebar().queryByText('This file is not part of the project')).toBeNull();

    // A folder entry is collapsed (it does not contain the current path) and lists lazily.
    const toggle = sidebar().getByRole('button', { name: 'Expand sub' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar().queryByRole('link', { name: 'zed.md' })).toBeNull();
    await userEvent.click(toggle);
    const child = await sidebar().findByRole('link', { name: 'zed.md' });
    expect(child).toHaveAttribute('href', '/view/r/sub/zed.md?project=r:s.mdv.yaml');
    expect(sidebar().getByRole('link', { name: 'sub' })).toHaveAttribute(
      'href',
      '/browse/r/sub?project=r:s.mdv.yaml',
    );
    await userEvent.click(sidebar().getByRole('button', { name: 'Collapse sub' }));
    expect(sidebar().queryByRole('link', { name: 'zed.md' })).toBeNull();
  });

  it('opens the folder that contains the current path', async () => {
    renderAt('/view/r/sub/zed.md?project=r:s.mdv.yaml');
    const current = await sidebar().findByRole('link', { name: 'zed.md' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(sidebar().getByRole('button', { name: 'Collapse sub' })).toBeInTheDocument();
    expect(sidebar().queryByText('This file is not part of the project')).toBeNull();
  });

  it('notes a file that is not part of the project, but not the project file itself', async () => {
    const r = renderAt('/view/r/elsewhere.md?project=r:s.mdv.yaml');
    expect(await sidebar().findByText('This file is not part of the project')).toBeInTheDocument();
    await act(() => r.router.navigate('/view/r/s.mdv.yaml?project=r:s.mdv.yaml'));
    await waitFor(() =>
      expect(sidebar().queryByText('This file is not part of the project')).toBeNull(),
    );
    await act(() => r.router.navigate('/browse/r/nope?project=r:s.mdv.yaml'));
    expect(await sidebar().findByText('This file is not part of the project')).toBeInTheDocument();
  });

  it('shows the warnings panel with server and client warnings; Re-check refetches', async () => {
    renderAt(url);
    const panel = (await sidebar().findByText('Warnings')).closest('details') as HTMLElement;
    expect(panel).toHaveClass('project-warnings');
    expect(panel).toHaveAttribute('open');
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(panel).getByText('gone.md').tagName).toBe('CODE');
    expect(within(panel).getByText(/line 7/)).toBeInTheDocument();
    // The unknown style comes from the client registry for the project layer.
    expect(within(panel).getByText(/Unknown style "fancy"/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('2 warnings')).toBeInTheDocument();

    const before = projectCalls.length;
    await userEvent.click(within(panel).getByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(projectCalls.length).toBeGreaterThan(before));
  });

  it('keeps the warnings panel closed when there are none', async () => {
    renderAt('/view/r/p1.md?project=r:plain.mdv.yaml');
    const panel = (await sidebar().findByText('Warnings')).closest('details') as HTMLElement;
    expect(panel).not.toHaveAttribute('open');
  });

  it('falls back to the normal sidebar while the project is loading or broken', async () => {
    renderAt('/browse/r?project=r:dead.mdv.yaml');
    expect(await sidebar().findByRole('link', { name: 'r' })).toBeInTheDocument();
    expect(sidebar().getByRole('heading', { name: 'Roots' })).toBeInTheDocument();
  });
});

describe('keeping the last good project', () => {
  const url = '/view/r/docs/start.md?project=r:s.mdv.yaml';
  const recheck = async () => {
    const before = projectCalls.length;
    await userEvent.click(sidebar().getByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(projectCalls.length).toBeGreaterThan(before));
  };

  it('422: keeps the sidebar and settings with an error line until valid again', async () => {
    renderAt(url);
    await sidebar().findByRole('heading', { name: 'Sidebar project' });
    await waitFor(() => expect(fontSize()).toBe('24px'));

    overrides['s.mdv.yaml'] = errorResponse(422, 'project_invalid', 5);
    await recheck();
    expect(await sidebar().findByRole('alert')).toHaveTextContent(
      'Project file has an error, line 5; showing the last valid version',
    );
    expect(sidebar().getByRole('heading', { name: 'Sidebar project' })).toBeInTheDocument();
    expect(sidebar().getByRole('link', { name: 'docs/start.md' })).toBeInTheDocument();
    expect(fontSize()).toBe('24px');
    expect(main().getByRole('heading', { name: 'Hello' })).toBeInTheDocument();

    delete overrides['s.mdv.yaml'];
    await recheck();
    await waitFor(() => expect(sidebar().queryByRole('alert')).toBeNull());
    expect(fontSize()).toBe('24px');
  });

  it('504: keeps the data and marks it possibly out of date', async () => {
    renderAt(url);
    await sidebar().findByRole('heading', { name: 'Sidebar project' });
    expect(sidebar().queryByText(/may be out of date/)).toBeNull();

    overrides['s.mdv.yaml'] = errorResponse(504, 'fs_timeout');
    await recheck();
    expect(await sidebar().findByText(/may be out of date/)).toBeInTheDocument();
    expect(sidebar().getByRole('heading', { name: 'Sidebar project' })).toBeInTheDocument();
    expect(fontSize()).toBe('24px');

    delete overrides['s.mdv.yaml'];
    await recheck();
    await waitFor(() => expect(sidebar().queryByText(/may be out of date/)).toBeNull());
  });

  it('404: drops the project; error state with Close project, no project settings', async () => {
    renderAt(url);
    await sidebar().findByRole('heading', { name: 'Sidebar project' });
    await waitFor(() => expect(fontSize()).toBe('24px'));

    overrides['s.mdv.yaml'] = errorResponse(404, 'not_found');
    await recheck();
    expect(await main().findByRole('link', { name: 'Close project' })).toHaveAttribute(
      'href',
      '/view/r/docs/start.md',
    );
    await waitFor(() => expect(fontSize()).toBe('16px'));
    expect(sidebar().queryByRole('heading', { name: 'Sidebar project' })).toBeNull();
    expect(sidebar().getByRole('heading', { name: 'Roots' })).toBeInTheDocument();
  });
});

describe('recent projects', () => {
  const stored = () => parseRecentProjects(window.localStorage.getItem('mdv-recent-projects'));
  beforeEach(() => {
    resetRecentProjectsCache();
    resetRecentCache();
  });

  it('records a loaded project with its name, and lists it on the home page', async () => {
    const { router } = renderAt('/view/r/a.mdv.yaml');
    await waitFor(() =>
      expect(stored()).toEqual([{ root: 'r', path: 'a.mdv.yaml', name: 'Project A' }]),
    );
    await act(() => router.navigate('/'));
    const list = await screen.findByRole('list', { name: 'Recent projects' });
    expect(within(list).getByRole('link', { name: /Project A/ })).toHaveAttribute(
      'href',
      '/view/r/a.mdv.yaml',
    );
  });

  it('records a project without a title by file name', async () => {
    renderAt('/view/r/plain.mdv.yaml');
    await waitFor(() => expect(stored()).toEqual([{ root: 'r', path: 'plain.mdv.yaml' }]));
  });

  it('does not record a project that failed to load', async () => {
    renderAt('/view/r/dead.mdv.yaml');
    await main().findByRole('link', { name: 'Close project' });
    await settle();
    expect(stored()).toEqual([]);
  });

  it('files opened in a project are recorded with it and link back into it', async () => {
    const { router } = renderAt('/view/r/sub/zed.md?project=r:s.mdv.yaml');
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('mdv-recent') ?? '[]')[0]?.project).toBe(
        'r:s.mdv.yaml',
      ),
    );
    await act(() => router.navigate('/'));
    const list = await screen.findByRole('list', { name: 'Recent' });
    expect(within(list).getByRole('link', { name: /zed\.md/ })).toHaveAttribute(
      'href',
      '/view/r/sub/zed.md?project=r:s.mdv.yaml',
    );
  });
});

describe('per-project device choices', () => {
  const theme = () => document.documentElement.dataset.theme;
  const choose = (v: string) =>
    userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), v);

  it('a choice inside a project is not seen outside, nor in another project', async () => {
    const r = renderAt('/view/r/sub/zed.md?project=r:s.mdv.yaml');
    await sidebar().findByRole('heading', { name: 'Sidebar project' });
    await choose('dark');
    await waitFor(() => expect(theme()).toBe('dark'));
    expect(window.localStorage.getItem('mdv-theme')).toBeNull();

    await act(() => r.router.navigate('/browse/r'));
    await waitFor(() => expect(theme()).toBe('light'));
    await act(() => r.router.navigate('/view/r/p1.md?project=r:plain.mdv.yaml'));
    await waitFor(() => expect(fontSize()).toBe('16px'));
    expect(theme()).toBe('light');
    await act(() => r.router.navigate('/view/r/sub/zed.md?project=r:s.mdv.yaml'));
    await waitFor(() => expect(theme()).toBe('dark'));
  });

  it('a global choice does not apply inside a project; Reset clears the current scope only', async () => {
    const r = renderAt('/browse/r');
    await screen.findByRole('combobox', { name: 'Theme' });
    await choose('dark');
    await waitFor(() => expect(theme()).toBe('dark'));
    await act(() => r.router.navigate('/view/r/sub/zed.md?project=r:s.mdv.yaml'));
    await sidebar().findByRole('heading', { name: 'Sidebar project' });
    await waitFor(() => expect(theme()).toBe('light'));
    await choose('light');

    await userEvent.click(sidebar().getByRole('button', { name: "Reset this device's choices" }));
    expect(window.localStorage.getItem('mdv-project-device')).toBeNull();
    // The global choice survives a project reset.
    expect(window.localStorage.getItem('mdv-theme')).toBe('dark');

    await act(() => r.router.navigate('/browse/r'));
    await waitFor(() => expect(theme()).toBe('dark'));
    await userEvent.click(sidebar().getByRole('button', { name: "Reset this device's choices" }));
    await waitFor(() => expect(theme()).toBe('light'));
    expect(window.localStorage.getItem('mdv-theme')).toBeNull();
  });
});
