import { describe, expect, it } from 'vitest';
import { fileKind, parentDir } from './logic';

describe('parentDir', () => {
  it('returns the parent folder', () => {
    expect(parentDir('a/b/c.md')).toBe('a/b');
    expect(parentDir('c.md')).toBe('');
  });
});

describe('fileKind', () => {
  it.each([
    ['a/readme.md', 'markdown'],
    ['NOTES.MDX', 'markdown'],
    ['d/flow.mmd', 'diagram'],
    ['d/arch.D2', 'diagram'],
    ['i/pic.PNG', 'image'],
    ['i/pic.jpeg', 'image'],
    ['i/pic.avif', 'image'],
    ['i/logo.svg', 'image'],
    ['t/main.go', 'text'],
    ['t/config.YAML', 'text'],
    ['t/plain.yml', 'text'],
    ['p/course.mdv.yaml', 'project'],
    ['p/course.mdv.yml', 'project'],
    ['p/Course.MDV.YAML', 'project'],
    ['p/.mdv.yaml', 'project'],
    ['.MDV.YML', 'project'],
    ['p/mdv.yaml', 'text'],
    ['p/x.mdv.yaml.bak', 'other'],
    ['t/Notes.txt', 'text'],
    ['o/blob.bin', 'other'],
    ['o/page.html', 'other'],
    ['o/noext', 'other'],
    ['o/.hidden', 'other'],
    ['.hidden', 'other'],
    ['dir.md/file', 'other'],
  ] as const)('%s -> %s', (path, kind) => {
    expect(fileKind(path)).toBe(kind);
  });
});
