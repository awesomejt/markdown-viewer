import type { Warning } from '../api/types';
import {
  CONTENT_KEYS,
  DEVICE_KEYS,
  KNOWN_CODE_FONTS,
  KNOWN_FONTS,
  KNOWN_STYLES,
  type DeviceLayer,
  type Resolved,
  type SettingKey,
  type SettingSource,
  type Settings,
  type SettingsLayer,
} from './types';

const READ_TIME_KEYS = ['wpm', 'includeHeadings', 'includeCode'] as const;
const SHARED_KEYS: readonly SettingKey[] = [...DEVICE_KEYS, ...CONTENT_KEYS];

/**
 * Pure. The last defined layer wins in the order defaults, prefs, project, device. `readTime`
 * merges per field over the first three layers only. The device layer may only set the four
 * device keys (and `textScale`); prefs and project cannot set `textScale`. Other keys are
 * ignored at run time, not just by the types.
 */
export function resolveSettings(
  defaults: Settings,
  prefs?: SettingsLayer,
  project?: SettingsLayer,
  device?: DeviceLayer,
): Resolved {
  const out: Record<string, unknown> = {};
  const sources: Record<string, SettingSource> = {};
  for (const key of SHARED_KEYS) {
    let value: unknown = defaults[key];
    let source: SettingSource = 'default';
    const layers: [SettingSource, Record<string, unknown> | undefined, boolean][] = [
      ['prefs', prefs, true],
      ['project', project, true],
      ['device', device, (DEVICE_KEYS as readonly string[]).includes(key)],
    ];
    for (const [name, layer, allowed] of layers) {
      const v = allowed ? layer?.[key] : undefined;
      if (v !== undefined) {
        value = v;
        source = name;
      }
    }
    out[key] = value;
    sources[key] = source;
  }
  const readTime: Record<string, unknown> = { ...defaults.readTime };
  for (const layer of [prefs, project]) {
    for (const f of READ_TIME_KEYS) {
      const v = layer?.readTime?.[f];
      if (v !== undefined) readTime[f] = v;
    }
  }
  const scale = device?.textScale;
  const textScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { ...out, readTime, textScale, sources } as unknown as Resolved;
}

/**
 * Applies the client registry: an unknown style or font name falls back to the built-in
 * default for that key (not down the layers) and yields a client warning.
 */
export function applyRegistry(
  resolved: Resolved,
  defaults: Settings,
): { resolved: Resolved; warnings: Warning[] } {
  const warnings: Warning[] = [];
  let out = resolved;
  const check = (
    key: 'style' | 'font' | 'codeFont',
    label: string,
    known: readonly string[],
    code: 'unknown_style' | 'unknown_font',
  ) => {
    const name = resolved[key];
    if (known.includes(name)) return;
    warnings.push({
      code,
      message: `Unknown ${label} "${name}"; using "${defaults[key]}"`,
      key: `settings.${key}`,
    });
    out = { ...out, [key]: defaults[key], sources: { ...out.sources, [key]: 'default' } };
  };
  check('style', 'style', KNOWN_STYLES, 'unknown_style');
  check('font', 'font', KNOWN_FONTS, 'unknown_font');
  check('codeFont', 'code font', KNOWN_CODE_FONTS, 'unknown_font');
  return { resolved: out, warnings };
}
