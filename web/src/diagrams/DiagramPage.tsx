import { useFile } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import Diagram, { type DiagramKind } from './Diagram';

export const DIAGRAM_FILE_RE = /\.(mmd|mermaid|d2)$/i;

export function diagramKindOf(path: string): DiagramKind {
  return /\.d2$/i.test(path) ? 'd2' : 'mermaid';
}

/** Full-page view of a standalone `.mmd`, `.mermaid` or `.d2` file. */
export default function DiagramPage({ root, path }: { root: string; path: string }) {
  const file = useFile(root, path);
  if (file.isPending) return <Loading />;
  if (file.isError) return <ErrorState error={file.error} onRetry={() => void file.refetch()} />;
  const name = path.split('/').pop() ?? path;
  return (
    <section className="diagram-page">
      <h1>{name}</h1>
      <Diagram kind={diagramKindOf(path)} source={file.data.text} />
    </section>
  );
}
