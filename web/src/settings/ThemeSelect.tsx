import type { ThemeMode } from '../app/theme';
import { useSettings } from './useSettings';

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

/** Header theme menu; "Default" removes the device choice. */
export function ThemeSelect() {
  const { resolved, defaultTheme, setTheme } = useSettings();
  const choice = resolved.sources.theme === 'device' ? resolved.theme : 'default';
  return (
    <select
      className="btn theme-select"
      aria-label="Theme"
      value={choice}
      onChange={(e) => {
        const v = e.target.value;
        setTheme(v === 'system' || v === 'light' || v === 'dark' ? v : undefined);
      }}
    >
      <option value="default">Default ({THEME_LABEL[defaultTheme]})</option>
      <option value="system">Auto</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
