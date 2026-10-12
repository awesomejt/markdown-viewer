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

/** Starts fetching the Mermaid chunk early; failures are ignored (the render retries the load). */
export function preloadMermaid(): void {
  load().catch(() => undefined);
}

// Mermaid is not reentrant: renders run one at a time. Jobs near the viewport (high priority) go
// first; every other job still runs afterwards, in arrival order.
interface Job {
  source: string;
  theme: ResolvedTheme;
  high: boolean;
  resolve: (svg: string) => void;
  reject: (e: unknown) => void;
}
const pending: Job[] = [];
let running = false;
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
  // Heading slugs are unprefixed and always lowercase, so an uppercase id can never equal one
  // (the cleanup below would otherwise delete the heading). Raw-HTML ids get `user-content-`.
  const id = `mdvMermaid-${++counter}`;
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

function pump(idle = true): void {
  if (running || pending.length === 0) return;
  running = true;
  // When starting from idle, let the chunk load and IntersectionObservers report before picking,
  // so a freshly mounted document does not start with a diagram that is far off-screen.
  const settled = idle
    ? Promise.all([load().catch(() => undefined), new Promise((r) => setTimeout(r, 50))])
    : Promise.resolve();
  void settled.then(() => {
    const job = pending.find((j) => j.high) ?? pending[0];
    if (!job) {
      running = false;
      return;
    }
    pending.splice(pending.indexOf(job), 1);
    renderNow(job.source, job.theme)
      .then(job.resolve, job.reject)
      .finally(() => {
        running = false;
        pump(false);
      });
  });
}

export interface MermaidJob {
  result: Promise<string>;
  /** Moves a still-pending job to the high-priority group. */
  promote: () => void;
  /** Drops the job if it has not started; its result then rejects. A running render finishes. */
  cancel: () => void;
}

/** Queues a Mermaid render to an SVG string. The result rejects with a readable Error. */
export function renderMermaid(source: string, theme: ResolvedTheme, high = true): MermaidJob {
  let job!: Job;
  const result = new Promise<string>((resolve, reject) => {
    job = { source, theme, high, resolve, reject };
  });
  pending.push(job);
  pump();
  return {
    result,
    promote: () => {
      job.high = true;
    },
    cancel: () => {
      const i = pending.indexOf(job);
      if (i >= 0) {
        pending.splice(i, 1);
        job.reject(new Error('Render cancelled.'));
      }
    },
  };
}
