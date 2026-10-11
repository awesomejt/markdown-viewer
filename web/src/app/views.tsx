import { Link, useParams, useSearchParams } from 'react-router';
export { BrowseView } from '../browse/BrowseView';
export { RootsView } from '../browse/RootsView';

function usePathParams() {
  const params = useParams();
  const [search] = useSearchParams();
  return {
    root: params.root ?? '',
    path: params['*'] ?? '',
    ws: search.get('ws') ?? undefined,
  };
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
