import { Link } from 'react-router';
import { breadcrumbs } from './logic';

export function Breadcrumbs({ root, path, ws }: { root: string; path: string; ws?: string }) {
  const crumbs = breadcrumbs(root, path, ws);
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>
            {c.href === null ? (
              <span aria-current="page">{c.label}</span>
            ) : (
              <Link to={c.href}>{c.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
