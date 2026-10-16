import { useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import {
  browseHref,
  parseProjectParam,
  viewHref,
  type NavScope,
  type ProjectRef,
} from '../api/client';
import { parentDir } from '../fileview/logic';

/** The valid `?project=` of the current URL, or `null` (absent or malformed values are ignored). */
export function useProjectParam(): ProjectRef | null {
  const [search] = useSearchParams();
  const ref = parseProjectParam(search.get('project'));
  const root = ref?.root;
  const path = ref?.path;
  return useMemo(
    () => (root !== undefined && path !== undefined ? { root, path } : null),
    [root, path],
  );
}

/** The scope links in the current view carry: the project, else the workspace (project wins). */
export function useNavScope(): NavScope {
  const [search] = useSearchParams();
  const project = useProjectParam();
  const ws = search.get('ws') ?? undefined;
  return useMemo(() => {
    if (project) return { project };
    return ws !== undefined ? { ws } : {};
  }, [project, ws]);
}

/**
 * Close project: the current location without `project` (other params and the hash are kept).
 * On the open project's own file that would only re-enter the project, so it goes to the browse
 * listing of the file's folder instead (no `project`, `ws` or `source`).
 */
export function useCloseProjectHref(): string {
  const { pathname, search, hash } = useLocation();
  const ref = useProjectParam();
  if (ref && pathname === viewHref(ref.root, ref.path)) {
    return browseHref(ref.root, parentDir(ref.path));
  }
  const params = new URLSearchParams(search);
  params.delete('project');
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
