import { Link } from 'react-router';
import { browseHref } from '../api/client';
import { useRoots } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';

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
