import { useCallback, useSyncExternalStore } from 'react';
import { SHOW_HIDDEN_STORAGE_KEY } from './logic';

// One value shared by the browse listing and the workspace tree, so flipping the toggle in one
// updates the other immediately (and other tabs via the `storage` event).
const listeners = new Set<() => void>();
let current: boolean | undefined;

export function loadShowHidden(): boolean {
  try {
    return window.localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function snapshot(): boolean {
  current ??= loadShowHidden();
  return current;
}

function emit(): void {
  for (const l of listeners) l();
}

export function setShowHidden(on: boolean): void {
  current = on;
  try {
    window.localStorage.setItem(SHOW_HIDDEN_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable (private mode): the choice just isn't persisted.
  }
  emit();
}

function onStorage(e: StorageEvent): void {
  if (e.key !== SHOW_HIDDEN_STORAGE_KEY && e.key !== null) return;
  current = loadShowHidden();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Test hook: forget the cached value so the next read comes from storage. */
export function resetShowHiddenCache(): void {
  current = undefined;
}

export function useShowHidden(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, snapshot);
  const set = useCallback((on: boolean) => setShowHidden(on), []);
  return [value, set];
}
