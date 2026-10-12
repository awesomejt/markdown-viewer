import { pickAnchor, type ScrollAnchor } from './logic';

export interface ScrollSnapshot {
  anchor: ScrollAnchor | null;
  scrollTop: number;
}

/** Record the heading nearest the viewport top (plus the raw scroll position as fallback). */
export function captureScroll(container: ParentNode): ScrollSnapshot {
  const headings = Array.from(container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).map(
    (el) => ({ id: el.id, top: el.getBoundingClientRect().top }),
  );
  return { anchor: pickAnchor(headings), scrollTop: window.scrollY };
}

/** Put the same heading back at the same offset; otherwise restore the previous scrollTop. */
export function restoreScroll(container: ParentNode, snap: ScrollSnapshot): void {
  if (snap.anchor) {
    const el = Array.from(container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(
      (h) => h.id === snap.anchor?.id,
    );
    if (el) {
      window.scrollBy(0, el.getBoundingClientRect().top - snap.anchor.offset);
      return;
    }
  }
  window.scrollTo(0, snap.scrollTop);
}
