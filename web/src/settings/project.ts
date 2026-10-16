import type { SettingsLayer } from './types';

/**
 * The project settings layer; `undefined` outside a project. PJ5a replaces this with the
 * settings of the open project (once its query has succeeded).
 */
export function useProjectLayer(): SettingsLayer | undefined {
  return undefined;
}
