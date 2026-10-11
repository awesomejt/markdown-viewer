import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/roots')) return Response.json({ roots: [] });
      if (url.includes('missing')) {
        return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 });
      }
      return new Response('# Hello\n\n[s](./b.md)', {
        headers: { 'Content-Type': 'text/markdown' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ViewFileView', () => {
  it('renders markdown files via the lazy MarkdownView', async () => {
    renderAt('/view/r/docs/a.MD?ws=docs');
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 's' })).toHaveAttribute(
      'href',
      '/view/r/docs/b.md?ws=docs',
    );
  });

  it('shows the error state when the file is missing', async () => {
    renderAt('/view/r/missing.md');
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('keeps the placeholder for other kinds', () => {
    renderAt('/view/r/pic.png');
    expect(screen.getByText(/not implemented yet/)).toBeInTheDocument();
  });
});
