import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      if (url.startsWith('/api/list')) {
        const p = new URL(url, 'http://x').searchParams.get('path') ?? '';
        const e = (name: string, kind: string, size = 10) => ({
          name,
          type: 'file',
          kind,
          size,
          mtime: '2026-01-02T03:04:05Z',
        });
        const entries =
          p === 'f'
            ? [
                e('pic.png', 'image'),
                e('n.txt', 'text'),
                e('blob.bin', 'other', 2048),
                e('big.txt', 'text', 6 * 1048576),
              ]
            : [];
        return Response.json({ root: 'r', path: p, truncated: false, entries });
      }
      if (url.includes('big.txt')) {
        if (url.includes('force=1')) return new Response('BIG BODY');
        return Response.json({ error: { code: 'too_large', message: 'x' } }, { status: 413 });
      }
      if (url.includes('n.txt')) return new Response('plain <b>text</b>');
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

  it('shows images inline without referrer', async () => {
    renderAt('/view/r/f/pic.png');
    const img = await screen.findByRole('img', { name: 'pic.png' });
    expect(img).toHaveAttribute('src', '/api/file?root=r&path=f%2Fpic.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('shows text files in a pre without interpreting markup', async () => {
    renderAt('/view/r/f/n.txt');
    const pre = await screen.findByText('plain <b>text</b>');
    expect(pre.tagName).toBe('PRE');
  });

  it('offers a download link for other files', async () => {
    renderAt('/view/r/f/blob.bin');
    const link = await screen.findByRole('link', { name: /Download blob\.bin/ });
    expect(link).toHaveAttribute('href', '/api/file?root=r&path=f%2Fblob.bin');
    expect(link).toHaveAttribute('download', 'blob.bin');
  });

  it('asks before loading a file over the size limit', async () => {
    renderAt('/view/r/f/big.txt');
    expect(await screen.findByText('File is 6.0 MB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load anyway' }));
    expect(await screen.findByText('BIG BODY')).toBeInTheDocument();
  });

  it('falls back to the extension when the listing has no entry', async () => {
    renderAt('/view/r/g/big.txt');
    expect(await screen.findByRole('link', { name: /Download big\.txt/ })).toBeInTheDocument();
  });
});
