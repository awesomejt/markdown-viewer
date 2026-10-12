import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ALT, type DiagramKind } from './kinds';
import {
  FIT,
  panBy,
  pinch,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
  type Point,
  type View,
} from './panzoom';

/**
 * Full-screen modal for one rendered diagram (FR-4.7): drag to pan, wheel or two-finger pinch
 * to zoom, plus buttons and `+`/`-`/`0` keys. It shows the figure's blob URL, so the SVG
 * still never enters the app DOM. Portaled to `body` so document styles do not apply.
 */
export default function DiagramViewer({
  kind,
  url,
  onClose,
}: {
  kind: DiagramKind;
  url: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [view, setView] = useState<View>(FIT);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    // `autoFocus` would run before the dialog is open, so focus Close explicitly.
    closeButton.current?.focus();
  }, []);

  // React registers wheel listeners as passive, so preventDefault needs a native one.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = local(el, e.clientX, e.clientY);
      setView((v) => zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), at));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; tracking still works.
    }
    pointers.current.set(e.pointerId, local(e.currentTarget, e.clientX, e.clientY));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const next = local(e.currentTarget, e.clientX, e.clientY);
    const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1];
    map.set(e.pointerId, next);
    if (map.size === 1) setView((v) => panBy(v, next.x - prev.x, next.y - prev.y));
    else if (map.size === 2 && other) setView((v) => pinch(v, [prev, other], [next, other]));
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') setView((v) => zoomAt(v, ZOOM_STEP));
    else if (e.key === '-') setView((v) => zoomAt(v, 1 / ZOOM_STEP));
    else if (e.key === '0') setView(FIT);
    else return;
    e.preventDefault();
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="diagram-viewer"
      aria-label={`${ALT[kind]}, full screen`}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      <div className="diagram-viewer-bar">
        <button
          type="button"
          className="btn"
          aria-label="Zoom out"
          onClick={() => setView((v) => zoomAt(v, 1 / ZOOM_STEP))}
        >
          −
        </button>
        <span className="diagram-zoom" aria-live="polite">
          {Math.round(view.scale * 100)}%
        </span>
        <button
          type="button"
          className="btn"
          aria-label="Zoom in"
          onClick={() => setView((v) => zoomAt(v, ZOOM_STEP))}
        >
          +
        </button>
        <button type="button" className="btn" onClick={() => setView(FIT)}>
          Fit
        </button>
        <button
          ref={closeButton}
          type="button"
          className="btn diagram-viewer-close"
          onClick={() => {
            const d = dialog.current;
            if (d && typeof d.close === 'function') d.close();
            else onClose();
          }}
        >
          Close
        </button>
      </div>
      <div
        ref={viewport}
        className="diagram-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <img
          className="diagram-viewer-img"
          src={url}
          alt={ALT[kind]}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
    </dialog>,
    document.body,
  );
}

/** Client coordinates relative to the element's center. */
function local(el: Element, clientX: number, clientY: number): Point {
  const r = el.getBoundingClientRect();
  return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
}
