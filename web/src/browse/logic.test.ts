import { describe, expect, it } from 'vitest';
import type { ListEntry } from '../api/types';
import {
  breadcrumbs,
  filterEntries,
  findIndexFile,
  formatSize,
  isWithin,
  loadMdOnly,
  saveMdOnly,
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
  it('filters case-insensitively by substring', () => {
    expect(filterEntries(entries, { query: 'GUI', mdOnly: false }).map((e) => e.name)).toEqual([
      'Guide.md',
    ]);
  });
  it('markdown-only keeps dirs, markdown and diagrams', () => {
    expect(filterEntries(entries, { query: '', mdOnly: true }).map((e) => e.name)).toEqual([
      'sub',
      'Guide.md',
      'flow.mmd',
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

describe('md-only persistence', () => {
  it('round-trips and defaults to off', () => {
    window.localStorage.clear();
    expect(loadMdOnly()).toBe(false);
    saveMdOnly(true);
    expect(loadMdOnly()).toBe(true);
    saveMdOnly(false);
    expect(loadMdOnly()).toBe(false);
  });
});
