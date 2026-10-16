import { Link, useLocation, useParams } from 'react-router';
import { viewHref } from '../api/client';
import { baseName } from '../fileview/logic';
import { useProject } from './context';
import { inProject } from './logic';
import { ProjectTree } from './ProjectTree';
import { ProjectWarnings } from './ProjectWarnings';
import { useCloseProjectHref } from './useNavScope';
import './project.css';

/** Why the shown project may differ from the file on disk (set only after a failed refetch). */
function ProjectNotice() {
  const { problem } = useProject();
  if (!problem) return null;
  if (problem.kind === 'invalid') {
    return (
      <p className="project-notice project-notice-error" role="alert">
        Project file has an error
        {problem.line !== undefined ? `, line ${problem.line}` : ''}; showing the last valid version
      </p>
    );
  }
  return (
    <p className="project-notice muted" role="status">
      The project may be out of date
    </p>
  );
}

/** The "Project" sidebar section: title, links, warnings and the entries. Needs project data. */
export function ProjectSidebar() {
  const { ref, data } = useProject();
  const params = useParams();
  const { pathname } = useLocation();
  const closeHref = useCloseProjectHref();
  if (!ref || !data) return null;
  const view = pathname.startsWith('/view/');
  const browse = pathname.startsWith('/browse/');
  const path = params['*'] ?? '';
  const outside =
    (view || browse) &&
    params.root === ref.root &&
    !inProject(path, browse, ref.path, data.entries, ref.root, data.open);
  const home = viewHref(ref.root, ref.path, { project: ref });
  return (
    <section className="project-sidebar" aria-label="Project">
      <h3 className="project-title">{data.name ?? baseName(ref.path)}</h3>
      <ProjectNotice />
      <p className="project-links">
        <Link to={`${home}&source=1`}>Source</Link>
        {data.open && (
          <>
            {' · '}
            <Link to={viewHref(data.open.root, data.open.path, { project: ref })}>Open</Link>
          </>
        )}
        {' · '}
        <Link to={closeHref}>Close project</Link>
      </p>
      <ProjectWarnings />
      {outside && <p className="muted project-outside">This file is not part of the project</p>}
      {data.entries.length === 0 ? (
        <p className="muted">This project lists no entries.</p>
      ) : (
        <ProjectTree entries={data.entries} path={path} isFolder={browse} />
      )}
    </section>
  );
}
