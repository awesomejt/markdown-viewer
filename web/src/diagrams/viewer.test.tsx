import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiagramFigure from './DiagramFigure';
import DiagramViewer from './DiagramViewer';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:viewer');
  URL.revokeObjectURL = vi.fn();
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});

function transform() {
  return (screen.getByRole('img', { name: 'D2 diagram' }) as HTMLImageElement).style.transform;
}

describe('DiagramFigure tools', () => {
  it('toggles between the diagram and its source', () => {
    render(<DiagramFigure kind="mermaid" source={'graph TD\n A-->B'} svg={SVG} />);
    const toggle = screen.getByRole('button', { name: 'Source' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('.diagram-source code')?.textContent).toBe('graph TD\n A-->B');
    fireEvent.click(toggle);
    expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    expect(document.querySelector('.diagram-source')).toBeNull();
  });

  it('has no tools while loading or on error', () => {
    const { rerender } = render(<DiagramFigure kind="d2" source="a" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<DiagramFigure kind="d2" source="a" error="bad" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the viewer open with the new image when the svg changes', () => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:v${++n}`);
    const { rerender } = render(<DiagramFigure kind="d2" source="a" svg={SVG} />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    rerender(<DiagramFigure kind="d2" source="b" svg={'<svg id="b"/>'} busy />);
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute('src', 'blob:v2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v1');
    // Not unmounted and reopened in between (which would also reset pan/zoom).
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it('resets the viewer and source toggle after an error, with a fresh image URL', () => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:v${++n}`);
    const { rerender } = render(<DiagramFigure kind="mermaid" source="a" svg={SVG} />);
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<DiagramFigure kind="mermaid" source="a b" error="bad" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<DiagramFigure kind="mermaid" source="a" svg={SVG} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.diagram-source')).toBeNull();
    const img = screen.getByRole('img', { name: 'Mermaid diagram' });
    expect(img).toHaveAttribute('src', 'blob:v2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v1');
  });

  it('opens the full-screen viewer and returns focus on close', () => {
    render(<DiagramFigure kind="d2" source="a -> b" svg={SVG} />);
    const open = screen.getByRole('button', { name: 'Full screen' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'D2 diagram, full screen' });
    expect(dialog.parentElement).toBe(document.body);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'blob:viewer');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });
});

describe('DiagramViewer', () => {
  it('zooms with buttons and keys, and fits again', () => {
    render(<DiagramViewer kind="d2" url="blob:x" onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('80%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(transform()).toBe('translate(0px, 0px) scale(1)');

    fireEvent.keyDown(dialog, { key: '+' });
    expect(transform()).toBe('translate(0px, 0px) scale(1.25)');
    fireEvent.keyDown(dialog, { key: '-' });
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
    fireEvent.keyDown(dialog, { key: '=' });
    fireEvent.keyDown(dialog, { key: '+', ctrlKey: true });
    fireEvent.keyDown(dialog, { key: 'x' });
    expect(transform()).toBe('translate(0px, 0px) scale(1.25)');
    fireEvent.keyDown(dialog, { key: '0' });
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
  });

  it('pans with one pointer and pinches with two', () => {
    render(<DiagramViewer kind="d2" url="blob:x" onClose={() => undefined} />);
    const vp = document.querySelector('.diagram-viewport')!;
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 30, clientY: 15, pointerType: 'touch' });
    expect(transform()).toBe('translate(20px, 5px) scale(1)');
    // A pointer that never went down is ignored.
    fireEvent.pointerMove(vp, { pointerId: 9, clientX: 99, clientY: 99 });
    expect(transform()).toBe('translate(20px, 5px) scale(1)');

    fireEvent.pointerDown(vp, { pointerId: 2, clientX: 50, clientY: 15, pointerType: 'touch' });
    // Finger 2 moves away from finger 1 (at 30,15): distance 20 → 40 doubles the scale.
    fireEvent.pointerMove(vp, { pointerId: 2, clientX: 70, clientY: 15, pointerType: 'touch' });
    expect(transform()).toMatch(/scale\(2\)$/);
    fireEvent.pointerUp(vp, { pointerId: 2 });
    fireEvent.pointerCancel(vp, { pointerId: 1 });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(transform()).toMatch(/scale\(2\)$/);

    // Right mouse button does not start a pan.
    fireEvent.pointerDown(vp, { pointerId: 3, button: 2, pointerType: 'mouse', clientX: 0 });
    fireEvent.pointerMove(vp, { pointerId: 3, clientX: 50, pointerType: 'mouse' });
    expect(transform()).toMatch(/scale\(2\)$/);
  });

  it('zooms with the wheel and blocks page scrolling', () => {
    render(<DiagramViewer kind="d2" url="blob:x" onClose={() => undefined} />);
    const vp = document.querySelector('.diagram-viewport')!;
    const e = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      vp.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(screen.getByRole('img').style.transform).toMatch(/scale\(1\.2\d*\)$/);
  });

  it('focuses Close once opened', () => {
    render(<DiagramViewer kind="d2" url="blob:x" onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('focuses Close in the open-attribute fallback too', () => {
    // @ts-expect-error simulate a browser without modal dialogs
    HTMLDialogElement.prototype.showModal = undefined;
    render(<DiagramViewer kind="d2" url="blob:x" onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('falls back to the open attribute without showModal', () => {
    const onClose = vi.fn();
    // @ts-expect-error simulate a browser without modal dialogs
    HTMLDialogElement.prototype.showModal = undefined;
    // @ts-expect-error same for close
    HTMLDialogElement.prototype.close = undefined;
    render(<DiagramViewer kind="mermaid" url="blob:x" onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
