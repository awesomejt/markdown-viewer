import type { ReactNode } from 'react';
import { Link, Navigate, useParams, useLocation, useSearchParams } from 'react-router';
import { ApiError, isProjectPath, makeProjectRef, viewHref, type ProjectRef } from '../api/client';
import { useProjectQuery } from '../api/hooks';
import type { ProjectResponse } from '../api/types';
import { ErrorState, Loading } from '../app/states';
import { useProject } from './context';
import { useCloseProjectHref } from './useNavScope';

/** Where entering a project goes: `open`, else the first Markdown file entry, else the home. */
export function landingHref(data: ProjectResponse, ref: ProjectRef): string {
  const scope = { project: ref };
  if (data.open) return viewHref(data.open.root, data.open.path, scope);
  const first = data.entries.find((e) => e.type === 'file' && e.kind === 'markdown');
  return first ? viewHref(first.root, first.path, scope) : viewHref(ref.root, ref.path, scope);
}

/** Fetches the project being entered, then replaces the location with its landing page. */
function Entering({ target }: { target: ProjectRef }) {
  const query = useProjectQuery(target.root, target.path);
  if (query.isPending) return <Loading label="Loading project…" />;
  // On an error the project home shows the error state (and offers Close project).
  const to = query.data
    ? landingHref(query.data, target)
    : viewHref(target.root, target.path, { project: target });
  return <Navigate replace to={to} />;
}

function ProjectError() {
  const { ref, query } = useProject();
  const closeHref = useCloseProjectHref();
  const error = query?.error;
  const line = error instanceof ApiError ? error.line : undefined;
  const invalid = error instanceof ApiError && error.code === 'project_invalid';
  return (
    <div className="project-error">
      <ErrorState
        error={error}
        onRetry={() => void query?.refetch()}
        actions={
          <>
            {invalid && ref && (
              <Link
                className="btn"
                to={`${viewHref(ref.root, ref.path, { project: ref })}&source=1`}
              >
                Show source
              </Link>
            )}
            <Link className="btn" to={closeHref}>
              Close project
            </Link>
          </>
        }
      />
      {invalid && line !== undefined && <p className="muted">YAML line {line}</p>}
    </div>
  );
}

/**
 * Wraps the main outlet. Entering or switching: viewing a project file that is not the open
 * project redirects to its landing page (never when it equals `?project=`, so there is no loop).
 * Otherwise it holds the outlet (spinner) until the project settles and shows the initial error
 * states. The project's own source (`?source=1`) stays reachable so a broken file can be read.
 */
export function ProjectGate({ children }: { children: ReactNode }) {
  const { ref, query } = useProject();
  const params = useParams();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const root = params.root ?? '';
  const path = params['*'] ?? '';

  if (pathname.startsWith('/view/') && isProjectPath(path)) {
    const target = makeProjectRef(root, path);
    if (target && !(ref && ref.root === target.root && ref.path === target.path)) {
      return <Entering key={`${target.root}/${target.path}`} target={target} />;
    }
  }
  if (ref && query) {
    if (query.isPending) return <Loading label="Loading project…" />;
    if (query.isError && !query.data) {
      const onSource =
        pathname.startsWith('/view/') &&
        root === ref.root &&
        path === ref.path &&
        search.get('source') === '1';
      if (!onSource) return <ProjectError />;
    }
  }
  return <>{children}</>;
}
