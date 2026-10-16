import { createContext, useContext } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ProjectRef } from '../api/client';
import type { ProjectResponse } from '../api/types';

export interface ProjectState {
  /** The project named by `?project=`; `null` outside a project. */
  ref: ProjectRef | null;
  /** The query for exactly `ref` (no placeholder data); `null` outside a project. */
  query: UseQueryResult<ProjectResponse, unknown> | null;
}

export const ProjectContext = createContext<ProjectState>({ ref: null, query: null });

/** The open project and its query state. Outside a `ProjectProvider` there is no project. */
export function useProject(): ProjectState {
  return useContext(ProjectContext);
}
