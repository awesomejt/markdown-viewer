import type { DiagramKind } from './kinds';

const TITLES: Record<DiagramKind, string> = {
  mermaid: 'Mermaid diagram error',
  d2: 'D2 diagram error',
};

export default function DiagramError({
  kind,
  message,
  source,
}: {
  kind: DiagramKind;
  message: string;
  source: string;
}) {
  return (
    <div className="diagram-error" role="alert">
      <p className="diagram-error-title">{TITLES[kind]}</p>
      <p className="diagram-error-message">{message}</p>
      <pre>
        <code>{source}</code>
      </pre>
    </div>
  );
}
