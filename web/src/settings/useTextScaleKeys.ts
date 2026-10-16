import { useEffect } from 'react';
import { decreaseTextScale, increaseTextScale, resetTextScale } from './useTextScale';

type Action = 'larger' | 'smaller' | 'reset';

const LARGER = ['=', '+'];
const SMALLER = ['-', '_'];

function actionFor(e: KeyboardEvent): Action | null {
  // `key` wins; `code` is only a fallback when the layout gives no usable key.
  if (LARGER.includes(e.key)) return 'larger';
  if (SMALLER.includes(e.key)) return 'smaller';
  if (e.key === '0') return 'reset';
  if (e.key !== 'Unidentified' && e.key !== 'Dead') return null;
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return 'larger';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return 'smaller';
  if (e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'range',
  'color',
  'hidden',
]);

/** True only for text-entry controls, where Ctrl/Cmd +/-/0 must keep their native meaning. */
function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((t as HTMLInputElement).type);
  return (
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable ||
    t.getAttribute('contenteditable') === '' ||
    t.getAttribute('contenteditable') === 'true'
  );
}

/** Document handler for Ctrl/Cmd with `=`/`+`, `-`, `0`. Exported for tests. */
export function onTextScaleKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
  if (isEditable(e.target)) return;
  const action = actionFor(e);
  if (!action) return;
  e.preventDefault();
  if (action === 'larger') increaseTextScale();
  else if (action === 'smaller') decreaseTextScale();
  else resetTextScale();
}

/** Installs the handler once for the document's lifetime of the calling component. */
export function useTextScaleKeys(): void {
  useEffect(() => {
    document.addEventListener('keydown', onTextScaleKey);
    return () => document.removeEventListener('keydown', onTextScaleKey);
  }, []);
}
