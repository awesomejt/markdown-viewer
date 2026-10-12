import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

vi.mock('../diagrams/mermaid', () => ({ renderMermaid: vi.fn(async () => '<svg/>') }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/render/d2')) return new Response('<svg/>');
      if (url.startsWith('/api/roots')) return Response.json({ roots: [] });
      if (url.includes('missing')) {
        return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 });
      }
      if (url.includes('.mmd') || url.includes('.d2')) return new Response('a -> b');
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

  it('renders .mmd and .d2 files as full-page diagrams', async () => {
    renderAt('/view/r/d/flow.mmd');
    expect(await screen.findByRole('heading', { name: 'flow.mmd' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    cleanup();
    renderAt('/view/r/d/arch.D2');
    expect(await screen.findByRole('heading', { name: 'arch.D2' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'D2 diagram' })).toBeInTheDocument();
  });

  it('keeps the placeholder for other kinds', () => {
    renderAt('/view/r/pic.png');
    expect(screen.getByText(/not implemented yet/)).toBeInTheDocument();
  });
});
