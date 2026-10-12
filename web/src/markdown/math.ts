import { useEffect, useState } from 'react';
import type { RehypePlugin } from './pipeline';

let plugin: RehypePlugin | null = null;
let failed = false;
let pending: Promise<void> | null = null;

/** Cheap check for syntax remark-math may turn into math: a `$`, or a ```` ```math ```` fence. */
export function mayHaveMath(text: string): boolean {
  return text.includes('$') || /(?:`{3,}|~{3,})[ \t]*math\b/i.test(text);
}

export function loadMath(): Promise<void> {
  pending ??= import('./katex').then(
    (m) => {
      plugin = m.katexPlugin;
    },
    () => {
      // Chunk failed to load: render the math source as code rather than nothing.
      failed = true;
    },
  );
  return pending;
}

/**
 * The KaTeX rehype plugin, loaded on first use. `ready` is false while a document that may contain
 * math waits for it, so headings and anchors do not move when the math renders.
 */
export function useMathPlugin(text: string): { ready: boolean; plugin: RehypePlugin | null } {
  const need = mayHaveMath(text);
  const [, setLoaded] = useState(false);
  useEffect(() => {
    if (!need || plugin || failed) return;
    let live = true;
    void loadMath().then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [need]);
  return { ready: !need || plugin !== null || failed, plugin };
}
