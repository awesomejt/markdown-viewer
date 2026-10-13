import Diagram, { type DiagramKind } from './Diagram';

export function diagramKindOf(path: string): DiagramKind {
  return /\.d2$/i.test(path) ? 'd2' : 'mermaid';
}

/** Full-page view of a standalone `.mmd`, `.mermaid` or `.d2` file; the caller fetches the source. */
export default function DiagramPage({ path, source }: { path: string; source: string }) {
  const name = path.split('/').pop() ?? path;
  return (
    <section className="diagram-page">
      <h1>{name}</h1>
      <Diagram kind={diagramKindOf(path)} source={source} />
    </section>
  );
}
