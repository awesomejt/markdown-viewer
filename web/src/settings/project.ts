import { useMemo } from 'react';
import type { Warning } from '../api/types';
import { useProject } from '../project/context';
import { applyRegistry, resolveSettings } from './resolve';
import { sanitizeLayer } from './sanitize';
import { DEFAULTS, type SettingsLayer } from './types';

/**
 * The project settings layer; `undefined` outside a project, until the query for the current
 * `?project=` has data (the query has no placeholder, so another project's settings never show)
 * and after a 404 (the last good data is kept on other refetch failures).
 */
export function useProjectLayer(): SettingsLayer | undefined {
  const { data } = useProject();
  const settings = data?.settings;
  return useMemo(() => (settings === undefined ? undefined : sanitizeLayer(settings)), [settings]);
}

/**
 * The project's warnings: the server's plus the client's for the project layer (an unknown
 * style or font name), in the same form the preferences banner shows them.
 */
export function useProjectWarnings(): Warning[] {
  const { data } = useProject();
  const layer = useProjectLayer();
  return useMemo(() => {
    const client = layer
      ? applyRegistry(resolveSettings(DEFAULTS, undefined, layer, {}), DEFAULTS).warnings
      : [];
    return [...(data?.warnings ?? []), ...client];
  }, [data, layer]);
}
