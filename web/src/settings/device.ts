import { useMemo, useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY, type ThemeMode } from '../app/theme';
import { createStoredStore, type StoredStore } from '../app/storedStore';
import {
  MD_ONLY_STORAGE_KEY,
  SHOW_HIDDEN_STORAGE_KEY,
  SORT_STORAGE_KEY,
  type SortKey,
} from '../browse/logic';
import type { DeviceLayer } from './types';

// Device choices (global scope, outside a project): `undefined` = no choice, and the key is
// absent. A choice is stored even when it equals a default, so later changes to the layers
// below do not silently change what the user picked.

const boolParse = (raw: string | null): boolean | undefined =>
  raw === '1' ? true : raw === '0' ? false : undefined;
const boolSerialize = (on: boolean | undefined): string | null =>
  on === undefined ? null : on ? '1' : '0';

export const themeStore = createStoredStore<ThemeMode | undefined>(
  THEME_STORAGE_KEY,
  (raw) => (raw === 'system' || raw === 'light' || raw === 'dark' ? raw : undefined),
  (v) => v ?? null,
);
export const mdOnlyStore = createStoredStore<boolean | undefined>(
  MD_ONLY_STORAGE_KEY,
  boolParse,
  boolSerialize,
);
export const showHiddenStore = createStoredStore<boolean | undefined>(
  SHOW_HIDDEN_STORAGE_KEY,
  boolParse,
  boolSerialize,
);
export const sortStore = createStoredStore<SortKey | undefined>(
  SORT_STORAGE_KEY,
  (raw) => (raw === 'name' || raw === 'date' ? raw : undefined),
  (v) => v ?? null,
);

const stores = [themeStore, mdOnlyStore, showHiddenStore, sortStore] as const;

/** Test hook: forget every cached device value. */
export function resetDeviceCaches(): void {
  for (const s of stores) s.reset();
}

type DeviceKey = 'theme' | 'markdownOnly' | 'showHidden' | 'sort';
const byKey: { [K in DeviceKey]: StoredStore<DeviceLayer[K]> } = {
  theme: themeStore,
  markdownOnly: mdOnlyStore,
  showHidden: showHiddenStore,
  sort: sortStore,
};

/**
 * Writes one device choice (`undefined` removes it). This is the seam for PJ5b: inside a
 * project the write goes to that project's entry instead of the global key.
 */
export function setDeviceChoice<K extends DeviceKey>(key: K, value: DeviceLayer[K]): void {
  (byKey[key] as StoredStore<DeviceLayer[K]>).set(value);
}

/** The device layer for the current scope (global only until PJ5b). */
export function useDeviceLayer(): DeviceLayer {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get);
  const markdownOnly = useSyncExternalStore(mdOnlyStore.subscribe, mdOnlyStore.get);
  const showHidden = useSyncExternalStore(showHiddenStore.subscribe, showHiddenStore.get);
  const sort = useSyncExternalStore(sortStore.subscribe, sortStore.get);
  return useMemo(
    () => ({ theme, markdownOnly, showHidden, sort }),
    [theme, markdownOnly, showHidden, sort],
  );
}

/** Non-React read of the global device layer (boot step). */
export function readDeviceLayer(): DeviceLayer {
  return {
    theme: themeStore.get(),
    markdownOnly: mdOnlyStore.get(),
    showHidden: showHiddenStore.get(),
    sort: sortStore.get(),
  };
}
