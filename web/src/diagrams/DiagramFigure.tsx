import { useEffect, useState } from 'react';
import DiagramError from './DiagramError';
import { ALT, type DiagramKind } from './kinds';

export interface DiagramFigureProps {
  kind: DiagramKind;
  source: string;
  /** SVG markup once rendered. */
  svg?: string;
  /** Error text when rendering failed. */
  error?: string;
}

/**
 * Shows an SVG as `<img src=blob:>`, so its markup never enters the app DOM and cannot run
 * scripts or reach app styles. Object URLs are revoked when replaced and on unmount.
 */
export default function DiagramFigure({ kind, source, svg, error }: DiagramFigureProps) {
  const [shown, setShown] = useState<{ svg: string; url: string } | null>(null);

  useEffect(() => {
    if (svg === undefined) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setShown({ svg, url });
    return () => URL.revokeObjectURL(url);
  }, [svg]);

  if (error !== undefined) {
    return (
      <figure className="diagram" data-diagram={kind} data-state="error">
        <DiagramError kind={kind} message={error} source={source} />
      </figure>
    );
  }
  if (svg !== undefined && shown?.svg === svg) {
    return (
      <figure className="diagram" data-diagram={kind} data-state="ready">
        <img className="diagram-img" src={shown.url} alt={ALT[kind]} />
      </figure>
    );
  }
  return (
    <figure className="diagram" data-diagram={kind} data-state="loading">
      <p className="diagram-loading muted" role="status">
        Rendering diagram…
      </p>
    </figure>
  );
}
