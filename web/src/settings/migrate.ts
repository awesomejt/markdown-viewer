import { THEME_STORAGE_KEY } from '../app/theme';
import { MD_ONLY_STORAGE_KEY, SHOW_HIDDEN_STORAGE_KEY, SORT_STORAGE_KEY } from '../browse/logic';

export const SETTINGS_VERSION_KEY = 'mdv-settings-v';
const VERSION = 2;

// The old UI wrote these built-in defaults on every cycle or uncheck, so they are not choices.
const OLD_DEFAULTS: readonly (readonly [string, string])[] = [
  [THEME_STORAGE_KEY, 'system'],
  [MD_ONLY_STORAGE_KEY, '0'],
  [SHOW_HIDDEN_STORAGE_KEY, '0'],
  [SORT_STORAGE_KEY, 'name'],
];

/** One-time migration (flag `mdv-settings-v=2`). Safe to call again; tolerates storage failures. */
export function migrateSettings(): void {
  try {
    const flag = Number(window.localStorage.getItem(SETTINGS_VERSION_KEY));
    if (flag >= VERSION) return;
    for (const [key, value] of OLD_DEFAULTS) {
      if (window.localStorage.getItem(key) === value) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(SETTINGS_VERSION_KEY, String(VERSION));
  } catch {
    // Storage unavailable: nothing to migrate.
  }
}
