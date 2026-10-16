import { useEffect, useMemo, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useProjectQuery } from '../api/hooks';
import { useLiveSubscription } from '../live/LiveProvider';
import { recordRecentProject } from '../recent/recentProjects';
import { ProjectContext, type ProjectProblem, type ProjectState } from './context';
import { useProjectParam } from './useNavScope';

/**
 * Watch of the project file; a change refetches the project query. Low priority until the first
 * success: the server drops an invalid low sub (e.g. a missing folder), while an invalid normal
 * sub fails the whole event stream. Once loaded the file is valid, so it is a normal sub.
 */
function ProjectLive({ root, path, low }: { root: string; path: string; low: boolean }) {
  useLiveSubscription(root, path, low);
  return null;
}

/**
 * Reads `?project=` and fetches the project (the only fetching reader, like `FirstPaintHold` for
 * prefs). Consumers use `useProject()`; the project settings layer is `useProjectLayer()`.
 * After a success the data is kept when a refetch fails (422, 504, network) and `problem` says
 * why; a 404 drops it.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const ref = useProjectParam();
  const query = useProjectQuery(ref?.root ?? '', ref?.path ?? '', ref !== null);
  // Remember a project once it loads; a rename updates the name. A later 404 cannot add it, as
  // it was recorded on the success before.
  const root = ref?.root;
  const path = ref?.path;
  const loaded = query.data !== undefined;
  const name = query.data?.name ?? undefined;
  useEffect(() => {
    if (root !== undefined && path !== undefined && loaded) {
      recordRecentProject({ root, path, name });
    }
  }, [root, path, loaded, name]);
  const state = useMemo<ProjectState>(() => {
    if (!ref) return { ref: null, query: null, data: undefined, problem: null };
    let data = query.data;
    let problem: ProjectProblem | null = null;
    if (data && query.isError) {
      const e = query.error;
      if (e instanceof ApiError && e.status === 404) data = undefined;
      else if (e instanceof ApiError && e.status === 422)
        problem = { kind: 'invalid', line: e.line };
      else problem = { kind: 'outdated' };
    }
    return { ref, query, data, problem };
  }, [ref, query]);
  return (
    <ProjectContext value={state}>
      {ref && <ProjectLive root={ref.root} path={ref.path} low={query.data === undefined} />}
      {children}
    </ProjectContext>
  );
}
