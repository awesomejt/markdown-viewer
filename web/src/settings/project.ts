import { useMemo } from 'react';
import { useProject } from '../project/context';
import { sanitizeLayer } from './sanitize';
import type { SettingsLayer } from './types';

/**
 * The project settings layer; `undefined` outside a project and until the query for the current
 * `?project=` has data (the query has no placeholder, so another project's settings never show).
 */
export function useProjectLayer(): SettingsLayer | undefined {
  const { ref, query } = useProject();
  const settings = ref ? query?.data?.settings : undefined;
  return useMemo(() => (settings === undefined ? undefined : sanitizeLayer(settings)), [settings]);
}
