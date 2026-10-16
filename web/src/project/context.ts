import { createContext, useContext } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ProjectRef } from '../api/client';
import type { ProjectResponse } from '../api/types';

export interface ProjectState {
  /** The project named by `?project=`; `null` outside a project. */
  ref: ProjectRef | null;
  /** The query for exactly `ref` (no placeholder data); `null` outside a project. */
  query: UseQueryResult<ProjectResponse, unknown> | null;
  /**
   * The project data in effect: the last good data (kept while a refetch fails with 422, 504 or a
   * network error), but `undefined` after a 404 or before the first success.
   */
  data: ProjectResponse | undefined;
  /** Why `data` may be behind the file: set only when a refetch failed after a success. */
  problem: ProjectProblem | null;
}

export type ProjectProblem =
  /** The file is now invalid (422); `data` is the last valid version. */
  | { kind: 'invalid'; line?: number }
  /** The server was slow or unreachable (504, network); `data` may be out of date. */
  | { kind: 'outdated' };

export const ProjectContext = createContext<ProjectState>({
  ref: null,
  query: null,
  data: undefined,
  problem: null,
});

/** The open project and its query state. Outside a `ProjectProvider` there is no project. */
export function useProject(): ProjectState {
  return useContext(ProjectContext);
}
