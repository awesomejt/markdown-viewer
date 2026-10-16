import type { Root } from 'mdast';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkPlugins } from './pipeline';
import {
  READ_TIME_DEFAULTS,
  countWords,
  formatReadTime,
  readMinutes,
  type ReadTimeOptions,
} from './readTime';

const none: ReadTimeOptions = { includeHeadings: false, includeCode: false };
const all: ReadTimeOptions = { includeHeadings: true, includeCode: true };

/** Parses and runs the real remark plugins (front matter, math, alerts), as MarkdownView does. */
function tree(md: string): Root {
  const p = unified().use(remarkParse);
  for (const plugin of remarkPlugins) p.use(plugin as never);
  return p.runSync(p.parse(md)) as Root;
}
const words = (md: string, o = none) => countWords(tree(md), o).words;

describe('countWords', () => {
  it('counts plain text, emphasis, links and lists', () => {
    expect(words('one **two** [three four](http://x)\n\n- five\n- six')).toBe(6);
  });

  it('skips front matter, math, html, comments, images and definitions', () => {
    const md = [
      '---',
      'title: some front matter here',
      '---',
      '',
      'alpha $x + y$ beta',
      '',
      '$$',
      'a + b + c',
      '$$',
      '',
      '<!-- hidden comment words -->',
      '',
      '<div>raw html words</div>',
      '',
      '![alt text here](a.png) gamma',
      '',
      '[ref]: http://example.com "title words"',
    ].join('\n');
    expect(words(md, all)).toBe(3);
  });

  it('skips headings and code unless included', () => {
    const md = '# Big Title\n\nbody text\n\n```js\nconst a = 1;\n```\n\nuse `inline code` here';
    expect(words(md)).toBe(4);
    expect(words(md, { includeHeadings: true, includeCode: false })).toBe(6);
    expect(words(md, { includeHeadings: false, includeCode: true })).toBe(4 + 3 + 2);
    expect(words(md, all)).toBe(4 + 3 + 2 + 2);
  });

  it('never counts diagram or math fences', () => {
    const md =
      'x\n\n```mermaid\ngraph TD\nA --> B\n```\n\n```d2\na -> b\n```\n\n```math\ne = mc\n```\n\n```text\nreal code\n```';
    expect(words(md, all)).toBe(1 + 2);
    expect(words(md, none)).toBe(1);
  });

  it('does not count the alert title', () => {
    expect(words('> [!NOTE]\n> remember this')).toBe(2);
    expect(words('> [!WARNING]\n> careful')).toBe(1);
    expect(words('> plain quote here')).toBe(3);
  });

  it('counts table cells and footnotes', () => {
    expect(words('| a | b |\n|---|---|\n| c d | e |\n\ntext[^1]\n\n[^1]: note body')).toBe(
      5 + 1 + 2,
    );
  });

  it('counts CJK text with Intl.Segmenter', () => {
    expect(words('今天天气很好')).toBeGreaterThan(1);
    expect(words('今天天气很好')).toBeLessThan(6);
  });

  it('falls back to a whitespace split without Intl.Segmenter', () => {
    const orig = Intl.Segmenter;
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    try {
      expect(words('one two  three\nfour')).toBe(4);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { value: orig, configurable: true });
    }
  });

  it('returns 0 for an empty document', () => {
    expect(countWords(tree(''), all)).toEqual({
      words: 0,
      sections: [{ headingIndex: -1, heading: '', level: 0, words: 0 }],
    });
  });

  it('splits counts into an intro and per-heading sections', () => {
    const r = countWords(tree('intro words\n\n# A\n\none two\n\n## B *x*\n\nthree'), none);
    expect(r.words).toBe(5);
    expect(r.sections).toEqual([
      { headingIndex: -1, heading: '', level: 0, words: 2 },
      { headingIndex: 0, heading: 'A', level: 1, words: 2 },
      { headingIndex: 1, heading: 'B x', level: 2, words: 1 },
    ]);
    const withHeads = countWords(tree('# A b\n\nc'), { ...none, includeHeadings: true });
    expect(withHeads.sections[1].words).toBe(3);
  });
});

describe('readMinutes and formatReadTime', () => {
  it('divides words by wpm and guards a bad wpm', () => {
    expect(readMinutes(320, 160)).toBe(2);
    expect(readMinutes(10, 0)).toBe(0);
  });

  it('exposes the defaults', () => {
    expect(READ_TIME_DEFAULTS).toEqual({ wpm: 160, includeHeadings: false, includeCode: false });
  });

  it('formats words, rounded minutes and the exact title', () => {
    expect(formatReadTime(1234, 160, 'en-US')).toEqual({
      text: '1,234 words · about 8 min',
      title: '7 min 43 s at 160 wpm',
    });
  });

  it('says under 1 min below a minute', () => {
    expect(formatReadTime(100, 160, 'en-US')).toEqual({
      text: '100 words · under 1 min',
      title: '38 s at 160 wpm',
    });
    expect(formatReadTime(1, 160, 'en-US').text).toBe('1 word · under 1 min');
  });

  it('handles exactly one minute and a non-positive wpm', () => {
    expect(formatReadTime(160, 160, 'en-US').text).toBe('160 words · about 1 min');
    expect(formatReadTime(160, 0, 'en-US').title).toBe('1 min 0 s at 160 wpm');
  });
});
