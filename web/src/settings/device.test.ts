import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mdOnlyStore,
  readDeviceLayer,
  resetDeviceCaches,
  setDeviceChoice,
  showHiddenStore,
  sortStore,
  themeStore,
  useDeviceLayer,
} from './device';

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceCaches();
});

describe('device stores', () => {
  it('treat absent keys as no choice', () => {
    expect(readDeviceLayer()).toEqual({
      theme: undefined,
      markdownOnly: undefined,
      showHidden: undefined,
      sort: undefined,
    });
  });

  it('read stored values and ignore invalid ones', () => {
    window.localStorage.setItem('mdv-theme', 'dark');
    window.localStorage.setItem('mdv-md-only', '1');
    window.localStorage.setItem('mdv-show-hidden', '0');
    window.localStorage.setItem('mdv-sort', 'bogus');
    expect(readDeviceLayer()).toEqual({
      theme: 'dark',
      markdownOnly: true,
      showHidden: false,
      sort: undefined,
    });
    window.localStorage.setItem('mdv-theme', 'neon');
    expect(themeStore.load()).toBeUndefined();
  });

  it('store explicit choices even when equal to a default', () => {
    setDeviceChoice('theme', 'system');
    setDeviceChoice('markdownOnly', false);
    setDeviceChoice('showHidden', false);
    setDeviceChoice('sort', 'name');
    expect(window.localStorage.getItem('mdv-theme')).toBe('system');
    expect(window.localStorage.getItem('mdv-md-only')).toBe('0');
    expect(window.localStorage.getItem('mdv-show-hidden')).toBe('0');
    expect(window.localStorage.getItem('mdv-sort')).toBe('name');
  });

  it('undefined removes the key', () => {
    setDeviceChoice('theme', 'dark');
    setDeviceChoice('markdownOnly', true);
    setDeviceChoice('showHidden', true);
    setDeviceChoice('sort', 'date');
    for (const s of [themeStore, mdOnlyStore, showHiddenStore, sortStore]) s.set(undefined);
    expect(window.localStorage.length).toBe(0);
  });

  it('useDeviceLayer follows changes', () => {
    const { result } = renderHook(() => useDeviceLayer());
    expect(result.current.sort).toBeUndefined();
    act(() => setDeviceChoice('sort', 'date'));
    expect(result.current.sort).toBe('date');
  });
});
