import { useState } from 'react';
import type { PrefsError, Warning } from '../api/types';
import { useSettings } from './useSettings';

export const BANNER_DISMISS_KEY = 'mdv-prefs-banner-dismissed';

/** A short stable signature of what the banner shows, so a different problem shows again. */
export function bannerSignature(error: PrefsError | null, warnings: Warning[]): string {
  const text = JSON.stringify([
    error && [error.code, error.message, error.line],
    warnings.map((w) => [w.code, w.message, w.key, w.ref, w.line]),
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(BANNER_DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Dismissible notice above the content: a fatal preferences problem or a list of warnings. */
export function PrefsBanner() {
  const { error, warnings } = useSettings();
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  if (!error && warnings.length === 0) return null;
  const sig = bannerSignature(error, warnings);
  if (dismissed === sig) return null;

  const dismiss = () => {
    setDismissed(sig);
    try {
      window.sessionStorage.setItem(BANNER_DISMISS_KEY, sig);
    } catch {
      // Storage unavailable: the dismissal lasts until reload.
    }
  };

  return (
    <div className="prefs-banner" role={error ? 'alert' : 'status'}>
      <div className="prefs-banner-body">
        {error ? <p>Preferences file problem: {error.message}. Using defaults.</p> : null}
        {warnings.length > 0 && (
          <details>
            <summary>
              {warnings.length} preference {warnings.length === 1 ? 'warning' : 'warnings'}
            </summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>
                  {w.message}
                  {w.key || w.ref ? <code> {w.key ?? w.ref}</code> : null}
                  {w.line !== undefined ? <span className="muted"> line {w.line}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <button
        type="button"
        className="btn"
        aria-label="Dismiss preferences notice"
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  );
}
