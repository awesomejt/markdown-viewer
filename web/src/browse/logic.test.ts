import { describe, expect, it, vi } from 'vitest';
import type { ListEntry } from '../api/types';
import {
  breadcrumbs,
  filterEntries,
  findIndexFile,
  formatSize,
  isWithin,
  scopeWs,
  loadSort,
  saveSort,
  sortEntries,
  workspaceTarget,
} from './logic';

const mk = (name: string, type: 'dir' | 'file', kind: ListEntry['kind'] = 'other'): ListEntry => ({
  name,
  type,
  kind,
  size: 10,
  mtime: '2026-01-02T03:04:05Z',
});

const entries = [
  mk('sub', 'dir'),
  mk('.hidden', 'dir'),
  mk('Guide.md', 'file', 'markdown'),
  mk('flow.mmd', 'file', 'diagram'),
  mk('blob.bin', 'file'),
];

describe('filterEntries', () => {
  it('hides dot-files', () => {
    expect(filterEntries(entries, { query: '', mdOnly: false }).map((e) => e.name)).toEqual([
      'sub',
      'Guide.md',
      'flow.mmd',
      'blob.bin',
    ]);
  });
  it('keeps dot-files when showHidden is on', () => {
    expect(
      filterEntries(entries, { query: '', mdOnly: false, showHidden: true }).map((e) => e.name),
    ).toEqual(['sub', '.hidden', 'Guide.md', 'flow.mmd', 'blob.bin']);
  });
  it('filters case-insensitively by substring', () => {
    expect(filterEntries(entries, { query: 'GUI', mdOnly: false }).map((e) => e.name)).toEqual([
      'Guide.md',
    ]);
  });
  it('markdown-only keeps dirs, markdown, diagrams and projects', () => {
    const withProject = [...entries, mk('course.mdv.yaml', 'file', 'project')];
    expect(filterEntries(withProject, { query: '', mdOnly: true }).map((e) => e.name)).toEqual([
      'sub',
      'Guide.md',
      'flow.mmd',
      'course.mdv.yaml',
    ]);
  });
});

describe('formatSize', () => {
  it('formats units and blanks dirs', () => {
    expect(formatSize({ type: 'dir', size: 4096 })).toBe('');
    expect(formatSize({ type: 'file', size: 0 })).toBe('0 B');
    expect(formatSize({ type: 'file', size: 1536 })).toBe('1.5 KB');
    expect(formatSize({ type: 'file', size: 20 * 1024 })).toBe('20 KB');
    expect(formatSize({ type: 'file', size: 5 * 1024 * 1024 })).toBe('5 MB');
  });
});

describe('findIndexFile / workspaceTarget', () => {
  it('prefers README over index, case-insensitively, files only', () => {
    expect(findIndexFile([mk('index.md', 'file'), mk('Readme.MD', 'file')])).toBe('Readme.MD');
    expect(findIndexFile([mk('INDEX.md', 'file')])).toBe('INDEX.md');
    expect(findIndexFile([mk('README.md', 'dir')])).toBeUndefined();
  });
  it('targets the file view or the folder, always carrying ws', () => {
    expect(workspaceTarget('r', 'docs', [mk('README.md', 'file')])).toBe(
      '/view/r/docs/README.md?ws=docs',
    );
    expect(workspaceTarget('r', '', [mk('README.md', 'file')])).toBe('/view/r/README.md?ws=');
    expect(workspaceTarget('r', '', [mk('a.md', 'file')])).toBe('/browse/r?ws=');
    expect(workspaceTarget('r', 'a b', [])).toBe('/browse/r/a%20b?ws=a%20b');
  });
});

describe('breadcrumbs', () => {
  it('builds links with the last crumb current', () => {
    expect(breadcrumbs('r', 'a/b', 'a')).toEqual([
      { label: 'Roots', href: '/' },
      { label: 'r', href: '/browse/r' },
      { label: 'a', href: '/browse/r/a?ws=a' },
      { label: 'b', href: null },
    ]);
    expect(breadcrumbs('r', '')[1]).toEqual({ label: 'r', href: null });
  });

  it('keeps an empty (root) workspace on every crumb', () => {
    expect(breadcrumbs('r', 'a/b', '')[1].href).toBe('/browse/r?ws=');
  });
});

describe('isWithin', () => {
  it('matches the workspace folder and its descendants only', () => {
    expect(isWithin('a', 'a')).toBe(true);
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('ab', 'a')).toBe(false);
    expect(isWithin('', 'a')).toBe(false);
    expect(isWithin('x/y', '')).toBe(true);
  });
});

describe('scopeWs', () => {
  it('keeps ws only for paths inside the workspace', () => {
    expect(scopeWs('docs/a.md', 'docs')).toBe('docs');
    expect(scopeWs('other/a.md', 'docs')).toBeUndefined();
    expect(scopeWs('any', '')).toBe('');
    expect(scopeWs('any', undefined)).toBeUndefined();
  });
});

const at = (name: string, type: 'dir' | 'file', mtime: string): ListEntry => ({
  ...mk(name, type),
  mtime,
});

describe('sortEntries', () => {
  const list = [
    at('b.md', 'file', '2026-01-02T00:00:00Z'),
    at('A.md', 'file', '2026-01-03T00:00:00Z'),
    at('c.md', 'file', '2026-01-03T00:00:00Z'),
    at('none.md', 'file', ''),
    at('zdir', 'dir', '2026-01-01T00:00:00Z'),
    at('adir', 'dir', '2026-01-05T00:00:00Z'),
  ];
  const names = (s: 'name' | 'date') => sortEntries(list, s).map((e) => e.name);

  it('sorts by name, folders first, case-insensitive', () => {
    expect(names('name')).toEqual(['adir', 'zdir', 'A.md', 'b.md', 'c.md', 'none.md']);
  });

  it('sorts by date newest first, ties by name, missing mtime last, folders first', () => {
    expect(names('date')).toEqual(['adir', 'zdir', 'A.md', 'c.md', 'b.md', 'none.md']);
  });

  it('does not mutate its input', () => {
    const before = list.map((e) => e.name);
    sortEntries(list, 'date');
    expect(list.map((e) => e.name)).toEqual(before);
  });
});

describe('sort persistence', () => {
  it('defaults to name, round-trips, and rejects unknown values', () => {
    window.localStorage.clear();
    expect(loadSort()).toBe('name');
    saveSort('date');
    expect(window.localStorage.getItem('mdv-sort')).toBe('date');
    expect(loadSort()).toBe('date');
    window.localStorage.setItem('mdv-sort', 'bogus');
    expect(loadSort()).toBe('name');
  });

  it('tolerates throwing storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadSort()).toBe('name');
    expect(() => saveSort('date')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
