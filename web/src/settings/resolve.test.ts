import { describe, expect, it } from 'vitest';
import { applyRegistry, resolveSettings } from './resolve';
import { DEFAULTS, type DeviceLayer, type SettingsLayer } from './types';

describe('resolveSettings', () => {
  it('returns the defaults with default sources when no layer is given', () => {
    const r = resolveSettings(DEFAULTS);
    expect(r).toMatchObject({ ...DEFAULTS, textScale: 1 });
    expect(Object.values(r.sources).every((s) => s === 'default')).toBe(true);
  });

  it('applies the last defined layer: defaults, prefs, project, device', () => {
    const prefs: SettingsLayer = { theme: 'light', sort: 'date', fontSize: 18, showHidden: true };
    const project: SettingsLayer = { theme: 'dark', fontSize: 20 };
    const device: DeviceLayer = { theme: 'system', showHidden: false };
    const r = resolveSettings(DEFAULTS, prefs, project, device);
    expect(r.theme).toBe('system');
    expect(r.sources.theme).toBe('device');
    expect(r.fontSize).toBe(20);
    expect(r.sources.fontSize).toBe('project');
    expect(r.sort).toBe('date');
    expect(r.sources.sort).toBe('prefs');
    expect(r.showHidden).toBe(false);
    expect(r.sources.showHidden).toBe('device');
    expect(r.sources.lineHeight).toBe('default');
    expect(resolveSettings(DEFAULTS, prefs, project).theme).toBe('dark');
    expect(resolveSettings(DEFAULTS, prefs).theme).toBe('light');
  });

  it('merges readTime per field over defaults, prefs and project', () => {
    const r = resolveSettings(
      DEFAULTS,
      { readTime: { wpm: 200, includeCode: true } },
      { readTime: { wpm: 250 } },
    );
    expect(r.readTime).toEqual({ wpm: 250, includeHeadings: false, includeCode: true });
  });

  it('ignores readTime in the device layer', () => {
    const device = { readTime: { wpm: 600 } } as unknown as DeviceLayer;
    expect(resolveSettings(DEFAULTS, undefined, undefined, device).readTime.wpm).toBe(160);
  });

  it('lets the device layer set only the device keys, even at run time', () => {
    const device = {
      theme: 'dark',
      fontSize: 30,
      style: 'x',
      font: 'x',
      codeFont: 'x',
      lineHeight: 2,
      contentWidth: 'full',
    } as unknown as DeviceLayer;
    const r = resolveSettings(DEFAULTS, { fontSize: 18 }, undefined, device);
    expect(r.theme).toBe('dark');
    expect(r.fontSize).toBe(18);
    expect(r.style).toBe('github');
    expect(r.font).toBe('system');
    expect(r.codeFont).toBe('mono');
    expect(r.lineHeight).toBe(1.6);
    expect(r.contentWidth).toBe('normal');
  });

  it('textScale comes from the device layer only', () => {
    const layer = { textScale: 2 } as unknown as SettingsLayer;
    expect(resolveSettings(DEFAULTS, layer, layer).textScale).toBe(1);
    expect(resolveSettings(DEFAULTS, undefined, undefined, { textScale: 1.3 }).textScale).toBe(1.3);
    expect(resolveSettings(DEFAULTS, undefined, undefined, { textScale: NaN }).textScale).toBe(1);
  });

  it('leaving a project (project undefined) gives the prefs result', () => {
    const prefs: SettingsLayer = { theme: 'light', contentWidth: 'wide', readTime: { wpm: 100 } };
    const project: SettingsLayer = {
      theme: 'dark',
      contentWidth: 'narrow',
      readTime: { wpm: 300 },
    };
    expect(resolveSettings(DEFAULTS, prefs, project).contentWidth).toBe('narrow');
    expect(resolveSettings(DEFAULTS, prefs, undefined)).toEqual(resolveSettings(DEFAULTS, prefs));
    const left = resolveSettings(DEFAULTS, prefs, undefined);
    expect(left.theme).toBe('light');
    expect(left.contentWidth).toBe('wide');
    expect(left.readTime.wpm).toBe(100);
    expect(left.sources.theme).toBe('prefs');
  });
});

describe('applyRegistry', () => {
  it('keeps known names without warnings', () => {
    const { resolved, warnings } = applyRegistry(resolveSettings(DEFAULTS), DEFAULTS);
    expect(warnings).toEqual([]);
    expect(resolved.style).toBe('github');
  });

  it('falls back to the built-in default, not the lower layer, with a client warning', () => {
    const { resolved, warnings } = applyRegistry(
      resolveSettings(
        DEFAULTS,
        { style: 'github', font: 'system' },
        { style: 'fancy', font: 'serif' },
      ),
      DEFAULTS,
    );
    expect(resolved.style).toBe('github');
    expect(resolved.font).toBe('system');
    expect(resolved.sources.style).toBe('default');
    expect(warnings.map((w) => [w.code, w.key])).toEqual([
      ['unknown_style', 'settings.style'],
      ['unknown_font', 'settings.font'],
    ]);
    expect(warnings[0].message).toContain('fancy');
  });

  it('checks the code font too', () => {
    const { resolved, warnings } = applyRegistry(
      resolveSettings(DEFAULTS, { codeFont: 'fira' }),
      DEFAULTS,
    );
    expect(resolved.codeFont).toBe('mono');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].key).toBe('settings.codeFont');
  });
});
