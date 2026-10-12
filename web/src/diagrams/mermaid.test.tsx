import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MermaidDiagram from './MermaidDiagram';
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
    expect(document.body.querySelector('[id^="dmdv-mermaid"]')).toBeNull();
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
    render(<MermaidDiagram source="graph TD; A-->B" />);
    await screen.findByRole('img');
    act(() => setTheme('dark'));
    await waitFor(() =>
      expect(mocks.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' })),
    );
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1'));
  });

  it('revokes the object URL on unmount', async () => {
    const { unmount } = render(<MermaidDiagram source="graph TD; A-->B" />);
    await screen.findByRole('img');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });
});
