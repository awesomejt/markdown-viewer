import type { ProjectEntry, ProjectResponse } from '../api/types';
import { isWithin } from '../browse/logic';
import { expandedFor } from '../workspace/logic';

/**
 * Whether `path` (of the current `/view` or `/browse` route, within the project's root) belongs to
 * the project: the project file itself, its `open` file, a listed file or folder, or anything under
 * a listed folder. `root` is the project's root (the route's root); `open` may sit in another root.
 */
export function inProject(
  path: string,
  isFolder: boolean,
  projectPath: string,
  entries: readonly ProjectEntry[],
  root: string,
  open: ProjectResponse['open'],
): boolean {
  if (!isFolder && path === projectPath) return true;
  if (!isFolder && open && open.root === root && open.path === path) return true;
  return entries.some((e) =>
    e.type === 'dir' ? isWithin(path, e.path) : !isFolder && e.path === path,
  );
}

/** The folders to open so `path` is visible: every folder entry that contains it, down to it. */
export function projectExpanded(
  path: string,
  isFolder: boolean,
  entries: readonly ProjectEntry[],
): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.type !== 'dir' || !isWithin(path, e.path)) continue;
    for (const p of expandedFor(path, e.path, isFolder)) out.add(p);
  }
  return out;
}
