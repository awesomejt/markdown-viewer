import { Link, useParams, useSearchParams } from 'react-router';
import { browseHref, viewHref } from '../api/client';
import { useList, useRoots } from '../api/hooks';
import { ErrorState, Loading } from './states';

export function RootsView() {
  const roots = useRoots();
  return (
    <section>
      <h1>Roots</h1>
      {roots.isPending && <Loading />}
      {roots.isError && <ErrorState error={roots.error} onRetry={() => void roots.refetch()} />}
      {roots.data &&
        (roots.data.roots.length === 0 ? (
          <p className="muted">No roots are configured.</p>
        ) : (
          <ul className="link-list" aria-label="Available roots">
            {roots.data.roots.map((r) => (
              <li key={r.name}>
                {r.available ? (
                  <Link to={browseHref(r.name, '')}>{r.name}</Link>
                ) : (
                  <span className="unavailable" aria-disabled="true">
                    {r.name} <span className="muted">(unavailable)</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function usePathParams() {
  const params = useParams();
  const [search] = useSearchParams();
  return {
    root: params.root ?? '',
    path: params['*'] ?? '',
    ws: search.get('ws') ?? undefined,
  };
}

/** Placeholder until F2. */
export function BrowseView() {
  const { root, path, ws } = usePathParams();
  const list = useList(root, path);
  return (
    <section>
      <h1>
        {root}/{path}
      </h1>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <ul className="link-list" aria-label="Entries">
          {list.data.entries.map((e) => {
            const child = path ? `${path}/${e.name}` : e.name;
            return (
              <li key={e.name}>
                <Link
                  to={e.type === 'dir' ? browseHref(root, child, ws) : viewHref(root, child, ws)}
                >
                  {e.name}
                  {e.type === 'dir' ? '/' : ''}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Placeholder until F5. */
export function ViewFileView() {
  const { root, path } = usePathParams();
  return (
    <section>
      <h1>
        {root}/{path}
      </h1>
      <p className="muted">File view is not implemented yet.</p>
    </section>
  );
}

export function NotFoundView() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to roots</Link>
      </p>
    </section>
  );
}
