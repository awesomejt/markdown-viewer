import { screen } from '@testing-library/react';

/**
 * Wait options for Shiki output. A cold highlighter start (grammar + theme load) can exceed
 * the 1 s `waitFor` default when the suite runs under load (FIX-29).
 */
export const SHIKI_WAIT = { timeout: 5000 };

/**
 * Finds the `<pre>` showing `text`, before or after Shiki splits its lines into token spans
 * (a plain `findByText` stops matching once highlighting lands; FIX-29).
 */
export function findCodeText(text: RegExp) {
  return screen.findByText(
    (_, el) => el?.tagName === 'PRE' && text.test(el.textContent ?? ''),
    {},
    SHIKI_WAIT,
  );
}
