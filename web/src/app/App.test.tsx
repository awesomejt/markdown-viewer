import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';
import { RELOAD_FLAG, installPreloadErrorHandler } from './preloadError';
import { THEME_STORAGE_KEY } from './theme';

const rootsBody = {
  roots: [
    { name: 'docs', watch: 'poll', available: true },
    { name: 'nas', watch: 'poll', available: false },
  ],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/roots')) return Response.json(rootsBody);
      if (url.startsWith('/api/list')) {
        return Response.json(
          { error: { code: 'not_found', message: 'no such path' } },
          { status: 404 },
        );
      }
      return new Response('', { status: 404 });
    }),
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  mockApi();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe('shell', () => {
  it('lists roots at / and marks unavailable ones', async () => {
    renderAt('/');
    const list = await screen.findByRole('list', { name: 'Available roots' });
    expect(within(list).getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      '/browse/docs',
    );
    expect(within(list).queryByRole('link', { name: /nas/ })).not.toBeInTheDocument();
    expect(within(list).getByText('(unavailable)')).toBeInTheDocument();
  });

  it('shows the error state for a failed listing without retry for 404', async () => {
    renderAt('/browse/docs/missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders the 404 view for unknown routes', async () => {
    renderAt('/nope/nothing');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('decodes the path on the view route', async () => {
    renderAt('/view/docs/a%20b/c%23d.bin');
    expect(await screen.findByRole('heading', { name: 'c#d.bin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      '/api/file?root=docs&path=a+b%2Fc%23d.bin',
    );
  });
});

describe('theme', () => {
  it('cycles modes, applies data-theme and persists the choice', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const btn = await screen.findByRole('button', { name: /Theme: Auto/ });
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(btn);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await user.click(screen.getByRole('button', { name: /Theme: Light/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('restores a stored mode and follows the OS in system mode', async () => {
    let listener: (() => void) | undefined;
    let dark = false;
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, l: () => void) => (listener = l),
      removeEventListener: () => (listener = undefined),
    }));
    renderAt('/');
    await screen.findByRole('button', { name: /Theme: Auto/ });
    expect(document.documentElement.dataset.theme).toBe('light');
    dark = true;
    act(() => listener?.());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('uses a stored override', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderAt('/');
    await screen.findByRole('button', { name: /Theme: Dark/ });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('drawer', () => {
  it('opens, closes on Escape, backdrop and navigation', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const menu = screen.getByRole('button', { name: 'Open menu' });
    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(sidebar).not.toHaveClass('is-open');

    await user.click(menu);
    expect(sidebar).toHaveClass('is-open');
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(sidebar).not.toHaveClass('is-open');
    expect(menu).toHaveFocus();

    await user.click(menu);
    await user.click(screen.getByTestId('backdrop'));
    expect(sidebar).not.toHaveClass('is-open');

    await user.click(menu);
    await user.click(await within(sidebar).findByRole('link', { name: 'docs' }));
    await waitFor(() => expect(sidebar).not.toHaveClass('is-open'));
  });
});

describe('preload error handler', () => {
  afterEach(() => window.sessionStorage.clear());

  it('reloads once per session flag', () => {
    const reload = vi.fn();
    const uninstall = installPreloadErrorHandler(reload);
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('clears the flag after a successful load', () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(RELOAD_FLAG, '1');
    installPreloadErrorHandler(vi.fn());
    vi.advanceTimersByTime(6000);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).toBeNull();
    vi.useRealTimers();
  });
});
