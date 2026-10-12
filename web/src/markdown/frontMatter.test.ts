import { describe, expect, it } from 'vitest';
import { extractFrontMatter } from './frontMatter';

describe('extractFrontMatter', () => {
  it('returns the YAML between the fences', () => {
    expect(extractFrontMatter('---\ntitle: A\ntags: [x]\n---\n\n# Body')).toBe(
      'title: A\ntags: [x]',
    );
  });

  it('accepts CRLF, trailing fence whitespace and a document that ends at the fence', () => {
    expect(extractFrontMatter('--- \r\na: 1\r\n---\t')).toBe('a: 1');
  });

  it('returns an empty string for empty front matter', () => {
    expect(extractFrontMatter('---\n---\nbody')).toBe('');
  });

  it('returns null without an opening fence on the first line', () => {
    expect(extractFrontMatter('# T\n---\na: 1\n---\n')).toBeNull();
    expect(extractFrontMatter('\n---\na: 1\n---\n')).toBeNull();
    expect(extractFrontMatter('----\na: 1\n----\n')).toBeNull();
  });

  it('returns null without a closing fence (thematic break)', () => {
    expect(extractFrontMatter('---\n\ntext')).toBeNull();
    expect(extractFrontMatter('---\na: 1\n--- x\n')).toBeNull();
  });
});
