import type { SortKey } from '../browse/logic';
import type { ThemeMode } from '../app/theme';

export type ContentWidth = 'narrow' | 'normal' | 'wide' | 'full';

export interface ReadTime {
  wpm: number;
  includeHeadings: boolean;
  includeCode: boolean;
}

export interface Settings {
  theme: ThemeMode;
  style: string;
  font: string;
  codeFont: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: ContentWidth;
  markdownOnly: boolean;
  showHidden: boolean;
  sort: SortKey;
  readTime: ReadTime;
}

/** A sparse layer from the preferences file or a project file. */
export type SettingsLayer = Partial<Omit<Settings, 'readTime'>> & { readTime?: Partial<ReadTime> };

/** Choices made on this device; `textScale` is percent / 100. */
export type DeviceLayer = Partial<
  Pick<Settings, 'theme' | 'markdownOnly' | 'showHidden' | 'sort'>
> & {
  textScale?: number;
};

export type SettingKey = Exclude<keyof Settings, 'readTime'>;
export type SettingSource = 'default' | 'prefs' | 'project' | 'device';

export type Resolved = Settings & {
  textScale: number;
  sources: Record<SettingKey, SettingSource>;
};

/** Keys every layer may set. */
export const DEVICE_KEYS = ['theme', 'markdownOnly', 'showHidden', 'sort'] as const;
/** Keys only preferences and projects may set (plus `readTime`). */
export const CONTENT_KEYS = [
  'style',
  'font',
  'codeFont',
  'fontSize',
  'lineHeight',
  'contentWidth',
] as const;

export const DEFAULTS: Settings = {
  theme: 'system',
  style: 'github',
  font: 'system',
  codeFont: 'mono',
  fontSize: 16,
  lineHeight: 1.6,
  contentWidth: 'normal',
  markdownOnly: false,
  showHidden: false,
  sort: 'name',
  readTime: { wpm: 160, includeHeadings: false, includeCode: false },
};

/**
 * Client registry of known names. A name outside it falls back to the default for its key.
 * Placeholders until RX0 (styles, fonts) and DS1 (code fonts) extend them.
 */
export const KNOWN_STYLES: readonly string[] = ['github'];
export const KNOWN_FONTS: readonly string[] = ['system'];
export const KNOWN_CODE_FONTS: readonly string[] = ['mono'];
