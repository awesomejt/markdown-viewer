import { lazy, Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useFile } from '../api/hooks';
import { ErrorState, Loading } from './states';
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

const MarkdownView = lazy(() => import('../markdown/MarkdownView'));

const MARKDOWN_RE = /\.(md|markdown)$/i;

function MarkdownFile({ root, path, ws }: { root: string; path: string; ws?: string }) {
  const file = useFile(root, path);
  if (file.isPending) return <Loading />;
  if (file.isError) return <ErrorState error={file.error} onRetry={() => void file.refetch()} />;
  return (
    <Suspense fallback={<Loading />}>
      <MarkdownView text={file.data.text} root={root} docPath={path} ws={ws} />
    </Suspense>
  );
}

/** Markdown only until F5 adds the other kinds. */
export function ViewFileView() {
  const { root, path, ws } = usePathParams();
  if (MARKDOWN_RE.test(path)) return <MarkdownFile root={root} path={path} ws={ws} />;
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
