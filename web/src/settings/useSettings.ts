import { useMemo, useState } from 'react';
import type { PrefsError, Warning } from '../api/types';
import type { ThemeMode } from '../app/theme';
import type { SortKey } from '../browse/logic';
import { setDeviceChoice, useDeviceLayer } from './device';
import { readPrefsCache } from './prefsCache';
import { useProjectLayer } from './project';
import { applyRegistry, resolveSettings } from './resolve';
import { sanitizeLayer } from './sanitize';
import { DEFAULTS, type Resolved } from './types';
import { usePrefs } from './usePrefs';

export interface UseSettings {
  resolved: Resolved;
  /** What the theme resolves to without a device choice (the "Default (...)" label). */
  defaultTheme: ThemeMode;
  /** Server warnings (prefs, and project from PJ5a) merged with client warnings. */
  warnings: Warning[];
  /** Fatal preferences file problem; defaults are used. */
  error: PrefsError | null;
  setTheme(v: ThemeMode | undefined): void;
  setMarkdownOnly(v: boolean | undefined): void;
  setShowHidden(v: boolean | undefined): void;
  setSort(v: SortKey | undefined): void;
}

const setters = {
  setTheme: (v: ThemeMode | undefined) => setDeviceChoice('theme', v),
  setMarkdownOnly: (v: boolean | undefined) => setDeviceChoice('markdownOnly', v),
  setShowHidden: (v: boolean | undefined) => setDeviceChoice('showHidden', v),
  setSort: (v: SortKey | undefined) => setDeviceChoice('sort', v),
};

function isWarning(w: unknown): w is Warning {
  return (
    typeof w === 'object' &&
    w !== null &&
    typeof (w as Warning).code === 'string' &&
    typeof (w as Warning).message === 'string'
  );
}

function asError(e: unknown): PrefsError | null {
  return isWarning(e) ? (e as PrefsError) : null;
}

/**
 * Defaults + sanitized prefs (the cached copy until the request settles) + project layer
 * (PJ5a) + device choices, resolved. Existing consumers read the resolved value and write
 * device choices.
 */
export function useSettings(): UseSettings {
  const prefs = usePrefs(false);
  const project = useProjectLayer();
  const device = useDeviceLayer();
  const [cached] = useState(readPrefsCache);
  const data = prefs.data;
  const layer = useMemo(() => (data ? sanitizeLayer(data.settings) : cached), [data, cached]);
  const error = data ? asError(data.error) : null;

  const out = useMemo(() => {
    const { resolved, warnings } = applyRegistry(
      resolveSettings(DEFAULTS, layer, project, device),
      DEFAULTS,
    );
    const defaultTheme = resolveSettings(DEFAULTS, layer, project, {}).theme;
    return { resolved, warnings, defaultTheme };
  }, [layer, project, device]);

  const warnings = useMemo(
    () => [
      ...(data && Array.isArray(data.warnings) ? data.warnings.filter(isWarning) : []),
      ...out.warnings,
    ],
    [data, out.warnings],
  );

  return { resolved: out.resolved, defaultTheme: out.defaultTheme, warnings, error, ...setters };
}
