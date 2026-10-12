import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MermaidDiagram from './MermaidDiagram';
import { preloadMermaid, renderMermaid } from './mermaid';
import { setTheme } from './test-utils';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  loaded: vi.fn(),
}));

vi.mock('mermaid', () => {
  mocks.loaded();
  return { default: { initialize: mocks.initialize, render: mocks.render } };
});

let urlCount = 0;
beforeEach(() => {
  setTheme('light');
  urlCount = 0;
  mocks.initialize.mockReset();
  mocks.render.mockReset();
  mocks.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  URL.createObjectURL = vi.fn(() => `blob:mock-${++urlCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  setTheme('light');
});

describe('MermaidDiagram', () => {
  it('renders a valid diagram as a blob image with strict settings', async () => {
    const { container } = render(<MermaidDiagram source="graph TD; A-->B" />);
    const img = await screen.findByRole('img', { name: 'Mermaid diagram' });
    expect(img).toHaveAttribute('src', 'blob:mock-1');
    expect(container.querySelector('figure')).toHaveAttribute('data-state', 'ready');
    expect(container.querySelector('svg')).toBeNull();
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'default',
      }),
    );
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
  });

  it('shows the message and source for invalid diagrams and cleans leftovers', async () => {
    mocks.render.mockImplementation(async (id: string) => {
      const el = document.createElement('div');
      el.id = `d${id}`;
      document.body.appendChild(el);
      throw new Error('Parse error on line 2');
    });
    render(<MermaidDiagram source="graph TD\n A --> -->" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Mermaid diagram error');
    expect(alert).toHaveTextContent('Parse error on line 2');
    expect(alert.querySelector('pre code')?.textContent).toContain('A --> -->');
    expect(document.body.querySelector('[id^="dmdvMermaid"]')).toBeNull();
  });

  it('uses ids a heading slug cannot produce, so cleanup keeps headings', async () => {
    // Slugs are lowercase: these are what a heading such as "mdvmermaid 1" would get.
    const headings = Array.from({ length: 100 }, (_, i) =>
      [`mdvmermaid-${i}`, `dmdvmermaid-${i}`, `mdv-mermaid-${i}`, `dmdv-mermaid-${i}`].map((id) => {
        const h = document.createElement('h2');
        h.id = id;
        document.body.appendChild(h);
        return h;
      }),
    ).flat();
    let used = '';
    mocks.render.mockImplementation(async (id: string) => {
      used = id;
      throw new Error('boom');
    });
    render(<MermaidDiagram source="x" />);
    await screen.findByRole('alert');
    expect(headings.every((h) => h.isConnected)).toBe(true);
    expect(used).not.toBe(used.toLowerCase());
    expect(used).toMatch(/^[A-Za-z][\w-]*$/); // safe in Mermaid's unescaped `#id` CSS selectors
    headings.forEach((h) => h.remove());
  });

  it('uses a fallback message for non-Error rejections', async () => {
    mocks.render.mockRejectedValue('');
    render(<MermaidDiagram source="x" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not render the diagram.');
  });

  it('serializes renders', async () => {
    let release!: (v: { svg: string }) => void;
    mocks.render.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release)),
    );
    render(
      <>
        <MermaidDiagram source="one" />
        <MermaidDiagram source="two" />
      </>,
    );
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.render).toHaveBeenCalledTimes(1);
    await act(async () => release({ svg: '<svg/>' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  });

  it('re-renders with the dark theme when data-theme changes', async () => {
    const { container } = render(<MermaidDiagram source="graph TD; A-->B" />);
    await screen.findByRole('img');
    let release!: (v: { svg: string }) => void;
    mocks.render.mockImplementationOnce(() => new Promise((r) => (release = r)));
    act(() => setTheme('dark'));
    await waitFor(() =>
      expect(mocks.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' })),
    );
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    // The light diagram stays (busy) until the dark one is ready.
    const fig = container.querySelector('figure')!;
    expect(fig).toHaveAttribute('data-state', 'ready');
    expect(fig).toHaveAttribute('aria-busy', 'true');
    await act(async () => release({ svg: '<svg id="dark"/>' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1'));
    expect(fig).toHaveAttribute('aria-busy', 'false');
  });

  it('revokes the object URL on unmount', async () => {
    const { unmount } = render(<MermaidDiagram source="graph TD; A-->B" />);
    await screen.findByRole('img');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  describe('render queue', () => {
    /** Makes every render wait for release(); returns the sources in the order they started. */
    function gate() {
      const started: string[] = [];
      const releases: Array<() => void> = [];
      mocks.render.mockImplementation(
        (_id: string, source: string) =>
          new Promise((resolve) => {
            started.push(source);
            releases.push(() => resolve({ svg: `<svg>${source}</svg>` }));
          }),
      );
      const next = async (n: number) => {
        await waitFor(() => expect(releases.length).toBe(n));
        await act(async () => releases[n - 1]!());
      };
      return { started, next };
    }

    it('runs high-priority jobs before earlier low-priority ones, then the rest', async () => {
      const { started, next } = gate();
      const first = renderMermaid('first', 'light');
      const low = renderMermaid('low', 'light', false);
      const high = renderMermaid('high', 'light', true);
      await next(1);
      await next(2);
      await next(3);
      expect(started).toEqual(['first', 'high', 'low']);
      await Promise.all([first.result, low.result, high.result]);
    });

    it('lets a promoted job jump ahead', async () => {
      const { started, next } = gate();
      const first = renderMermaid('first', 'light');
      const a = renderMermaid('a', 'light', false);
      const b = renderMermaid('b', 'light', false);
      b.promote();
      await next(1);
      await next(2);
      await next(3);
      expect(started).toEqual(['first', 'b', 'a']);
      await Promise.all([first.result, a.result, b.result]);
    });

    it('never renders a cancelled pending job and keeps serializing', async () => {
      const { started, next } = gate();
      const first = renderMermaid('first', 'light');
      const dropped = renderMermaid('dropped', 'light', false);
      const kept = renderMermaid('kept', 'light', false);
      dropped.cancel();
      await expect(dropped.result).rejects.toThrow('cancelled');
      await waitFor(() => expect(started).toEqual(['first']));
      await new Promise((r) => setTimeout(r, 20));
      expect(started).toEqual(['first']);
      await next(1);
      await next(2);
      expect(started).toEqual(['first', 'kept']);
      await Promise.all([first.result, kept.result]);
    });

    it('renders diagrams that scroll near the viewport before the others', async () => {
      const callbacks: IntersectionObserverCallback[] = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(cb: IntersectionObserverCallback) {
            callbacks.push(cb);
          }
          observe = vi.fn();
          disconnect = vi.fn();
        },
      );
      try {
        const { started, next } = gate();
        const blocker = renderMermaid('blocker', 'light');
        render(
          <>
            <MermaidDiagram source="far" />
            <MermaidDiagram source="near" />
          </>,
        );
        await waitFor(() => expect(callbacks).toHaveLength(2));
        act(() =>
          callbacks[1]!([{ isIntersecting: true } as IntersectionObserverEntry], {} as never),
        );
        await next(1);
        await next(2);
        await next(3);
        expect(started).toEqual(['blocker', 'near', 'far']);
        await blocker.result;
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('preloads the chunk without surfacing a rejection', async () => {
      // The returned promise is swallowed internally, so nothing is left to reject unhandled.
      expect(preloadMermaid()).toBeUndefined();
      await new Promise((r) => setTimeout(r, 20));
    });
  });
});
