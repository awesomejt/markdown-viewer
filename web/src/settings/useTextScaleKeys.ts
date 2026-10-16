import { useEffect } from 'react';
import { decreaseTextScale, increaseTextScale, resetTextScale } from './useTextScale';

type Action = 'larger' | 'smaller' | 'reset';

function actionFor(e: KeyboardEvent): Action | null {
  if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')
    return 'larger';
  if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')
    return 'smaller';
  if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
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
