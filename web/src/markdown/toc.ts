export const TOC_OPEN_STORAGE_KEY = 'mdv-toc-open';

/** The TOC opens by default on screens wide enough to show it beside the document. */
export const TOC_WIDE_QUERY = '(min-width: 1400px)';

export interface TocEntry {
  id: string;
  text: string;
  /** Heading level, 1 to 6. */
  level: number;
}

/**
 * Collects the rendered headings that have an id (rehype-slug, or a sanitized raw-HTML id), in
 * document order. The GFM footnotes label (`sr-only`) and empty headings are skipped.
 */
export function collectHeadings(container: ParentNode): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(
    'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]',
  )) {
    if (el.classList.contains('sr-only')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text === '' || el.id === '') continue;
    entries.push({ id: el.id, text, level: Number(el.tagName.slice(1)) });
  }
  return entries;
}

export function sameEntries(a: TocEntry[], b: TocEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.id === b[i].id && e.text === b[i].text && e.level === b[i].level)
  );
}

export function readTocOpen(): boolean {
  try {
    const v = window.localStorage.getItem(TOC_OPEN_STORAGE_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    // Storage blocked: fall back to the screen width.
  }
  return typeof window.matchMedia === 'function' && window.matchMedia(TOC_WIDE_QUERY).matches;
}

export function writeTocOpen(open: boolean): void {
  try {
    window.localStorage.setItem(TOC_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Not persisted.
  }
}
