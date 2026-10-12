import { useEffect, useState } from 'react';
import { copyText } from './copy';

type State = 'idle' | 'copied' | 'failed';

const LABELS: Record<State, string> = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' };

/** Copies `text` and shows the outcome on the button for two seconds. */
export default function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      className="copy-code"
      aria-live="polite"
      onClick={() => {
        void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'));
      }}
    >
      {LABELS[state]}
    </button>
  );
}
