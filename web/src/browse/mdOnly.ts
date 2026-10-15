import { useCallback, useSyncExternalStore } from 'react';
import { createStoredStore } from '../app/storedStore';
import { MD_ONLY_STORAGE_KEY } from './logic';

// One value shared by the browse listing and the workspace tree, so flipping the toggle in one
// updates the other immediately (and other tabs via the `storage` event).
const store = createStoredStore(
  MD_ONLY_STORAGE_KEY,
  (raw) => raw === '1',
  (on: boolean) => (on ? '1' : '0'),
);

export const loadMdOnly = store.load;
export const setMdOnly = store.set;

/** Test hook: forget the cached value so the next read comes from storage. */
export const resetMdOnlyCache = store.reset;

export function useMdOnly(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(store.subscribe, store.get);
  const set = useCallback((on: boolean) => setMdOnly(on), []);
  return [value, set];
}
