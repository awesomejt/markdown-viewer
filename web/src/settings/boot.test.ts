import { beforeEach, describe, expect, it } from 'vitest';
import { resetDeviceCaches } from './device';
import { bootSettings } from './boot';
import { PREFS_CACHE_KEY } from './prefsCache';

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceCaches();
  const el = document.documentElement;
  el.removeAttribute('style');
  for (const a of ['data-theme', 'data-style', 'data-font', 'data-code-font'])
    el.removeAttribute(a);
});

describe('bootSettings', () => {
  it('applies the defaults with no cache', () => {
    bootSettings();
    const el = document.documentElement;
    expect(el.dataset.theme).toBe('light');
    expect(el.dataset.style).toBe('github');
    expect(el.dataset.font).toBe('system');
    expect(el.dataset.codeFont).toBe('mono');
    expect(el.style.getPropertyValue('--mdv-font-size')).toBe('16px');
    expect(el.style.getPropertyValue('--mdv-text-scale')).toBe('1');
    expect(el.style.getPropertyValue('--mdv-line-height')).toBe('1.6');
    expect(el.style.getPropertyValue('--mdv-content-width')).toBe('50rem');
  });

  it('applies the cached prefs before render', () => {
    window.localStorage.setItem(
      PREFS_CACHE_KEY,
      JSON.stringify({ theme: 'dark', fontSize: 20, lineHeight: 2, contentWidth: 'wide' }),
    );
    bootSettings();
    const el = document.documentElement;
    expect(el.dataset.theme).toBe('dark');
    expect(el.style.getPropertyValue('--mdv-font-size')).toBe('20px');
    expect(el.style.getPropertyValue('--mdv-line-height')).toBe('2');
    expect(el.style.getPropertyValue('--mdv-content-width')).toBe('70rem');
  });

  it('lets a device choice beat the cache and sanitizes a poisoned cache', () => {
    window.localStorage.setItem(
      PREFS_CACHE_KEY,
      JSON.stringify({ theme: 'dark', style: 'x;}', fontSize: 9999, contentWidth: 'url(x)' }),
    );
    window.localStorage.setItem('mdv-theme', 'light');
    bootSettings();
    const el = document.documentElement;
    expect(el.dataset.theme).toBe('light');
    expect(el.dataset.style).toBe('github');
    expect(el.style.getPropertyValue('--mdv-font-size')).toBe('16px');
    expect(el.style.getPropertyValue('--mdv-content-width')).toBe('50rem');
  });

  it('survives a corrupt cache and migrates first', () => {
    window.localStorage.setItem(PREFS_CACHE_KEY, '{not json');
    window.localStorage.setItem('mdv-theme', 'system');
    bootSettings();
    expect(window.localStorage.getItem('mdv-theme')).toBeNull();
    expect(window.localStorage.getItem('mdv-settings-v')).toBe('2');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('migration runs before device stores read (a legacy default is not a choice)', () => {
    window.localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ theme: 'dark' }));
    window.localStorage.setItem('mdv-theme', 'system');
    bootSettings();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('uses only the project choices when ?project= is in the URL', () => {
    window.localStorage.setItem('mdv-theme', 'dark');
    window.localStorage.setItem(
      'mdv-project-device',
      JSON.stringify({ 'r:p.mdv.yaml': { theme: 'light' }, 'r:q.mdv.yaml': { theme: 'dark' } }),
    );
    window.history.replaceState(null, '', '/view/r/a.md?project=r:p.mdv.yaml');
    try {
      bootSettings();
      expect(document.documentElement.dataset.theme).toBe('light');
      window.history.replaceState(null, '', '/view/r/a.md?project=r:other.mdv.yaml');
      resetDeviceCaches();
      bootSettings();
      // The global dark choice does not apply inside a project.
      expect(document.documentElement.dataset.theme).toBe('light');
      window.history.replaceState(null, '', '/view/r/a.md');
      bootSettings();
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
