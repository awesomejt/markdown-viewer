import { showHiddenStore } from '../settings/device';
import { useSettings } from '../settings/useSettings';

export const loadShowHidden = showHiddenStore.load;
export const setShowHidden = showHiddenStore.set;

/** Test hook: forget the cached value so the next read comes from storage. */
export const resetShowHiddenCache = showHiddenStore.reset;

/** The resolved show-hidden setting (prefs can set it) and a setter for the device choice. */
export function useShowHidden(): [boolean, (on: boolean) => void] {
  const { resolved, setShowHidden } = useSettings();
  return [resolved.showHidden, setShowHidden];
}
