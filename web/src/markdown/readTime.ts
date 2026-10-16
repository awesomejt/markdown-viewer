import type { Root, RootContent } from 'mdast';
import { ALERT_TITLE_CLASS } from './alerts';

export interface ReadTimeOptions {
  includeHeadings: boolean;
  includeCode: boolean;
}

/** `wpm` is the owner's measured script-reading speed (FR-9.8). RT2 feeds settings over these. */
export const READ_TIME_DEFAULTS = { wpm: 160, includeHeadings: false, includeCode: false } as const;

export interface ReadTimeSection {
  /** Index among all headings in document order (empty ones included), or -1 for the intro. */
  headingIndex: number;
  /** Plain text of the heading; '' for the intro. */
  heading: string;
  /** Heading level 1 to 6; 0 for the intro. */
  level: number;
  words: number;
}

export interface WordCount {
  words: number;
  /** The intro (text before the first heading) first, then one entry per heading. */
  sections: ReadTimeSection[];
}

/** Fences that render as diagrams or math are never read aloud, so never counted (FR-9.6). */
const NEVER_COUNTED_LANGS = new Set(['mermaid', 'd2', 'math']);
const SKIPPED = new Set([
  'yaml',
  'math',
  'inlineMath',
  'html',
  'image',
  'imageReference',
  'definition',
]);

type Counter = (text: string) => number;

function makeCounter(): Counter {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
    return (text) => {
      let n = 0;
      for (const s of seg.segment(text)) if (s.isWordLike) n++;
      return n;
    };
  }
  return (text) => text.split(/\s+/).filter((w) => w !== '').length;
}

function plainText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return (node.children as RootContent[]).map(plainText).join('');
  return '';
}

function isAlertTitle(node: RootContent): boolean {
  const cls =
    node.data && 'hProperties' in node.data ? node.data.hProperties?.className : undefined;
  return Array.isArray(cls) && cls.includes(ALERT_TITLE_CLASS);
}

/** Counts the words a reader would speak, in total and per heading section (FR-9.6). Pure. */
export function countWords(tree: Root, opts: ReadTimeOptions): WordCount {
  const count = makeCounter();
  const sections: ReadTimeSection[] = [{ headingIndex: -1, heading: '', level: 0, words: 0 }];
  let current = sections[0];
  let headings = 0;

  const add = (text: string) => {
    current.words += count(text);
  };

  const walk = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (SKIPPED.has(node.type)) continue;
      switch (node.type) {
        case 'heading': {
          current = {
            headingIndex: headings++,
            heading: plainText(node),
            level: node.depth,
            words: 0,
          };
          sections.push(current);
          if (opts.includeHeadings) walk(node.children);
          continue;
        }
        case 'code':
          if (opts.includeCode && !NEVER_COUNTED_LANGS.has((node.lang ?? '').toLowerCase())) {
            add(node.value);
          }
          continue;
        case 'inlineCode':
          if (opts.includeCode) add(node.value);
          continue;
        case 'text':
          add(node.value);
          continue;
        default:
          // The "Note"/"Tip" title that remarkAlerts injects is not document text.
          if (isAlertTitle(node)) continue;
          if ('children' in node) walk(node.children as RootContent[]);
      }
    }
  };
  walk(tree.children);

  return { words: sections.reduce((n, s) => n + s.words, 0), sections };
}

/** Fractional minutes; 0 when `wpm` is not positive. */
export function readMinutes(words: number, wpm: number): number {
  return wpm > 0 ? words / wpm : 0;
}

export interface ReadTimeLabel {
  /** Visible text, e.g. `1,234 words · about 8 min`. */
  text: string;
  /** Exact estimate, e.g. `7 min 43 s at 160 wpm`. */
  title: string;
}

/** Display strings for the header line. */
export function formatReadTime(words: number, wpm: number, locale?: string): ReadTimeLabel {
  const rate = wpm > 0 ? wpm : READ_TIME_DEFAULTS.wpm;
  const seconds = Math.round(readMinutes(words, rate) * 60);
  const n = new Intl.NumberFormat(locale).format(words);
  const noun = words === 1 ? 'word' : 'words';
  const approx = seconds < 60 ? 'under 1 min' : `about ${Math.round(seconds / 60)} min`;
  const exact = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return { text: `${n} ${noun} · ${approx}`, title: `${exact} at ${rate} wpm` };
}
