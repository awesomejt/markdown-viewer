import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMdOnly, resetMdOnlyCache, setMdOnly, useMdOnly } from './mdOnly';

beforeEach(() => {
  window.localStorage.clear();
  resetMdOnlyCache();
});

describe('md-only setting', () => {
  it('defaults to off and round-trips through storage', () => {
    expect(loadMdOnly()).toBe(false);
    setMdOnly(true);
    expect(window.localStorage.getItem('mdv-md-only')).toBe('1');
    expect(loadMdOnly()).toBe(true);
    setMdOnly(false);
    expect(window.localStorage.getItem('mdv-md-only')).toBe('0');
  });

  it('updates every hook user at once', () => {
    const a = renderHook(() => useMdOnly());
    const b = renderHook(() => useMdOnly());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });
});
