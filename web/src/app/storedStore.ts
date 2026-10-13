// A value kept in localStorage and shared by every component that reads it: a change in one
// place updates the others immediately (and other tabs via the `storage` event). Storage
// failures (private mode) fall back to an in-memory value for this page. Read it in React with
// `useSyncExternalStore(store.subscribe, store.get)`.
export interface StoredStore<T> {
  /** Reads the value from storage, bypassing the cache. */
  load(): T;
  /** The cached value, loaded from storage on first use. */
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
  /** Test hook: forget the cached value so the next read comes from storage. */
  reset(): void;
}

/**
 * `parse` turns the stored string (null when absent) into a value and must not throw on bad
 * input. `serialize` returns the string to store, or null to remove the key.
 */
export function createStoredStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
): StoredStore<T> {
  const listeners = new Set<() => void>();
  let current: T | undefined;
  let cached = false;

  const load = (): T => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      // Storage unavailable: treat as absent.
    }
    return parse(raw);
  };

  const get = (): T => {
    if (!cached) {
      current = load();
      cached = true;
    }
    return current as T;
  };

  const emit = (): void => {
    for (const l of listeners) l();
  };

  const onStorage = (e: StorageEvent): void => {
    if (e.key !== key && e.key !== null) return;
    current = load();
    cached = true;
    emit();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener('storage', onStorage);
    };
  };

  return {
    load,
    get,
    set(value: T): void {
      current = value;
      cached = true;
      try {
        const raw = serialize(value);
        if (raw === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, raw);
      } catch {
        // Storage unavailable (private mode): the value just isn't persisted.
      }
      emit();
    },
    subscribe,
    reset(): void {
      cached = false;
      current = undefined;
    },
  };
}
