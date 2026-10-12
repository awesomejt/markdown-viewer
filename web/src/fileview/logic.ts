import type { EntryKind } from '../api/types';

/** Parent folder of a slash path (`""` for top-level entries). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * Fallback kind when the parent listing has no entry for the file (listing failed or truncated).
 * The server's `/api/list` classification is authoritative; this only covers the renderable kinds.
 */
export function fileKind(path: string): EntryKind {
  if (/\.(md|markdown|mdx)$/i.test(path)) return 'markdown';
  if (/\.(mmd|mermaid|d2)$/i.test(path)) return 'diagram';
  return 'other';
}
