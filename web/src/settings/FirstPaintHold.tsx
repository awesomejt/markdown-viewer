import { useEffect, useState, type ReactNode } from 'react';
import { usePrefs } from './usePrefs';

export const FIRST_PAINT_HOLD_MS = 300;

/**
 * Holds the main outlet until `/api/prefs` settles or 300 ms pass, so a preference such as the
 * theme or font does not flash. `/api/prefs` never touches roots, so this is short. It fetches
 * the prefs for the app (the only enabled `usePrefs`).
 */
export function FirstPaintHold({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), FIRST_PAINT_HOLD_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (prefs.isPending && !timedOut) return null;
  return <>{children}</>;
}
