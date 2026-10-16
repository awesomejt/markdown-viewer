import { describe, expect, it } from 'vitest';
import { sanitizeLayer } from './sanitize';

describe('sanitizeLayer', () => {
  it('keeps valid values', () => {
    const layer = {
      theme: 'dark',
      style: 'github',
      font: 'serif-2',
      codeFont: 'mono',
      fontSize: 18,
      lineHeight: 1.8,
      contentWidth: 'wide',
      markdownOnly: true,
      showHidden: false,
      sort: 'date',
      readTime: { wpm: 200, includeHeadings: true, includeCode: false },
    };
    expect(sanitizeLayer(layer)).toEqual(layer);
  });

  it('accepts the range limits and rejects values just outside', () => {
    expect(sanitizeLayer({ fontSize: 12, lineHeight: 1 })).toEqual({ fontSize: 12, lineHeight: 1 });
    expect(sanitizeLayer({ fontSize: 32, lineHeight: 2.5 })).toEqual({
      fontSize: 32,
      lineHeight: 2.5,
    });
    expect(sanitizeLayer({ fontSize: 11.9, lineHeight: 0.9 })).toEqual({});
    expect(sanitizeLayer({ fontSize: 32.1, lineHeight: 2.6 })).toEqual({});
    expect(sanitizeLayer({ readTime: { wpm: 60 } })).toEqual({ readTime: { wpm: 60 } });
    expect(sanitizeLayer({ readTime: { wpm: 600 } })).toEqual({ readTime: { wpm: 600 } });
    expect(sanitizeLayer({ readTime: { wpm: 59 } })).toEqual({});
    expect(sanitizeLayer({ readTime: { wpm: 601 } })).toEqual({});
    expect(sanitizeLayer({ readTime: { wpm: 100.5 } })).toEqual({});
  });

  it('drops wrong types, bad enums and bad names', () => {
    expect(
      sanitizeLayer({
        theme: 'purple',
        style: 'Bad Name',
        font: '1abc',
        codeFont: 'a'.repeat(33),
        fontSize: '18',
        lineHeight: NaN,
        contentWidth: 'huge',
        markdownOnly: 'yes',
        showHidden: 1,
        sort: 'size',
        readTime: { wpm: '200', includeHeadings: 'x', includeCode: null },
      }),
    ).toEqual({});
    expect(sanitizeLayer({ style: 'url(x)', font: '"><script>' })).toEqual({});
  });

  it('drops unknown keys including textScale', () => {
    expect(
      sanitizeLayer({ theme: 'light', textScale: 2, bogus: 1, __proto__: { theme: 'dark' } }),
    ).toEqual({
      theme: 'light',
    });
  });

  it('never throws on non-object input', () => {
    for (const v of [null, undefined, 3, 'x', true, [], [{ theme: 'dark' }], () => 1]) {
      expect(sanitizeLayer(v)).toEqual({});
    }
    expect(sanitizeLayer({ readTime: 5 })).toEqual({});
    expect(sanitizeLayer({ readTime: [1] })).toEqual({});
  });

  it('does not read inherited properties', () => {
    const proto = { theme: 'dark' };
    expect(sanitizeLayer(Object.create(proto))).toEqual({});
  });
});
