/**
 * Copies text to the clipboard. `navigator.clipboard` only exists in secure contexts, and mdv is
 * usually opened over plain HTTP on the LAN, so fall back to a selected off-screen textarea.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or not focused: try the legacy path below.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  // iOS Safari zooms into inputs under 16px.
  area.style.fontSize = '16px';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
