import type { ResolvedTheme } from '../app/theme';

type Mermaid = typeof import('mermaid').default;

let loader: Promise<Mermaid> | null = null;

function load(): Promise<Mermaid> {
  loader ??= import('mermaid').then((m) => m.default);
  loader.catch(() => {
    loader = null; // allow a retry after a failed chunk load
  });
  return loader;
}

// Mermaid is not reentrant: every render goes through this queue.
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return msg.trim() || 'Could not render the diagram.';
}

async function renderNow(source: string, theme: ResolvedTheme): Promise<string> {
  const mermaid = await load();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'default',
  });
  const id = `mdv-mermaid-${++counter}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (e) {
    throw new Error(errorMessage(e), { cause: e });
  } finally {
    // Mermaid can leave its temporary container in the body after a failure.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Renders Mermaid source to an SVG string; calls are serialized. Rejects with a readable Error. */
export function renderMermaid(source: string, theme: ResolvedTheme): Promise<string> {
  const run = queue.then(() => renderNow(source, theme));
  queue = run.catch(() => undefined);
  return run;
}
