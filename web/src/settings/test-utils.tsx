import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Wrapper for hooks that read the prefs query (`useSettings` and friends). */
export function clientWrapper(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
