import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import type { RouterProviderProps } from 'react-router';
import { LiveProvider } from '../live/LiveProvider';
import { routes } from './routes';
import './app.css';

export default function App({ router }: { router?: RouterProviderProps['router'] }) {
  const [client] = useState(() => new QueryClient());
  const [r] = useState(() => router ?? createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <LiveProvider>
        <RouterProvider router={r} />
      </LiveProvider>
    </QueryClientProvider>
  );
}
