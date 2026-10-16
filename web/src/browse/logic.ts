import { browseHref, viewHref, type NavScope } from '../api/client';
import type { EntryKind, ListEntry } from '../api/types';

export const MD_ONLY_STORAGE_KEY = 'mdv-md-only';
export const SORT_STORAGE_KEY = 'mdv-sort';
export const SHOW_HIDDEN_STORAGE_KEY = 'mdv-show-hidden';

export type SortKey = 'name' | 'date';

export function isHidden(name: string): boolean {
  return name.startsWith('.');
}

export interface FilterOptions {
  query: string;
  mdOnly: boolean;
  /** Keep dot-files and dot-folders (FR-1.4); hidden by default. */
  showHidden?: boolean;
}

/** Kinds the Markdown-only toggle keeps (folders always stay). */
const MD_ONLY_KINDS: ReadonlySet<EntryKind> = new Set(['markdown', 'diagram', 'project']);

/** Hides dot-files unless `showHidden`, applies the case-insensitive name filter and the markdown/diagrams/projects toggle. */
export function filterEntries(
  entries: ListEntry[],
  { query, mdOnly, showHidden = false }: FilterOptions,
): ListEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (!showHidden && isHidden(e.name)) return false;
    if (mdOnly && e.type !== 'dir' && !MD_ONLY_KINDS.has(e.kind)) return false;
    return q === '' || e.name.toLowerCase().includes(q);
  });
}

function compareName(a: ListEntry, b: ListEntry): number {
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
}

function mtimeMs(e: ListEntry): number {
  const t = Date.parse(e.mtime);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Returns a sorted copy. Directories always come first (as the server orders them). `name` is
 * case-insensitive; `date` is newest first with name order as the tie-break, and entries without
 * a valid mtime sort last within their group.
 */
export function sortEntries(entries: ListEntry[], sort: SortKey): ListEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
    if (sort === 'date') {
      const ta = mtimeMs(a);
      const tb = mtimeMs(b);
      if (ta !== tb) return ta > tb ? -1 : 1;
    }
    return compareName(a, b);
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
    ? viewHref(root, joinPath(folder, index), { ws: folder })
    : browseHref(root, folder, { ws: folder });
}

/** True when `path` is the workspace folder `ws` or inside it (`""` is the whole root). */
export function isWithin(path: string, ws: string): boolean {
  return ws === '' || path === ws || path.startsWith(`${ws}/`);
}

/**
 * The scope a link to `path` carries: a project is kept for every path (the caller's href builder
 * drops it for another root); `ws` only inside the workspace folder.
 */
export function scopeNav(path: string, scope: NavScope = {}): NavScope {
  if (scope.project) return { project: scope.project };
  return scope.ws !== undefined && isWithin(path, scope.ws) ? { ws: scope.ws } : {};
}

export interface Crumb {
  label: string;
  /** Link target; `null` for the current (last) crumb. */
  href: string | null;
}

export function breadcrumbs(root: string, path: string, scope: NavScope = {}): Crumb[] {
  const segs = path === '' ? [] : path.split('/');
  // Ancestors above the workspace folder drop `ws` (it is kept only within the workspace); a project is kept.
  const href = (p: string) => browseHref(root, p, scopeNav(p, scope));
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
