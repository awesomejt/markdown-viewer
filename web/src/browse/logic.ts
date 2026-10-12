import { browseHref, viewHref } from '../api/client';
import type { EntryKind, ListEntry } from '../api/types';

export const MD_ONLY_STORAGE_KEY = 'mdv-md-only';

export function isHidden(name: string): boolean {
  return name.startsWith('.');
}

export interface FilterOptions {
  query: string;
  mdOnly: boolean;
}

/** Hides dot-files, applies the case-insensitive name filter and the markdown/diagrams toggle. */
export function filterEntries(entries: ListEntry[], { query, mdOnly }: FilterOptions): ListEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (isHidden(e.name)) return false;
    if (mdOnly && e.type !== 'dir' && e.kind !== 'markdown' && e.kind !== 'diagram') return false;
    return q === '' || e.name.toLowerCase().includes(q);
  });
}

/** Human-readable size using 1024 steps; `''` for directories. */
export function formatSize(entry: Pick<ListEntry, 'type' | 'size'>): string {
  if (entry.type === 'dir') return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = entry.size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  if (i === 0) return `${n} B`;
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} ${units[i]}`;
}

export function formatMtime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** README.md preferred over index.md (case-insensitive); files only. */
export function findIndexFile(entries: ListEntry[]): string | undefined {
  for (const want of ['readme.md', 'index.md']) {
    const hit = entries.find((e) => e.type === 'file' && e.name.toLowerCase() === want);
    if (hit) return hit.name;
  }
  return undefined;
}

/** Where "Open as workspace" goes: the folder's README/index if any, else the folder listing. */
export function workspaceTarget(root: string, folder: string, entries: ListEntry[]): string {
  const index = findIndexFile(entries);
  return index !== undefined
    ? viewHref(root, joinPath(folder, index), folder)
    : browseHref(root, folder, folder);
}

/** True when `path` is the workspace folder `ws` or inside it (`""` is the whole root). */
export function isWithin(path: string, ws: string): boolean {
  return ws === '' || path === ws || path.startsWith(`${ws}/`);
}

/** `ws` when `path` is inside the workspace, else `undefined` (links outside it drop `ws`). */
export function scopeWs(path: string, ws?: string): string | undefined {
  return ws !== undefined && isWithin(path, ws) ? ws : undefined;
}

export interface Crumb {
  label: string;
  /** Link target; `null` for the current (last) crumb. */
  href: string | null;
}

export function breadcrumbs(root: string, path: string, ws?: string): Crumb[] {
  const segs = path === '' ? [] : path.split('/');
  // Ancestors above the workspace folder drop `ws` (it is kept only within the workspace).
  const href = (p: string) => browseHref(root, p, scopeWs(p, ws));
  const crumbs: Crumb[] = [{ label: 'Roots', href: '/' }];
  crumbs.push({ label: root, href: segs.length === 0 ? null : href('') });
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    crumbs.push({ label: seg, href: last ? null : href(segs.slice(0, i + 1).join('/')) });
  });
  return crumbs;
}

export function kindOf(entry: Pick<ListEntry, 'type' | 'kind'>): EntryKind | 'dir' {
  return entry.type === 'dir' ? 'dir' : entry.kind;
}

export function loadMdOnly(): boolean {
  try {
    return window.localStorage.getItem(MD_ONLY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMdOnly(on: boolean): void {
  try {
    window.localStorage.setItem(MD_ONLY_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable (private mode): the choice just isn't persisted.
  }
}
