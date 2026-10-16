import { Link } from 'react-router';
import type { NavScope } from '../api/client';
import { breadcrumbs } from './logic';

export function Breadcrumbs({
  root,
  path,
  scope,
}: {
  root: string;
  path: string;
  scope?: NavScope;
}) {
  const crumbs = breadcrumbs(root, path, scope);
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
