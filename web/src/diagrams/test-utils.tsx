import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

export function renderWithClient(ui: ReactElement, retry: boolean | number = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
}
