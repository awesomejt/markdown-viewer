import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentProjects } from './RecentProjects';
import {
  clearRecentProjects,
  parseRecentProjects,
  pushRecentProject,
  RECENT_PROJECTS_MAX,
  recordRecentProject,
  resetRecentProjectsCache,
  useRecentProjects,
} from './recentProjects';

const KEY = 'mdv-recent-projects';
const proj = (path: string, name?: string, root = 'r') =>
  name === undefined ? { root, path } : { root, path, name };

beforeEach(() => {
  window.localStorage.clear();
  resetRecentProjectsCache();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pushRecentProject', () => {
  it('puts the item first, dedupes by root+path, updates the name and caps', () => {
    let list = [proj('a.mdv.yaml', 'A'), proj('b.mdv.yaml')];
    list = pushRecentProject(list, proj('b.mdv.yaml', 'B'));
    expect(list).toEqual([proj('b.mdv.yaml', 'B'), proj('a.mdv.yaml', 'A')]);
    list = [];
    for (let i = 0; i < RECENT_PROJECTS_MAX + 3; i++)
      list = pushRecentProject(list, proj(`p${i}.mdv.yaml`));
    expect(list).toHaveLength(RECENT_PROJECTS_MAX);
    expect(list[0].path).toBe(`p${RECENT_PROJECTS_MAX + 2}.mdv.yaml`);
  });
});

describe('parseRecentProjects', () => {
  it('drops malformed JSON and invalid items', () => {
    expect(parseRecentProjects(null)).toEqual([]);
    expect(parseRecentProjects('nope')).toEqual([]);
    expect(parseRecentProjects('{"root":"r"}')).toEqual([]);
    const raw = JSON.stringify([
      { root: 'r', path: 'a.mdv.yaml', name: 'A', extra: 1 },
      { root: 'R!', path: 'b.mdv.yaml' },
      { root: 'r', path: 'c.md' },
      { root: 'r', path: '../d.mdv.yaml' },
      { root: 'r', path: 'sub/e.MDV.YML', name: 7 },
      { root: 'r', path: 'a.mdv.yaml' },
      { root: 5, path: 'f.mdv.yaml' },
      null,
    ]);
    expect(parseRecentProjects(raw)).toEqual([proj('a.mdv.yaml', 'A'), proj('sub/e.MDV.YML')]);
  });

  it('caps the stored list', () => {
    const raw = JSON.stringify(Array.from({ length: 15 }, (_, i) => proj(`p${i}.mdv.yaml`)));
    expect(parseRecentProjects(raw)).toHaveLength(RECENT_PROJECTS_MAX);
  });
});

describe('recent projects store', () => {
  it('records, persists, shares, ignores invalid refs and clears', () => {
    const a = renderHook(() => useRecentProjects());
    const b = renderHook(() => useRecentProjects());
    act(() => recordRecentProject(proj('a.mdv.yaml', 'A')));
    act(() => recordRecentProject(proj('b.mdv.yaml')));
    act(() => recordRecentProject(proj('c.md')));
    expect(b.result.current[0].map((r) => r.path)).toEqual(['b.mdv.yaml', 'a.mdv.yaml']);
    expect(parseRecentProjects(window.localStorage.getItem(KEY))).toHaveLength(2);
    act(() => a.result.current[1]());
    expect(b.result.current[0]).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    act(() => clearRecentProjects());
  });

  it('skips the write when the head is identical, rewrites on a new name', () => {
    recordRecentProject(proj('a.mdv.yaml', 'A'));
    const set = vi.spyOn(Storage.prototype, 'setItem');
    recordRecentProject(proj('a.mdv.yaml', 'A'));
    expect(set).not.toHaveBeenCalled();
    recordRecentProject(proj('a.mdv.yaml', 'A2'));
    expect(set).toHaveBeenCalledTimes(1);
    expect(parseRecentProjects(window.localStorage.getItem(KEY))).toEqual([
      proj('a.mdv.yaml', 'A2'),
    ]);
  });
});

describe('RecentProjects', () => {
  const renderIt = () =>
    render(
      <MemoryRouter>
        <RecentProjects />
      </MemoryRouter>,
    );

  it('renders nothing while empty', () => {
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('lists projects with scope-less links, name or file name, and clears', async () => {
    recordRecentProject(proj('sub/b.mdv.yaml'));
    recordRecentProject(proj('a.mdv.yaml', 'Course'));
    renderIt();
    expect(screen.getByRole('heading', { name: 'Recent projects' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Recent projects' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/view/r/a.mdv.yaml',
      '/view/r/sub/b.mdv.yaml',
    ]);
    expect(links[0]).toHaveTextContent('Course');
    expect(links[0]).toHaveTextContent('r');
    expect(links[1]).toHaveTextContent('b.mdv.yaml');
    expect(links[1]).toHaveTextContent('r/sub');
    expect(links[0].querySelector('svg.kind-project')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear recent projects' }));
    expect(screen.queryByRole('list', { name: 'Recent projects' })).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
