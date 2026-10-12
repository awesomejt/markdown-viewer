import { useEffect, useState } from 'react';
import DiagramFigure from './DiagramFigure';
import { renderMermaid } from './mermaid';
import { useResolvedTheme } from './useResolvedTheme';

interface Result {
  key: string;
  svg?: string;
  error?: string;
}

export default function MermaidDiagram({ source }: { source: string }) {
  const theme = useResolvedTheme();
  const key = `${theme}\0${source}`;
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderMermaid(source, theme).then(
      (svg) => {
        if (!cancelled) setResult({ key, svg });
      },
      (e: unknown) => {
        if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, theme, key]);

  const current = result?.key === key ? result : null;
  return <DiagramFigure kind="mermaid" source={source} svg={current?.svg} error={current?.error} />;
}
