import { applyTheme } from '../app/theme';
import type { ContentWidth, Resolved } from './types';

/** Max width of the document column per setting; `normal` is the original 50rem. */
export const CONTENT_WIDTH: Record<ContentWidth, string> = {
  narrow: '40rem',
  normal: '50rem',
  wide: '70rem',
  full: '100%',
};

/**
 * Applies resolved settings to the document: `data-theme` (and the theme-color metas),
 * `data-style`, `data-font`, `data-code-font` and the `--mdv-*` variables. No React; the boot
 * step and `useApplySettings` share it. Values come from the sanitizer and the registry.
 */
export function applySettings(r: Resolved): void {
  applyTheme(r.theme);
  const el = document.documentElement;
  el.dataset.style = r.style;
  el.dataset.font = r.font;
  el.dataset.codeFont = r.codeFont;
  el.style.setProperty('--mdv-font-size', `${r.fontSize}px`);
  el.style.setProperty('--mdv-text-scale', String(r.textScale));
  el.style.setProperty('--mdv-line-height', String(r.lineHeight));
  el.style.setProperty('--mdv-content-width', CONTENT_WIDTH[r.contentWidth]);
}
