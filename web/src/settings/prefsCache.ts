import { sanitizeLayer } from './sanitize';
import type { SettingsLayer } from './types';

export const PREFS_CACHE_KEY = 'mdv-prefs-cache';

/** The last sanitized prefs settings, or `{}`. Never throws; the content is sanitized again. */
export function readPrefsCache(): SettingsLayer {
  try {
    const raw = window.localStorage.getItem(PREFS_CACHE_KEY);
    return raw === null ? {} : sanitizeLayer(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writePrefsCache(layer: SettingsLayer): void {
  try {
    window.localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(layer));
  } catch {
    // Storage unavailable: the next load just has no cache.
  }
}
