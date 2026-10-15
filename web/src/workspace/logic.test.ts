import { describe, expect, it } from 'vitest';
import type { ListEntry } from '../api/types';
import { ancestorFolders, expandedFor, treeEntries } from './logic';

const e = (name: string, type: 'dir' | 'file'): ListEntry => ({
  name,
  type,
  kind: 'other',
  size: 0,
  mtime: '',
});

describe('ancestorFolders', () => {
  it('lists folders from the workspace down to the parent', () => {
    expect(ancestorFolders('docs/sub/deep.md', 'docs')).toEqual(['docs', 'docs/sub']);
    expect(ancestorFolders('docs/sub/deep.md', '')).toEqual(['', 'docs', 'docs/sub']);
    expect(ancestorFolders('a.md', '')).toEqual(['']);
    expect(ancestorFolders('docs', 'docs')).toEqual(['docs']);
  });
  it('is empty outside the workspace', () => {
    expect(ancestorFolders('other/a.md', 'docs')).toEqual([]);
  });
});

describe('expandedFor', () => {
  it('adds the current folder itself', () => {
    expect([...expandedFor('docs/sub', '', true)]).toEqual(['', 'docs', 'docs/sub']);
    expect([...expandedFor('docs/sub', '', false)]).toEqual(['', 'docs']);
    expect(expandedFor('x', 'docs', true).size).toBe(0);
  });
});

describe('treeEntries', () => {
  it('hides dot-files and puts folders first, sorted', () => {
    const out = treeEntries([e('b.md', 'file'), e('.git', 'dir'), e('z', 'dir'), e('a', 'dir')]);
    expect(out.map((x) => x.name)).toEqual(['a', 'z', 'b.md']);
  });
  it('keeps dot-files when showHidden is on', () => {
    const out = treeEntries([e('b.md', 'file'), e('.git', 'dir'), e('a', 'dir')], true);
    expect(out.map((x) => x.name)).toEqual(['.git', 'a', 'b.md']);
  });
  it('hides non-Markdown files but keeps folders when mdOnly is on', () => {
    const files = [
      { ...e('a.md', 'file'), kind: 'markdown' as const },
      { ...e('d.mmd', 'file'), kind: 'diagram' as const },
      e('n.txt', 'file'),
      e('sub', 'dir'),
    ];
    expect(treeEntries(files, false, true).map((x) => x.name)).toEqual(['sub', 'a.md', 'd.mmd']);
    expect(treeEntries(files, false, false).map((x) => x.name)).toEqual([
      'sub',
      'a.md',
      'd.mmd',
      'n.txt',
    ]);
  });
  it('never filters out the kept (viewed) entry', () => {
    const files = [{ ...e('a.md', 'file'), kind: 'markdown' as const }, e('n.txt', 'file')];
    expect(treeEntries(files, false, true, 'n.txt').map((x) => x.name)).toEqual(['a.md', 'n.txt']);
  });
});
