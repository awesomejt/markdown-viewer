export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mdv-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

// Header background (--bg-alt) per theme, so the browser chrome and the iOS
// status bar match the app bar. Must match app.css and index.html.
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f4f5f7',
  dark: '#1d2026',
};

function systemMedia(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  return systemMedia()?.matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  // index.html ships one meta per system scheme; an explicit choice overrides
  // both so the chrome follows the app, not the OS.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLOR[resolved];
  }
  return resolved;
}
