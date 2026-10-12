import type { QueryClient } from '@tanstack/react-query';
import {
  backoffDelay,
  buildEventsUrl,
  capSubs,
  isApiQueryKey,
  keysForChange,
  parseChange,
  subKey,
} from './logic';

/** The subset of EventSource the controller uses (lets tests inject a fake). */
export interface EventSourceLike {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}

export interface ControllerOptions {
  queryClient: QueryClient;
  createSource?: (url: string) => EventSourceLike;
  random?: () => number;
  /** Delay that coalesces subscription changes made in one navigation. */
  debounceMs?: number;
}

const CLOSED = 2;

/** Owns the tab's single EventSource and a ref-counted registry of `root:path` subscriptions. */
export class LiveController {
  private readonly qc: QueryClient;
  private readonly createSource: (url: string) => EventSourceLike;
  private readonly random: () => number;
  private readonly debounceMs: number;
  private readonly refs = new Map<string, number>();
  private readonly lowRefs = new Map<string, number>();
  private source: EventSourceLike | null = null;
  private url: string | null = null;
  private started = false;
  private attempt = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: ControllerOptions) {
    this.qc = opts.queryClient;
    this.createSource = opts.createSource ?? ((u) => new EventSource(u));
    this.random = opts.random ?? Math.random;
    this.debounceMs = opts.debounceMs ?? 50;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  stop(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearTimeout(this.syncTimer);
    clearTimeout(this.retryTimer);
    this.closeSource();
  }

  /**
   * Register interest in `root:path`; returns the unsubscribe function. `low` subscriptions only use
   * the slots left under the server cap (see {@link capSubs}).
   */
  subscribe(root: string, path: string, low = false): () => void {
    const key = subKey({ root, path });
    const refs = low ? this.lowRefs : this.refs;
    refs.set(key, (refs.get(key) ?? 0) + 1);
    this.schedule();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (refs.get(key) ?? 1) - 1;
      if (n <= 0) refs.delete(key);
      else refs.set(key, n);
      this.schedule();
    };
  }

  private schedule(): void {
    if (!this.started) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), this.debounceMs);
  }

  private sync(): void {
    const url = buildEventsUrl(capSubs(this.refs.keys(), this.lowRefs.keys()));
    if (url === this.url && (url === null || this.source !== null)) return;
    clearTimeout(this.retryTimer);
    this.closeSource();
    this.url = url;
    if (url !== null) this.open(url);
  }

  private closeSource(): void {
    if (this.source) {
      this.source.onopen = null;
      this.source.onerror = null;
      this.source.close();
    }
    this.source = null;
    this.url = null;
  }

  private open(url: string): void {
    const es = this.createSource(url);
    this.source = es;
    this.url = url;
    es.onopen = () => {
      this.attempt = 0;
      this.invalidateAll();
    };
    es.onerror = () => {
      // CONNECTING means the browser retries by itself; CLOSED (e.g. after a 503) is fatal.
      if (es.readyState !== CLOSED || this.source !== es) return;
      this.closeSource();
      const delay = backoffDelay(this.attempt++, this.random());
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.sync(), delay);
    };
    es.addEventListener('change', (ev) => {
      const change = parseChange(ev.data);
      if (!change) return;
      for (const queryKey of keysForChange(change)) {
        void this.qc.invalidateQueries({ queryKey });
      }
    });
  }

  private invalidateAll(): void {
    void this.qc.invalidateQueries({
      type: 'active',
      predicate: (q) => isApiQueryKey(q.queryKey),
    });
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.invalidateAll();
    if (this.source === null && this.refs.size + this.lowRefs.size > 0) {
      clearTimeout(this.retryTimer);
      this.sync();
    }
  };
}
