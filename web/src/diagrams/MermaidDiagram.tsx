import { useEffect, useRef, useState } from 'react';
import DiagramFigure from './DiagramFigure';
import { renderMermaid, type MermaidJob } from './mermaid';
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
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  // Without IntersectionObserver (old browsers, jsdom) every diagram counts as near the viewport.
  const near = useRef(typeof IntersectionObserver === 'undefined');
  const job = useRef<MermaidJob | null>(null);

  // Diagrams within about one viewport of the screen render first; the rest still render later.
  useEffect(() => {
    if (!figure || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        near.current = true;
        job.current?.promote();
        io.disconnect();
      },
      { rootMargin: `${window.innerHeight}px 0px` },
    );
    io.observe(figure);
    return () => io.disconnect();
  }, [figure]);

  useEffect(() => {
    let cancelled = false;
    const j = renderMermaid(source, theme, near.current);
    job.current = j;
    j.result.then(
      (svg) => {
        if (!cancelled) setResult({ key, svg });
      },
      (e: unknown) => {
        if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
      j.cancel();
    };
  }, [source, theme, key]);

  const current = result?.key === key ? result : null;
  // While a new theme or source renders, keep the last good SVG on screen.
  const svg = current ? current.svg : result?.svg;
  return (
    <DiagramFigure
      kind="mermaid"
      figureRef={setFigure}
      source={source}
      svg={svg}
      error={current?.error}
      busy={!current && svg !== undefined}
    />
  );
}
