import { useEffect, useRef, useState, type ReactNode } from 'react';
import DiagramError from './DiagramError';
import DiagramViewer from './DiagramViewer';
import { ALT, type DiagramKind } from './kinds';

export interface DiagramFigureProps {
  kind: DiagramKind;
  source: string;
  /** SVG markup once rendered. */
  svg?: string;
  /** Error text when rendering failed. */
  error?: string;
  /** Kind-specific controls shown before the common tools when ready. */
  tools?: ReactNode;
  /** True while a newer render replaces the shown SVG. */
  busy?: boolean;
}

/**
 * Shows an SVG as `<img src=blob:>`, so its markup never enters the app DOM and cannot run
 * scripts or reach app styles. Object URLs are revoked when replaced and on unmount.
 * A ready diagram has a source toggle and a full-screen pan/zoom viewer (R2.8).
 */
export default function DiagramFigure({
  kind,
  source,
  svg,
  error,
  tools,
  busy = false,
}: DiagramFigureProps) {
  const [shown, setShown] = useState<{ svg: string; url: string } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenButton = useRef<HTMLButtonElement>(null);

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
  // A changed svg keeps showing the previous image until its new URL exists, so the tools and
  // an open viewer survive re-renders.
  if (svg !== undefined && shown) {
    return (
      <figure className="diagram" data-diagram={kind} data-state="ready" aria-busy={busy}>
        <div className="diagram-tools">
          {tools}
          <button
            type="button"
            className="diagram-tool"
            aria-pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
          >
            Source
          </button>
          <button
            ref={fullScreenButton}
            type="button"
            className="diagram-tool"
            onClick={() => setFullScreen(true)}
          >
            Full screen
          </button>
        </div>
        {showSource ? (
          <pre className="diagram-source">
            <code>{source}</code>
          </pre>
        ) : (
          <img className="diagram-img" src={shown.url} alt={ALT[kind]} />
        )}
        {fullScreen && (
          <DiagramViewer
            kind={kind}
            url={shown.url}
            onClose={() => {
              setFullScreen(false);
              fullScreenButton.current?.focus();
            }}
          />
        )}
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
