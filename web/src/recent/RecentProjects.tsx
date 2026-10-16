import { useId } from 'react';
import { Link } from 'react-router';
import { viewHref } from '../api/client';
import { KindIcon } from '../browse/KindIcon';
import { useRecentProjects, type RecentProject } from './recentProjects';

function label(p: RecentProject): string {
  return p.name ?? p.path.split('/').pop() ?? p.path;
}

function where(p: RecentProject): string {
  const slash = p.path.lastIndexOf('/');
  return slash < 0 ? p.root : `${p.root}/${p.path.slice(0, slash)}`;
}

/**
 * Recently opened projects (FR-7.6); renders nothing while empty. The link has no scope, so the
 * project gate enters the project afresh.
 */
export function RecentProjects({ heading: Heading = 'h2' }: { heading?: 'h2' | 'h3' }) {
  const [items, clear] = useRecentProjects();
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className="recent" aria-labelledby={headingId}>
      <div className="recent-head">
        <Heading id={headingId}>Recent projects</Heading>
        <button type="button" className="btn" aria-label="Clear recent projects" onClick={clear}>
          Clear
        </button>
      </div>
      <ul className="link-list recent-list" aria-label="Recent projects">
        {items.map((p) => (
          <li key={`${p.root}/${p.path}`}>
            <Link to={viewHref(p.root, p.path)} title={`${p.root}/${p.path}`}>
              <KindIcon kind="project" />
              <span className="recent-name">{label(p)}</span>
              <span className="recent-where muted">{where(p)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
