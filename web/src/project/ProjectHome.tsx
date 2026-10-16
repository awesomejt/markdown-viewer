import { Link } from 'react-router';
import { browseHref, viewHref, type ProjectRef } from '../api/client';
import { Loading } from '../app/states';
import { KindIcon } from '../browse/KindIcon';
import { kindOf } from '../browse/logic';
import { baseName } from '../fileview/logic';
import { useProject } from './context';
import { ProjectWarnings } from './ProjectWarnings';

/** Project / Source switch in the project header; `source` marks the current side. */
export function ProjectToggle({ project, source }: { project: ProjectRef; source: boolean }) {
  const home = viewHref(project.root, project.path, { project });
  return (
    <nav className="project-toggle" aria-label="Project view">
      {source ? <Link to={home}>Project</Link> : <span aria-current="page">Project</span>}{' '}
      {source ? (
        <span aria-current="page">Source</span>
      ) : (
        <Link to={`${home}&source=1`}>Source</Link>
      )}
    </nav>
  );
}

/** `/view/<root>/<x>.mdv.yaml?project=<same>`: title, entries and the server's warnings. */
export function ProjectHome() {
  const { ref, data } = useProject();
  if (!ref || !data) return <Loading label="Loading project…" />;
  return (
    <section className="project-home">
      <h1>{data.name ?? baseName(ref.path)}</h1>
      <ProjectToggle project={ref} source={false} />
      {data.entries.length === 0 ? (
        <p className="muted">This project lists no entries.</p>
      ) : (
        <ul className="link-list" aria-label="Project entries">
          {data.entries.map((e, i) => (
            <li key={`${i}:${e.root}/${e.path}`}>
              <Link
                to={
                  e.type === 'dir'
                    ? browseHref(e.root, e.path, { project: ref })
                    : viewHref(e.root, e.path, { project: ref })
                }
                title={e.ref}
              >
                <KindIcon kind={kindOf(e)} />
                {e.path === '' ? e.root : e.path}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ProjectWarnings />
    </section>
  );
}
