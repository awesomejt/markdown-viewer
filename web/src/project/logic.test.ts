import { describe, expect, it } from 'vitest';
import type { ProjectEntry, ProjectResponse } from '../api/types';
import { inProject } from './logic';

const entry = (path: string, type: 'file' | 'dir'): ProjectEntry => ({
  root: 'r',
  path,
  type,
  kind: type === 'dir' ? 'other' : 'markdown',
  ref: path,
  line: 1,
});

const ENTRIES = [entry('course', 'dir'), entry('single.md', 'file')];
const OPEN: ProjectResponse['open'] = { root: 'r', path: 'plain.md', kind: 'markdown' };
const check = (path: string, isFolder = false, open: ProjectResponse['open'] = null, root = 'r') =>
  inProject(path, isFolder, 'p.mdv.yaml', ENTRIES, root, open);

describe('inProject', () => {
  it('counts the project file itself, but not as a folder', () => {
    expect(check('p.mdv.yaml')).toBe(true);
    expect(check('p.mdv.yaml', true)).toBe(false);
  });

  it('counts a file entry as a file only', () => {
    expect(check('single.md')).toBe(true);
    expect(check('single.md', true)).toBe(false);
  });

  it('counts a folder entry and everything under it', () => {
    expect(check('course', true)).toBe(true);
    expect(check('course/a/b.md')).toBe(true);
    expect(check('course/sub', true)).toBe(true);
  });

  it('counts the open file even when no entry lists it', () => {
    expect(check('plain.md', false, OPEN)).toBe(true);
  });

  it('does not count the open path as a folder route', () => {
    expect(check('plain.md', true, OPEN)).toBe(false);
  });

  it('does not count an open file in another root', () => {
    expect(check('plain.md', false, { root: 'other', path: 'plain.md', kind: 'markdown' })).toBe(
      false,
    );
  });

  it('does not count an unrelated file, with or without open', () => {
    expect(check('other.md')).toBe(false);
    expect(check('other.md', false, OPEN)).toBe(false);
    expect(check('plain.md')).toBe(false);
  });
});
