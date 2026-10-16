import { useEffect } from 'react';
import { applyTheme } from '../app/theme';
import { applySettings } from './apply';
import { useSettings } from './useSettings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Keeps the document in step with the resolved settings, following the OS in `system` theme. */
export function useApplySettings(): void {
  const { resolved } = useSettings();
  useEffect(() => applySettings(resolved), [resolved]);
  const theme = resolved.theme;
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}
