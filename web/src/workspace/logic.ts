import type { ListEntry } from '../api/types';
import { filterEntries, isWithin, joinPath } from '../browse/logic';

/** Folders from the workspace folder `ws` down to the parent of `path` (inclusive of `ws`). */
export function ancestorFolders(path: string, ws: string): string[] {
  if (!isWithin(path, ws)) return [];
  const rest = path === ws ? '' : ws === '' ? path : path.slice(ws.length + 1);
  const segs = rest === '' ? [] : rest.split('/').slice(0, -1);
  const out = [ws];
  let cur = ws;
  for (const s of segs) {
    cur = joinPath(cur, s);
    out.push(cur);
  }
  return out;
}

/** Folders to expand so `path` is visible: its ancestors, plus `path` itself when it is a folder. */
export function expandedFor(path: string, ws: string, isFolder: boolean): Set<string> {
  const set = new Set(ancestorFolders(path, ws));
  if (isFolder && isWithin(path, ws)) set.add(path);
  return set;
}

/** Visible tree children: dot-files hidden, folders first, then files, each by name. */
export function treeEntries(entries: ListEntry[]): ListEntry[] {
  const visible = filterEntries(entries, { query: '', mdOnly: false });
  const rank = (e: ListEntry) => (e.type === 'dir' ? 0 : 1);
  return [...visible].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
