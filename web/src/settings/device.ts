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

export const TEXT_SCALE_STORAGE_KEY = 'mdv-text-scale';
export const TEXT_SCALE_MIN = 50;
export const TEXT_SCALE_MAX = 200;
export const TEXT_SCALE_STEP = 10;

/** Rounds a percent to the nearest step and clamps it to the allowed range. */
function snapTextScale(percent: number): number {
  const stepped = Math.round(percent / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, stepped));
}

/**
 * One global per-device text scale in percent (50..200, steps of 10); `undefined` = no choice
 * (100 %). Not a per-project choice, so it is outside `setDeviceChoice`.
 */
export const textScaleStore = createStoredStore<number | undefined>(
  TEXT_SCALE_STORAGE_KEY,
  (raw) => {
    if (raw === null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? snapTextScale(n) : undefined;
  },
  (v) => (v === undefined ? null : String(v)),
);

/** Sets the text scale in percent; values are rounded and clamped, and 100 removes the key. */
export function setTextScale(percent: number | undefined): void {
  if (percent === undefined || !Number.isFinite(percent)) {
    textScaleStore.set(undefined);
    return;
  }
  const v = snapTextScale(percent);
  textScaleStore.set(v === 100 ? undefined : v);
}

const stores = [themeStore, mdOnlyStore, showHiddenStore, sortStore, textScaleStore] as const;

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

const percentToScale = (p: number | undefined): number | undefined =>
  p === undefined ? undefined : p / 100;

/** The device layer for the current scope (global only until PJ5b). */
export function useDeviceLayer(): DeviceLayer {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get);
  const markdownOnly = useSyncExternalStore(mdOnlyStore.subscribe, mdOnlyStore.get);
  const showHidden = useSyncExternalStore(showHiddenStore.subscribe, showHiddenStore.get);
  const sort = useSyncExternalStore(sortStore.subscribe, sortStore.get);
  const percent = useSyncExternalStore(textScaleStore.subscribe, textScaleStore.get);
  const textScale = percentToScale(percent);
  return useMemo(
    () => ({ theme, markdownOnly, showHidden, sort, textScale }),
    [theme, markdownOnly, showHidden, sort, textScale],
  );
}

/** Non-React read of the global device layer (boot step). */
export function readDeviceLayer(): DeviceLayer {
  return {
    theme: themeStore.get(),
    markdownOnly: mdOnlyStore.get(),
    showHidden: showHiddenStore.get(),
    sort: sortStore.get(),
    textScale: percentToScale(textScaleStore.get()),
  };
}
