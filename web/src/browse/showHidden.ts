import { useCallback, useSyncExternalStore } from 'react';
import { createStoredStore } from '../app/storedStore';
import { SHOW_HIDDEN_STORAGE_KEY } from './logic';

// One value shared by the browse listing and the workspace tree, so flipping the toggle in one
// updates the other immediately (and other tabs via the `storage` event).
const store = createStoredStore(
  SHOW_HIDDEN_STORAGE_KEY,
  (raw) => raw === '1',
  (on: boolean) => (on ? '1' : '0'),
);

export const loadShowHidden = store.load;
export const setShowHidden = store.set;

/** Test hook: forget the cached value so the next read comes from storage. */
export const resetShowHiddenCache = store.reset;

export function useShowHidden(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(store.subscribe, store.get);
  const set = useCallback((on: boolean) => setShowHidden(on), []);
  return [value, set];
}
