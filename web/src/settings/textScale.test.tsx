import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootSettings } from './boot';
import {
  readDeviceLayer,
  resetDeviceCaches,
  setTextScale,
  textScaleStore,
  useDeviceLayer,
} from './device';
import { TextScaleControls } from './TextScaleControls';
import { onTextScaleKey, useTextScaleKeys } from './useTextScaleKeys';

const KEY = 'mdv-text-scale';

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceCaches();
  document.documentElement.removeAttribute('style');
});

afterEach(() => vi.restoreAllMocks());

describe('text scale store', () => {
  const parse = (raw: string | null) => {
    if (raw === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, raw);
    return textScaleStore.load();
  };

  it('parses absent, garbage, rounding and clamping', () => {
    expect(parse(null)).toBeUndefined();
    expect(parse('abc')).toBeUndefined();
    expect(parse('')).toBeUndefined();
    expect(parse('NaN')).toBeUndefined();
    expect(parse('110')).toBe(110);
    expect(parse('105')).toBe(110);
    expect(parse('104')).toBe(100);
    expect(parse('30')).toBe(50);
    expect(parse('250')).toBe(200);
    expect(parse('-5')).toBe(50);
  });

  it('does not throw when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(textScaleStore.load()).toBeUndefined();
  });

  it('setting 100 removes the key and other values are stored', () => {
    setTextScale(120);
    expect(window.localStorage.getItem(KEY)).toBe('120');
    setTextScale(100);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    setTextScale(500);
    expect(window.localStorage.getItem(KEY)).toBe('200');
    setTextScale(undefined);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('feeds the device layer as percent / 100 and resets with the caches', () => {
    window.localStorage.setItem(KEY, '120');
    expect(readDeviceLayer().textScale).toBe(1.2);
    const { result } = renderHook(() => useDeviceLayer());
    expect(result.current.textScale).toBe(1.2);
    act(() => setTextScale(70));
    expect(result.current.textScale).toBe(0.7);
    window.localStorage.setItem(KEY, '150');
    resetDeviceCaches();
    expect(readDeviceLayer().textScale).toBe(1.5);
  });

  it('boot applies --mdv-text-scale from storage', () => {
    window.localStorage.setItem(KEY, '130');
    bootSettings();
    expect(document.documentElement.style.getPropertyValue('--mdv-text-scale')).toBe('1.3');
  });
});

describe('TextScaleControls', () => {
  it('steps, shows the percent and resets', () => {
    render(<TextScaleControls />);
    const larger = screen.getByRole('button', { name: 'Larger text' });
    fireEvent.click(larger);
    fireEvent.click(larger);
    expect(screen.getByRole('button', { name: 'Reset text size (120%)' }).textContent).toBe('120%');
    expect(window.localStorage.getItem(KEY)).toBe('120');
    fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
    expect(screen.getByRole('button', { name: 'Reset text size (110%)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset text size (110%)' }));
    expect(screen.getByRole('button', { name: 'Reset text size (100%)' })).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('disables the buttons at the limits', () => {
    setTextScale(50);
    render(<TextScaleControls />);
    expect(screen.getByRole('button', { name: 'Smaller text' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Larger text' })).toHaveProperty('disabled', false);
    act(() => setTextScale(200));
    expect(screen.getByRole('button', { name: 'Smaller text' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Larger text' })).toHaveProperty('disabled', true);
  });
});

describe('text scale keys', () => {
  function press(init: KeyboardEventInit, target: Element | Document = document.body) {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  }

  const handled: [string, KeyboardEventInit, number][] = [
    ['Ctrl+=', { ctrlKey: true, key: '=' }, 110],
    ['Ctrl++', { ctrlKey: true, key: '+' }, 110],
    ['Meta+=', { metaKey: true, key: '=' }, 110],
    ['Ctrl Equal code', { ctrlKey: true, key: 'Unidentified', code: 'Equal' }, 110],
    ['Ctrl NumpadAdd', { ctrlKey: true, key: 'Unidentified', code: 'NumpadAdd' }, 110],
    ['Ctrl+-', { ctrlKey: true, key: '-' }, 90],
    ['Meta+_', { metaKey: true, key: '_' }, 90],
    ['Ctrl Minus code', { ctrlKey: true, key: 'Unidentified', code: 'Minus' }, 90],
    ['Ctrl NumpadSubtract', { ctrlKey: true, key: 'Unidentified', code: 'NumpadSubtract' }, 90],
    ['Ctrl+0', { ctrlKey: true, key: '0' }, 100],
    ['Meta Digit0', { metaKey: true, key: 'Unidentified', code: 'Digit0' }, 100],
    ['Ctrl Numpad0', { ctrlKey: true, key: 'Unidentified', code: 'Numpad0' }, 100],
  ];

  it.each(handled)('%s is handled', (_n, init, expected) => {
    document.addEventListener('keydown', onTextScaleKey);
    try {
      setTextScale(init.key === '0' || init.code?.includes('0') ? 130 : 100);
      const e = press(init);
      expect(e.defaultPrevented).toBe(true);
      expect(textScaleStore.get() ?? 100).toBe(expected === 100 ? 100 : expected);
    } finally {
      document.removeEventListener('keydown', onTextScaleKey);
    }
  });

  it('ignores unhandled situations and leaves them unprevented', () => {
    renderHook(() => useTextScaleKeys());
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    const els = ['input', 'textarea', 'select'].map((t) => document.createElement(t));
    document.body.append(ce, ...els);
    for (const el of [ce, ...els]) {
      expect(press({ ctrlKey: true, key: '=' }, el).defaultPrevented).toBe(false);
    }
    expect(press({ ctrlKey: true, altKey: true, key: '=' }).defaultPrevented).toBe(false);
    expect(press({ key: '=' }).defaultPrevented).toBe(false);
    expect(press({ key: '0' }).defaultPrevented).toBe(false);
    expect(press({ ctrlKey: true, key: 'a' }).defaultPrevented).toBe(false);
    expect(press({ metaKey: true, key: 'f' }).defaultPrevented).toBe(false);
    expect(textScaleStore.get()).toBeUndefined();
    ce.remove();
    els.forEach((el) => el.remove());
  });

  it('ignores an already handled event', () => {
    const e = new KeyboardEvent('keydown', { ctrlKey: true, key: '=', cancelable: true });
    e.preventDefault();
    onTextScaleKey(e);
    expect(textScaleStore.get()).toBeUndefined();
  });

  it('prevents default at the limits without changing the value', () => {
    renderHook(() => useTextScaleKeys());
    setTextScale(200);
    expect(press({ ctrlKey: true, key: '=' }).defaultPrevented).toBe(true);
    expect(textScaleStore.get()).toBe(200);
    setTextScale(50);
    expect(press({ ctrlKey: true, key: '-' }).defaultPrevented).toBe(true);
    expect(textScaleStore.get()).toBe(50);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useTextScaleKeys());
    unmount();
    expect(press({ ctrlKey: true, key: '=' }).defaultPrevented).toBe(false);
  });
});
