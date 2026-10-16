import { useCallback, useSyncExternalStore } from 'react';
import { makeProjectRef } from '../api/client';
import { createStoredStore } from '../app/storedStore';

// Recently opened projects (FR-7.6), newest first, stored per browser like `recent.ts`.
export const RECENT_PROJECTS_STORAGE_KEY = 'mdv-recent-projects';
export const RECENT_PROJECTS_MAX = 10;

export interface RecentProject {
  root: string;
  path: string;
  /** The project's title from the API, when it has one. */
  name?: string;
}

function sameProject(a: RecentProject, b: RecentProject): boolean {
  return a.root === b.root && a.path === b.path;
}

/** `item` moved to the front (replacing any older entry for it), capped at `max`. */
export function pushRecentProject(
  list: RecentProject[],
  item: RecentProject,
  max = RECENT_PROJECTS_MAX,
): RecentProject[] {
  return [item, ...list.filter((r) => !sameProject(r, item))].slice(0, max);
}

function normalize(root: string, path: string, name: unknown): RecentProject | null {
  if (makeProjectRef(root, path) === null) return null;
  return typeof name === 'string' && name !== '' ? { root, path, name } : { root, path };
}

/** Parses stored JSON, dropping anything malformed (storage is user-editable). */
export function parseRecentProjects(raw: string | null): RecentProject[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentProject[] = [];
  for (const v of data) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.root !== 'string' || typeof r.path !== 'string') continue;
    const item = normalize(r.root, r.path, r.name);
    if (item && !out.some((o) => sameProject(o, item))) out.push(item);
  }
  return out.slice(0, RECENT_PROJECTS_MAX);
}

const store = createStoredStore(
  RECENT_PROJECTS_STORAGE_KEY,
  parseRecentProjects,
  (list: RecentProject[]) => (list.length === 0 ? null : JSON.stringify(list)),
);

export function recordRecentProject(item: RecentProject): void {
  const next = normalize(item.root, item.path, item.name);
  if (!next) return;
  const list = store.get();
  if (
    list.length > 0 &&
    list[0].root === next.root &&
    list[0].path === next.path &&
    list[0].name === next.name
  ) {
    return;
  }
  store.set(pushRecentProject(list, next));
}

export function clearRecentProjects(): void {
  store.set([]);
}

/** Test hook: forget the cached list so the next read comes from storage. */
export const resetRecentProjectsCache = store.reset;

export function useRecentProjects(): [RecentProject[], () => void] {
  const list = useSyncExternalStore(store.subscribe, store.get);
  const clear = useCallback(() => clearRecentProjects(), []);
  return [list, clear];
}
