import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import D2Diagram from './D2Diagram';
import { renderWithClient, setTheme } from './test-utils';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setTheme('light');
  fetchMock = vi.fn(
    async () => new Response(SVG, { headers: { 'Content-Type': 'image/svg+xml' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:d2-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setTheme('light');
});

const body = (call: number) =>
  JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

describe('D2Diagram', () => {
  it('posts source and theme and shows the svg as a blob image', async () => {
    const { container } = renderWithClient(<D2Diagram source="a -> b" />);
    const img = await screen.findByRole('img', { name: 'D2 diagram' });
    expect(img).toHaveAttribute('src', 'blob:d2-1');
    expect(container.querySelector('figure')).toHaveAttribute('data-state', 'ready');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/render/d2');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect(body(0)).toEqual({ source: 'a -> b', theme: 'light' });
  });

  it('shows the server message and source on 422', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 'render_error', message: 'broken.d2:1:6: expected map' } },
        { status: 422 },
      ),
    );
    renderWithClient(<D2Diagram source="a -> {" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('D2 diagram error');
    expect(alert).toHaveTextContent('broken.d2:1:6: expected map');
    expect(alert.querySelector('pre code')?.textContent).toBe('a -> {');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a generic message with the code after retrying 503', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: { code: 'busy', message: 'busy' } }, { status: 503 }),
    );
    renderWithClient(<D2Diagram source="a -> b" />, 2);
    // shouldRetry overrides the client default, so it retries twice with backoff.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent('(busy)');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it('refetches with the dark theme when data-theme changes', async () => {
    renderWithClient(<D2Diagram source="a -> b" />);
    await screen.findByRole('img');
    act(() => setTheme('dark'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual({ source: 'a -> b', theme: 'dark' });
  });

  it('re-renders with the chosen layout and keeps the old image meanwhile', async () => {
    const { container } = renderWithClient(<D2Diagram source="a -> b" />);
    await screen.findByRole('img');
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    const select = screen.getByRole('combobox', { name: 'Layout' });
    expect(select).toHaveValue('');
    fireEvent.change(select, { target: { value: 'elk' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual({ source: 'a -> b', theme: 'light', layout: 'elk' });
    const fig = container.querySelector('figure')!;
    expect(fig).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:d2-1');
    expect(screen.getByRole('combobox', { name: 'Layout' })).toBe(select);
    await act(async () =>
      release(new Response('<svg id="elk"/>', { headers: { 'Content-Type': 'image/svg+xml' } })),
    );
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:d2-2'));
    expect(fig).toHaveAttribute('aria-busy', 'false');
  });
});
