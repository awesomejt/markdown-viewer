import { applySettings } from './apply';
import { readDeviceLayer } from './device';
import { migrateSettings } from './migrate';
import { readPrefsCache } from './prefsCache';
import { applyRegistry, resolveSettings } from './resolve';
import { DEFAULTS } from './types';

/**
 * Runs before React renders: migrates the old storage, then applies the cached prefs plus the
 * global device choices so a returning device does not flash. No project layer at boot.
 */
export function bootSettings(): void {
  migrateSettings();
  const { resolved } = applyRegistry(
    resolveSettings(DEFAULTS, readPrefsCache(), undefined, readDeviceLayer()),
    DEFAULTS,
  );
  applySettings(resolved);
}
