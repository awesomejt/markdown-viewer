import type { SettingsLayer } from './types';

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const THEMES: readonly unknown[] = ['system', 'light', 'dark'];
const WIDTHS: readonly unknown[] = ['narrow', 'normal', 'wide', 'full'];
const SORTS: readonly unknown[] = ['name', 'date'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function name(v: unknown): string | undefined {
  return typeof v === 'string' && NAME_RE.test(v) ? v : undefined;
}

function oneOf<T>(list: readonly unknown[], v: unknown): T | undefined {
  return list.includes(v) ? (v as T) : undefined;
}

function own(o: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

/**
 * Keeps only valid keys, types and ranges per the contract table. Never throws. Used for the
 * `/api/prefs` settings and the localStorage cache, because the values reach CSS variables and
 * attributes. Registry names (`style`, `font`, `codeFont`) are checked by pattern only here.
 */
export function sanitizeLayer(input: unknown): SettingsLayer {
  if (!isRecord(input)) return {};
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  set('theme', oneOf(THEMES, own(input, 'theme')));
  set('style', name(own(input, 'style')));
  set('font', name(own(input, 'font')));
  set('codeFont', name(own(input, 'codeFont')));
  set('fontSize', num(own(input, 'fontSize'), 12, 32));
  set('lineHeight', num(own(input, 'lineHeight'), 1, 2.5));
  set('contentWidth', oneOf(WIDTHS, own(input, 'contentWidth')));
  set('markdownOnly', bool(own(input, 'markdownOnly')));
  set('showHidden', bool(own(input, 'showHidden')));
  set('sort', oneOf(SORTS, own(input, 'sort')));
  const rt = own(input, 'readTime');
  if (isRecord(rt)) {
    const wpm = num(own(rt, 'wpm'), 60, 600);
    const readTime: Record<string, unknown> = {};
    if (wpm !== undefined && Number.isInteger(wpm)) readTime.wpm = wpm;
    const h = bool(own(rt, 'includeHeadings'));
    const c = bool(own(rt, 'includeCode'));
    if (h !== undefined) readTime.includeHeadings = h;
    if (c !== undefined) readTime.includeCode = c;
    if (Object.keys(readTime).length > 0) out.readTime = readTime;
  }
  return out as SettingsLayer;
}
