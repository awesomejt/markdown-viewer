import { useQuery } from '@tanstack/react-query';
import { getPrefs } from '../api/client';
import { queryKeys, shouldRetry } from '../api/hooks';
import { sanitizeLayer } from './sanitize';
import { writePrefsCache } from './prefsCache';

/**
 * `GET /api/prefs`, key `['prefs']`, no `placeholderData`. The sanitized settings are cached in
 * localStorage for the boot step. Only the layout fetches (`enabled`); other readers pass
 * `false` to observe the shared result without triggering a request.
 */
export function usePrefs(enabled = true) {
  return useQuery({
    queryKey: queryKeys.prefs(),
    queryFn: async ({ signal }) => {
      const res = await getPrefs(signal);
      writePrefsCache(sanitizeLayer(res?.settings));
      return res;
    },
    retry: shouldRetry,
    staleTime: 0,
    enabled,
  });
}
