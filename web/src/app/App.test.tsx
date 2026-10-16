import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';
import { RELOAD_FLAG, installPreloadErrorHandler } from './preloadError';
import indexHtml from '../../index.html?raw';
import { THEME_COLOR, THEME_STORAGE_KEY } from './theme';

const rootsBody = {
  roots: [
    { name: 'docs', watch: 'poll', available: true },
    { name: 'nas', watch: 'poll', available: false },
  ],
};

const emptyPrefs = { configured: false, settings: {}, warnings: [], error: null };
let prefsBody: unknown = emptyPrefs;

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
      if (url.startsWith('/api/prefs')) return Response.json(prefsBody);
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
  prefsBody = emptyPrefs;
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
  it('selects a theme, applies data-theme and persists the choice', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const select = await screen.findByRole('combobox', { name: 'Theme' });
    expect(select).toHaveValue('default');
    expect(screen.getByRole('option', { name: 'Default (Auto)' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.selectOptions(select, 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await user.selectOptions(select, 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('Default removes the device choice and returns to the lower layers', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const user = userEvent.setup();
    renderAt('/');
    const select = await screen.findByRole('combobox', { name: 'Theme' });
    expect(select).toHaveValue('dark');
    await user.selectOptions(select, 'default');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('an explicit Auto is stored even though it equals the default', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Theme' }), 'system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('shows the preferences theme in the Default label and applies it', async () => {
    prefsBody = { configured: true, settings: { theme: 'dark' }, warnings: [], error: null };
    renderAt('/');
    expect(await screen.findByRole('option', { name: 'Default (Dark)' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('default');
  });

  it('follows the OS in system mode', async () => {
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
    await screen.findByRole('combobox', { name: 'Theme' });
    expect(document.documentElement.dataset.theme).toBe('light');
    dark = true;
    act(() => listener?.());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps every theme-color meta on the resolved theme', async () => {
    const metas = ['light', 'dark'].map((scheme) => {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.media = `(prefers-color-scheme: ${scheme})`;
      document.head.append(m);
      return m;
    });
    try {
      const user = userEvent.setup();
      renderAt('/');
      const select = await screen.findByRole('combobox', { name: 'Theme' });
      expect(metas.map((m) => m.content)).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
      await user.selectOptions(select, 'dark');
      expect(metas.map((m) => m.content)).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    } finally {
      metas.forEach((m) => m.remove());
    }
  });

  // The header background match is checked in e2e (shell.spec.ts).
  it('theme colors match index.html', () => {
    for (const scheme of ['light', 'dark'] as const) {
      expect(indexHtml).toContain(
        `<meta name="theme-color" content="${THEME_COLOR[scheme]}" media="(prefers-color-scheme: ${scheme})" />`,
      );
    }
  });

  it('uses a stored override', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderAt('/');
    await screen.findByRole('combobox', { name: 'Theme' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('applied settings', () => {
  afterEach(() => {
    const el = document.documentElement;
    el.removeAttribute('style');
    for (const a of ['data-style', 'data-font', 'data-code-font']) el.removeAttribute(a);
  });

  it('sets data attributes and CSS variables from preferences, and the banner shows warnings', async () => {
    prefsBody = {
      configured: true,
      settings: { fontSize: 20, lineHeight: 2, contentWidth: 'full', font: 'serif' },
      warnings: [{ code: 'unknown_key', message: 'unknown key "x"', key: 'x', line: 2 }],
      error: null,
    };
    renderAt('/');
    const el = document.documentElement;
    await waitFor(() => expect(el.style.getPropertyValue('--mdv-font-size')).toBe('20px'));
    expect(el.style.getPropertyValue('--mdv-line-height')).toBe('2');
    expect(el.style.getPropertyValue('--mdv-content-width')).toBe('100%');
    expect(el.style.getPropertyValue('--mdv-text-scale')).toBe('1');
    expect(el.dataset.style).toBe('github');
    expect(el.dataset.codeFont).toBe('mono');
    // The unknown font falls back to the default and warns on the client.
    expect(el.dataset.font).toBe('system');
    expect(await screen.findByText('2 preference warnings')).toBeInTheDocument();
  });

  it('shows the fatal preferences error', async () => {
    prefsBody = {
      configured: true,
      settings: {},
      warnings: [],
      error: { code: 'prefs_invalid', message: 'bad file', line: 1 },
    };
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preferences file problem: bad file. Using defaults.',
    );
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
