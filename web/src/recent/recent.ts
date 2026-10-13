import { useCallback, useSyncExternalStore } from 'react';
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
    .map(({ root, path, type, ws }) =>
      ws === undefined ? { root, path, type } : { root, path, type, ws },
    )
    .slice(0, RECENT_MAX);
}

const store = createStoredStore(RECENT_STORAGE_KEY, parseRecent, (list: RecentItem[]) =>
  list.length === 0 ? null : JSON.stringify(list),
);

export function recordRecent(item: RecentItem): void {
  const list = store.get();
  if (list.length > 0 && sameItem(list[0], item) && list[0].ws === item.ws) return;
  store.set(pushRecent(list, item));
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
