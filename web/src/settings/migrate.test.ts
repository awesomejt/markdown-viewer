import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateSettings, SETTINGS_VERSION_KEY } from './migrate';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('migrateSettings', () => {
  it.each([
    ['mdv-theme', 'system'],
    ['mdv-md-only', '0'],
    ['mdv-show-hidden', '0'],
    ['mdv-sort', 'name'],
  ])('removes %s=%s', (key, value) => {
    window.localStorage.setItem(key, value);
    migrateSettings();
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(SETTINGS_VERSION_KEY)).toBe('2');
  });

  it.each([
    ['mdv-theme', 'dark'],
    ['mdv-theme', 'light'],
    ['mdv-md-only', '1'],
    ['mdv-show-hidden', '1'],
    ['mdv-sort', 'date'],
  ])('keeps %s=%s', (key, value) => {
    window.localStorage.setItem(key, value);
    migrateSettings();
    expect(window.localStorage.getItem(key)).toBe(value);
  });

  it('is idempotent: after the flag is set, a default written later is a real choice', () => {
    window.localStorage.setItem('mdv-theme', 'system');
    migrateSettings();
    window.localStorage.setItem('mdv-theme', 'system');
    migrateSettings();
    expect(window.localStorage.getItem('mdv-theme')).toBe('system');
    expect(window.localStorage.getItem(SETTINGS_VERSION_KEY)).toBe('2');
  });

  it('does not touch anything when the flag is already current', () => {
    window.localStorage.setItem(SETTINGS_VERSION_KEY, '2');
    window.localStorage.setItem('mdv-sort', 'name');
    migrateSettings();
    expect(window.localStorage.getItem('mdv-sort')).toBe('name');
  });

  it('tolerates storage throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => migrateSettings()).not.toThrow();
  });
});
