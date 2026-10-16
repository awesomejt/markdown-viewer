import type { ReactNode } from 'react';
import { useProjectQuery } from '../api/hooks';
import { ProjectContext } from './context';
import { useProjectParam } from './useNavScope';

/**
 * Reads `?project=` and fetches the project (the only fetching reader, like `FirstPaintHold` for
 * prefs). Consumers use `useProject()`; the project settings layer is `useProjectLayer()`.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const ref = useProjectParam();
  const query = useProjectQuery(ref?.root ?? '', ref?.path ?? '', ref !== null);
  return <ProjectContext value={{ ref, query: ref ? query : null }}>{children}</ProjectContext>;
}
