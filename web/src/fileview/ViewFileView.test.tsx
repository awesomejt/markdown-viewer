import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';

const mtime = '2026-01-02T03:04:05Z';
const yaml = 'version: 1\nname: Docker course\n';

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url, 'http://x');
      if (u.pathname === '/api/roots') {
        return Response.json({ roots: [{ name: 'r', watch: 'poll', available: true }] });
      }
      if (u.pathname === '/api/project') {
        return Response.json({
          root: 'r',
          path: u.searchParams.get('path'),
          name: 'Docker course',
          open: null,
          entries: [],
          settings: {},
          warnings: [],
        });
      }
      if (u.pathname === '/api/file') {
        return new Response(yaml, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      // The listing knows the project file; the 'lost' folder has no listing at all.
      if (u.searchParams.get('path') === 'proj') {
        return Response.json({
          root: 'r',
          path: 'proj',
          truncated: false,
          entries: [{ name: 'c.mdv.yaml', type: 'file', kind: 'project', size: 30, mtime }],
        });
      }
      return new Response('', { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ViewFileView with project files', () => {
  it("opens the open project's file as YAML text with ?source=1", async () => {
    renderAt('/view/r/proj/c.mdv.yaml?project=r:proj/c.mdv.yaml&source=1');
    expect(await screen.findByRole('heading', { name: 'c.mdv.yaml' })).toBeInTheDocument();
    expect(await screen.findByText(/name: Docker course/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
  });

  it('falls back to the project kind (text view) when the listing is unavailable', async () => {
    renderAt('/view/r/lost/.mdv.yml?project=r:lost/.mdv.yml&source=1');
    expect(await screen.findByRole('heading', { name: '.mdv.yml' })).toBeInTheDocument();
    expect(await screen.findByText(/name: Docker course/)).toBeInTheDocument();
  });
});
