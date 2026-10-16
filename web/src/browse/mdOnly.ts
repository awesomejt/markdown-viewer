import { mdOnlyStore } from '../settings/device';
import { useSettings } from '../settings/useSettings';

export const loadMdOnly = mdOnlyStore.load;
export const setMdOnly = mdOnlyStore.set;

/** Test hook: forget the cached value so the next read comes from storage. */
export const resetMdOnlyCache = mdOnlyStore.reset;

/** The resolved Markdown-only setting (prefs can set it) and a setter for the device choice. */
export function useMdOnly(): [boolean, (on: boolean) => void] {
  const { resolved, setMarkdownOnly } = useSettings();
  return [resolved.markdownOnly, setMarkdownOnly];
}
