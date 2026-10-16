import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mdOnlyStore,
  PROJECT_DEVICE_MAX,
  parseProjectChoices,
  projectDeviceStore,
  readDeviceLayer,
  resetDeviceChoices,
  serializeProjectChoices,
  textScaleStore,
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

const A = { root: 'r', path: 'a.mdv.yaml' };
const B = { root: 'r', path: 'dir/b.mdv.yaml' };
const stored = () => JSON.parse(window.localStorage.getItem('mdv-project-device') ?? 'null');

describe('mdv-project-device', () => {
  it('parses without throwing and drops invalid fields', () => {
    expect(parseProjectChoices(null)).toEqual({});
    expect(parseProjectChoices('{nope')).toEqual({});
    expect(parseProjectChoices('[1]')).toEqual({});
    expect(parseProjectChoices('"x"')).toEqual({});
    expect(
      parseProjectChoices(
        JSON.stringify({
          'r:a.mdv.yaml': { theme: 'dark', markdownOnly: 'yes', showHidden: true, sort: 'size' },
          'r:b.mdv.yaml': { theme: 'neon' },
          'no-colon': { theme: 'dark' },
          'r:c.mdv.yaml': 5,
        }),
      ),
    ).toEqual({ 'r:a.mdv.yaml': { theme: 'dark', showHidden: true } });
  });

  it('serializes an empty map as an absent key and round-trips', () => {
    expect(serializeProjectChoices({})).toBeNull();
    const map = { 'r:a.mdv.yaml': { sort: 'date' as const } };
    expect(parseProjectChoices(serializeProjectChoices(map))).toEqual(map);
  });

  it('keeps at most 50 projects, dropping the least recently written', () => {
    for (let i = 0; i < PROJECT_DEVICE_MAX; i++) {
      setDeviceChoice('theme', 'dark', { root: 'r', path: `p${i}.mdv.yaml` });
    }
    // Rewriting p0 makes it the newest; p1 is now the oldest.
    setDeviceChoice('sort', 'date', { root: 'r', path: 'p0.mdv.yaml' });
    setDeviceChoice('theme', 'light', { root: 'r', path: 'extra.mdv.yaml' });
    const keys = Object.keys(stored());
    expect(keys).toHaveLength(PROJECT_DEVICE_MAX);
    expect(keys).not.toContain('r:p1.mdv.yaml');
    expect(keys).toContain('r:p0.mdv.yaml');
    expect(keys.at(-1)).toBe('r:extra.mdv.yaml');
    // A stored map over the cap is trimmed on read, keeping the newest.
    const big = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`r:q${i}.mdv.yaml`, { theme: 'dark' }]),
    );
    const parsed = Object.keys(parseProjectChoices(JSON.stringify(big)));
    expect(parsed).toHaveLength(PROJECT_DEVICE_MAX);
    expect(parsed[0]).toBe('r:q10.mdv.yaml');
  });

  it('isolates projects from each other and from the global choices', () => {
    setDeviceChoice('theme', 'dark', A);
    expect(readDeviceLayer(A).theme).toBe('dark');
    expect(readDeviceLayer(B).theme).toBeUndefined();
    expect(readDeviceLayer().theme).toBeUndefined();
    expect(window.localStorage.getItem('mdv-theme')).toBeNull();

    setDeviceChoice('markdownOnly', true);
    expect(readDeviceLayer().markdownOnly).toBe(true);
    expect(readDeviceLayer(A).markdownOnly).toBeUndefined();
    expect(readDeviceLayer(B).markdownOnly).toBeUndefined();
    expect(window.localStorage.getItem('mdv-md-only')).toBe('1');
  });

  it('removes a choice and an emptied entry in its scope only', () => {
    setDeviceChoice('theme', 'dark', A);
    setDeviceChoice('theme', 'light');
    setDeviceChoice('theme', undefined, A);
    expect(stored()).toBeNull();
    expect(readDeviceLayer().theme).toBe('light');
  });

  it('useDeviceLayer follows the scope', () => {
    const { result, rerender } = renderHook(({ s }) => useDeviceLayer(s), {
      initialProps: { s: A as typeof A | null },
    });
    act(() => setDeviceChoice('sort', 'date', A));
    expect(result.current.sort).toBe('date');
    rerender({ s: B });
    expect(result.current.sort).toBeUndefined();
    rerender({ s: null });
    expect(result.current.sort).toBeUndefined();
    act(() => setDeviceChoice('sort', 'name'));
    expect(result.current.sort).toBe('name');
    rerender({ s: A });
    expect(result.current.sort).toBe('date');
  });

  it('resets per scope and leaves the text scale alone', () => {
    setDeviceChoice('theme', 'dark', A);
    setDeviceChoice('theme', 'dark', B);
    setDeviceChoice('theme', 'light');
    setDeviceChoice('showHidden', true);
    textScaleStore.set(120);

    resetDeviceChoices(A);
    expect(readDeviceLayer(A).theme).toBeUndefined();
    expect(readDeviceLayer(B).theme).toBe('dark');
    expect(readDeviceLayer().theme).toBe('light');

    resetDeviceChoices();
    expect(readDeviceLayer().theme).toBeUndefined();
    expect(readDeviceLayer().showHidden).toBeUndefined();
    expect(readDeviceLayer(B).theme).toBe('dark');
    expect(readDeviceLayer().textScale).toBe(1.2);
    expect(projectDeviceStore.get()).not.toHaveProperty('r:a.mdv.yaml');
  });
});
