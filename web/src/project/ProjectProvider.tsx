import { useMemo, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useProjectQuery } from '../api/hooks';
import { useLiveSubscription } from '../live/LiveProvider';
import { ProjectContext, type ProjectProblem, type ProjectState } from './context';
import { useProjectParam } from './useNavScope';

/** Normal (not low-priority) watch of the project file; a change refetches the project query. */
function ProjectLive({ root, path }: { root: string; path: string }) {
  useLiveSubscription(root, path);
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
      {ref && <ProjectLive root={ref.root} path={ref.path} />}
      {children}
    </ProjectContext>
  );
}
