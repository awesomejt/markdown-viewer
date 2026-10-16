import { useCallback, useSyncExternalStore } from 'react';
import { formatProject, parseProjectParam, type ProjectRef } from '../api/client';
import { createStoredStore } from '../app/storedStore';

// Recently opened files and folders (FR-2.6), newest first, stored per browser. One store is
// shared by every list on the page and follows other tabs via the `storage` event.
export const RECENT_STORAGE_KEY = 'mdv-recent';
export const RECENT_MAX = 10;

export interface RecentItem {
  root: string;
  path: string;
  type: 'file' | 'dir';
  /** Workspace the item was opened in, so reopening it restores the tree. */
  ws?: string;
  /** Project the item was opened in (FR-7.6); wins over `ws`, so only one of them is kept. */
  project?: ProjectRef;
}

/** The item with `ws` dropped when a project is present, and no `undefined` fields. */
export function normalizeRecent(item: RecentItem): RecentItem {
  const { root, path, type, ws, project } = item;
  if (project) return { root, path, type, project };
  return ws === undefined ? { root, path, type } : { root, path, type, ws };
}

function sameProject(a?: ProjectRef, b?: ProjectRef): boolean {
  return a === b || (a !== undefined && b !== undefined && a.root === b.root && a.path === b.path);
}

function sameItem(a: RecentItem, b: RecentItem): boolean {
  return a.root === b.root && a.path === b.path && a.type === b.type;
}

/** `item` moved to the front (replacing any older entry for it), capped at `max`. */
export function pushRecent(list: RecentItem[], item: RecentItem, max = RECENT_MAX): RecentItem[] {
  return [item, ...list.filter((r) => !sameItem(r, item))].slice(0, max);
}

function isItem(v: unknown): v is RecentItem {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.root === 'string' &&
    r.root !== '' &&
    typeof r.path === 'string' &&
    (r.type === 'file' || r.type === 'dir') &&
    (r.ws === undefined || typeof r.ws === 'string')
    // `project` is checked while mapping: a bad value drops only that field.
  );
}

/** Parses stored JSON, dropping anything malformed (storage is user-editable). */
export function parseRecent(raw: string | null): RecentItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(isItem)
    .map((r) => {
      const raw = (r as unknown as { project?: unknown }).project;
      const project = typeof raw === 'string' ? parseProjectParam(raw) : null;
      return normalizeRecent({ ...r, project: project ?? undefined });
    })
    .slice(0, RECENT_MAX);
}

const store = createStoredStore(RECENT_STORAGE_KEY, parseRecent, (list: RecentItem[]) =>
  list.length === 0
    ? null
    : JSON.stringify(
        list.map((r) => (r.project ? { ...r, project: formatProject(r.project) } : r)),
      ),
);

export function recordRecent(item: RecentItem): void {
  const list = store.get();
  const next = normalizeRecent(item);
  if (
    list.length > 0 &&
    sameItem(list[0], next) &&
    list[0].ws === next.ws &&
    sameProject(list[0].project, next.project)
  ) {
    return;
  }
  store.set(pushRecent(list, next));
}

export function clearRecent(): void {
  store.set([]);
}

/** Test hook: forget the cached list so the next read comes from storage. */
export const resetRecentCache = store.reset;

export function useRecent(): [RecentItem[], () => void] {
  const list = useSyncExternalStore(store.subscribe, store.get);
  const clear = useCallback(() => clearRecent(), []);
  return [list, clear];
}
