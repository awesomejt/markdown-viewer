import { useQuery } from '@tanstack/react-query';
import { ApiError, renderD2 } from '../api/client';
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
  const query = useQuery({
    queryKey: ['d2', theme, source],
    queryFn: ({ signal }) => renderD2(source, theme, signal),
    retry: shouldRetry,
    staleTime: Infinity,
  });
  return (
    <DiagramFigure
      kind="d2"
      source={source}
      svg={query.data}
      error={query.isError ? describe(query.error) : undefined}
    />
  );
}
