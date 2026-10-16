import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clientWrapper } from '../settings/test-utils';
import { loadMdOnly, resetMdOnlyCache, setMdOnly, useMdOnly } from './mdOnly';

beforeEach(() => {
  window.localStorage.clear();
  resetMdOnlyCache();
});

describe('md-only setting', () => {
  it('has no device choice by default; an explicit choice is stored even when false', () => {
    expect(loadMdOnly()).toBeUndefined();
    setMdOnly(true);
    expect(window.localStorage.getItem('mdv-md-only')).toBe('1');
    expect(loadMdOnly()).toBe(true);
    setMdOnly(false);
    expect(window.localStorage.getItem('mdv-md-only')).toBe('0');
    setMdOnly(undefined);
    expect(window.localStorage.getItem('mdv-md-only')).toBeNull();
  });

  it('updates every hook user at once', () => {
    const wrapper = clientWrapper();
    const a = renderHook(() => useMdOnly(), { wrapper });
    const b = renderHook(() => useMdOnly(), { wrapper });
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });
});
