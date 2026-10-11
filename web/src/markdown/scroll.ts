const PREFIX = 'user-content-';

/** Scroll to the element for `#hash`; raw-HTML ids are sanitized to a `user-content-` prefix. */
export function scrollToHash(hash: string): boolean {
  if (hash.length <= 1) return false;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // Keep the raw id.
  }
  const el = document.getElementById(id) ?? document.getElementById(PREFIX + id);
  if (!el) return false;
  el.scrollIntoView();
  return true;
}
