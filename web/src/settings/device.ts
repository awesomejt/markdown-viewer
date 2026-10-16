import { useMemo, useSyncExternalStore } from 'react';
import { formatProject, type ProjectRef } from '../api/client';
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

export const PROJECT_DEVICE_STORAGE_KEY = 'mdv-project-device';
/** Per-project choices kept on this device; the least recently written are dropped beyond it. */
export const PROJECT_DEVICE_MAX = 50;

/** One project's device choices (`undefined` = no choice). */
export type ProjectChoices = Pick<DeviceLayer, 'theme' | 'markdownOnly' | 'showHidden' | 'sort'>;
/** `root:path` (as in `?project=`) to choices; insertion order is write recency (oldest first). */
export type ProjectChoiceMap = Readonly<Record<string, ProjectChoices>>;

const CHOICE_KEYS = ['theme', 'markdownOnly', 'showHidden', 'sort'] as const;
type DeviceKey = (typeof CHOICE_KEYS)[number];

/** Keeps only valid fields; `undefined` when nothing valid is left. */
function cleanChoices(raw: unknown): ProjectChoices | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ProjectChoices = {};
  if (r.theme === 'system' || r.theme === 'light' || r.theme === 'dark') out.theme = r.theme;
  if (typeof r.markdownOnly === 'boolean') out.markdownOnly = r.markdownOnly;
  if (typeof r.showHidden === 'boolean') out.showHidden = r.showHidden;
  if (r.sort === 'name' || r.sort === 'date') out.sort = r.sort;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Never throws: bad JSON is an empty map, invalid fields and entries are dropped, 50 at most. */
export function parseProjectChoices(raw: string | null): ProjectChoiceMap {
  if (raw === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const entries: [string, ProjectChoices][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (!k.includes(':')) continue;
    const c = cleanChoices(v);
    if (c) entries.push([k, c]);
  }
  return Object.fromEntries(entries.slice(-PROJECT_DEVICE_MAX));
}

export function serializeProjectChoices(map: ProjectChoiceMap): string | null {
  return Object.keys(map).length === 0 ? null : JSON.stringify(map);
}

export const projectDeviceStore = createStoredStore<ProjectChoiceMap>(
  PROJECT_DEVICE_STORAGE_KEY,
  parseProjectChoices,
  serializeProjectChoices,
);

const stores = [
  themeStore,
  mdOnlyStore,
  showHiddenStore,
  sortStore,
  textScaleStore,
  projectDeviceStore,
] as const;

/** Test hook: forget every cached device value. */
export function resetDeviceCaches(): void {
  for (const s of stores) s.reset();
}

const byKey: { [K in DeviceKey]: StoredStore<DeviceLayer[K]> } = {
  theme: themeStore,
  markdownOnly: mdOnlyStore,
  showHidden: showHiddenStore,
  sort: sortStore,
};

/** The device scope of a choice: a project's own entry, or (`null`/absent) the global keys. */
export type DeviceScope = ProjectRef | null | undefined;

/**
 * Writes one device choice (`undefined` removes it) to the scope it was made in: inside a
 * project only that project's entry changes (it becomes the most recently written), outside
 * only the global key.
 */
export function setDeviceChoice<K extends DeviceKey>(
  key: K,
  value: DeviceLayer[K],
  scope?: DeviceScope,
): void {
  if (!scope) {
    (byKey[key] as StoredStore<DeviceLayer[K]>).set(value);
    return;
  }
  const id = formatProject(scope);
  const map = projectDeviceStore.get();
  const next: ProjectChoices = { ...map[id] };
  if (value === undefined) delete next[key];
  else (next as Record<string, unknown>)[key] = value;
  const rest = Object.entries(map).filter(([k]) => k !== id);
  if (Object.keys(next).length > 0) rest.push([id, next]);
  projectDeviceStore.set(Object.fromEntries(rest.slice(-PROJECT_DEVICE_MAX)));
}

/**
 * Clears this device's choices of the scope: the project's entry, or the four global keys.
 * The text scale is global and untouched.
 */
export function resetDeviceChoices(scope?: DeviceScope): void {
  if (scope) {
    const id = formatProject(scope);
    const map = projectDeviceStore.get();
    if (!(id in map)) return;
    projectDeviceStore.set(Object.fromEntries(Object.entries(map).filter(([k]) => k !== id)));
    return;
  }
  for (const k of CHOICE_KEYS) (byKey[k] as StoredStore<unknown>).set(undefined);
}

const percentToScale = (p: number | undefined): number | undefined =>
  p === undefined ? undefined : p / 100;

const EMPTY: ProjectChoices = {};

/** The device layer for the scope: inside a project only its choices, else the global ones. */
export function useDeviceLayer(scope?: DeviceScope): DeviceLayer {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get);
  const markdownOnly = useSyncExternalStore(mdOnlyStore.subscribe, mdOnlyStore.get);
  const showHidden = useSyncExternalStore(showHiddenStore.subscribe, showHiddenStore.get);
  const sort = useSyncExternalStore(sortStore.subscribe, sortStore.get);
  const percent = useSyncExternalStore(textScaleStore.subscribe, textScaleStore.get);
  const projects = useSyncExternalStore(projectDeviceStore.subscribe, projectDeviceStore.get);
  const id = scope ? formatProject(scope) : null;
  const own = id === null ? undefined : (projects[id] ?? EMPTY);
  const textScale = percentToScale(percent);
  return useMemo(
    () => ({
      theme: own ? own.theme : theme,
      markdownOnly: own ? own.markdownOnly : markdownOnly,
      showHidden: own ? own.showHidden : showHidden,
      sort: own ? own.sort : sort,
      textScale,
    }),
    [own, theme, markdownOnly, showHidden, sort, textScale],
  );
}

/** Non-React read of the device layer of the scope (boot step). */
export function readDeviceLayer(scope?: DeviceScope): DeviceLayer {
  const own = scope ? (projectDeviceStore.get()[formatProject(scope)] ?? EMPTY) : undefined;
  return {
    theme: own ? own.theme : themeStore.get(),
    markdownOnly: own ? own.markdownOnly : mdOnlyStore.get(),
    showHidden: own ? own.showHidden : showHiddenStore.get(),
    sort: own ? own.sort : sortStore.get(),
    textScale: percentToScale(textScaleStore.get()),
  };
}
