export const RELOAD_FLAG = 'mdv-preload-reloaded';
const CLEAR_DELAY_MS = 5000;

function safeSession(op: (s: Storage) => void): void {
  try {
    op(window.sessionStorage);
  } catch {
    // sessionStorage may be blocked.
  }
}

/**
 * A lazy chunk failed to load (usually a stale tab after a redeploy). Reload
 * once to pick up the new index.html. The flag stops a reload loop and is
 * cleared a few seconds after a successful load.
 */
export function installPreloadErrorHandler(reload: () => void = () => window.location.reload()) {
  const onError = (event: Event) => {
    let already = false;
    safeSession((s) => {
      already = s.getItem(RELOAD_FLAG) === '1';
      if (!already) s.setItem(RELOAD_FLAG, '1');
    });
    if (already) return;
    event.preventDefault();
    reload();
  };
  window.addEventListener('vite:preloadError', onError);
  const timer = window.setTimeout(
    () => safeSession((s) => s.removeItem(RELOAD_FLAG)),
    CLEAR_DELAY_MS,
  );
  return () => {
    window.removeEventListener('vite:preloadError', onError);
    window.clearTimeout(timer);
  };
}
