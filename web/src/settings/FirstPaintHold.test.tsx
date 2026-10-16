import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstPaintHold } from './FirstPaintHold';
import { PREFS_CACHE_KEY } from './prefsCache';

function mount(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FirstPaintHold>
        <p>content</p>
      </FirstPaintHold>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FirstPaintHold', () => {
  it('holds the outlet until the prefs settle', async () => {
    let release: (r: Response) => void = () => {};
    mount(() => new Promise<Response>((res) => (release = res)));
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    await act(async () => {
      release(Response.json({ configured: false, settings: {}, warnings: [], error: null }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('releases after 300 ms when the request is still pending', async () => {
    mount(() => new Promise<Response>(() => {}));
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('releases when the request fails', async () => {
    mount(() => Promise.resolve(new Response('', { status: 404 })));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('caches the sanitized settings on success', async () => {
    mount(() =>
      Promise.resolve(
        Response.json({
          configured: true,
          settings: { theme: 'dark', bogus: 1, fontSize: 999 },
          warnings: [],
          error: null,
        }),
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(JSON.parse(window.localStorage.getItem(PREFS_CACHE_KEY) ?? 'null')).toEqual({
      theme: 'dark',
    });
  });
});
