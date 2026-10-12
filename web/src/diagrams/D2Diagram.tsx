import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, renderD2, type D2Layout } from '../api/client';
import { shouldRetry } from '../api/hooks';
import DiagramFigure from './DiagramFigure';
import { useResolvedTheme } from './useResolvedTheme';

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return error.message;
    return `The server could not render this diagram (${error.code}).`;
  }
  return 'The diagram could not be rendered.';
}

export default function D2Diagram({ source }: { source: string }) {
  const theme = useResolvedTheme();
  // "Auto" sends no layout, so the source's d2-config layout-engine (or dagre) applies (R2.9).
  const [layout, setLayout] = useState<D2Layout>('');
  const query = useQuery({
    queryKey: ['d2', theme, layout, source],
    queryFn: ({ signal }) => renderD2(source, theme, signal, layout),
    retry: shouldRetry,
    staleTime: Infinity,
    // Keep the previous SVG (and the tools) on screen while a new layout, theme or source renders.
    placeholderData: keepPreviousData,
  });
  return (
    <DiagramFigure
      kind="d2"
      source={source}
      svg={query.data}
      error={query.isError ? describe(query.error) : undefined}
      busy={query.isPlaceholderData}
      tools={
        <label className="diagram-tool">
          Layout{' '}
          <select value={layout} onChange={(e) => setLayout(e.target.value as D2Layout)}>
            <option value="">Auto</option>
            <option value="dagre">dagre</option>
            <option value="elk">ELK</option>
          </select>
        </label>
      }
    />
  );
}
