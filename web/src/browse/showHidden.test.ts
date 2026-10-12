import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShowHidden, resetShowHiddenCache, setShowHidden, useShowHidden } from './showHidden';

beforeEach(() => {
  window.localStorage.clear();
  resetShowHiddenCache();
});
afterEach(() => vi.restoreAllMocks());

describe('show-hidden setting', () => {
  it('defaults to off and round-trips through storage', () => {
    expect(loadShowHidden()).toBe(false);
    setShowHidden(true);
    expect(window.localStorage.getItem('mdv-show-hidden')).toBe('1');
    expect(loadShowHidden()).toBe(true);
  });

  it('updates every hook user at once', () => {
    const a = renderHook(() => useShowHidden());
    const b = renderHook(() => useShowHidden());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });

  it('follows changes from other tabs', () => {
    const { result } = renderHook(() => useShowHidden());
    act(() => {
      window.localStorage.setItem('mdv-show-hidden', '1');
      window.dispatchEvent(new StorageEvent('storage', { key: 'mdv-show-hidden' }));
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      window.localStorage.setItem('mdv-show-hidden', '0');
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    });
    expect(result.current[0]).toBe(true);
  });

  it('still toggles in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useShowHidden());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
