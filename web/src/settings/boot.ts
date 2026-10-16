import { parseProjectParam } from '../api/client';
import { applySettings } from './apply';
import { readDeviceLayer } from './device';
import { migrateSettings } from './migrate';
import { readPrefsCache } from './prefsCache';
import { applyRegistry, resolveSettings } from './resolve';
import { DEFAULTS } from './types';

/**
 * Runs before React renders: migrates the old storage, then applies the cached prefs plus the
 * device choices (the project's own inside `?project=`) so a returning device does not flash. The
 * project settings layer itself arrives with its query.
 */
export function bootSettings(): void {
  migrateSettings();
  // With `?project=` in the URL the device layer is that project's own choices.
  const project = parseProjectParam(new URLSearchParams(window.location.search).get('project'));
  const { resolved } = applyRegistry(
    resolveSettings(DEFAULTS, readPrefsCache(), undefined, readDeviceLayer(project)),
    DEFAULTS,
  );
  applySettings(resolved);
}
