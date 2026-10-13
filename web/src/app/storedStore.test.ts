import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoredStore } from './storedStore';

const KEY = 'mdv-test-store';

function makeStore() {
  return createStoredStore(
    KEY,
    (raw) => (raw === null ? 0 : Number(raw)),
    (n: number) => (n === 0 ? null : String(n)),
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('createStoredStore', () => {
  it('loads once, then serves the cache until reset', () => {
    window.localStorage.setItem(KEY, '3');
    const s = makeStore();
    expect(s.get()).toBe(3);
    window.localStorage.setItem(KEY, '5');
    expect(s.get()).toBe(3);
    expect(s.load()).toBe(5);
    s.reset();
    expect(s.get()).toBe(5);
  });

  it('persists, removes on null and notifies listeners', () => {
    const s = makeStore();
    const l = vi.fn();
    const off = s.subscribe(l);
    s.set(7);
    expect(window.localStorage.getItem(KEY)).toBe('7');
    s.set(0);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(l).toHaveBeenCalledTimes(2);
    off();
    s.set(1);
    expect(l).toHaveBeenCalledTimes(2);
  });

  it('follows storage events for its key or a clear, and ignores other keys', () => {
    const s = makeStore();
    const l = vi.fn();
    const off = s.subscribe(l);
    window.localStorage.setItem(KEY, '4');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(l).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(s.get()).toBe(4);
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(s.get()).toBe(0);
    expect(l).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(l).toHaveBeenCalledTimes(2);
  });

  it('keeps the value in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const s = makeStore();
    expect(s.get()).toBe(0);
    s.set(9);
    expect(s.get()).toBe(9);
  });
});
