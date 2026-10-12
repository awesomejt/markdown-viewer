import { queryKeys } from '../api/hooks';
import { parentDir } from '../fileview/logic';

/** The server rejects more than this many `sub` params. */
export const MAX_SUBS = 32;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

export interface Sub {
  root: string;
  path: string;
}

export interface ChangeEvent extends Sub {
  op: 'modified' | 'created' | 'deleted';
}

export function subKey(s: Sub): string {
  return `${s.root}:${s.path}`;
}

/** The capped subscriptions: normal keys go out as `sub`, low-priority ones as `lsub`. */
export interface CappedSubs {
  sub: string[];
  lsub: string[];
}

/**
 * Sorted, de-duplicated and capped at {@link MAX_SUBS} in total (extras dropped deterministically). `low`
 * keys (for example a document's images) only fill the slots the others leave free; the server drops
 * invalid ones instead of failing the stream.
 */
export function capSubs(keys: Iterable<string>, low: Iterable<string> = []): CappedSubs {
  const high = [...new Set(keys)].sort().slice(0, MAX_SUBS);
  const highSet = new Set(high);
  const rest = [...new Set(low)]
    .filter((k) => !highSet.has(k))
    .sort()
    .slice(0, MAX_SUBS - high.length);
  return { sub: high, lsub: rest };
}

/** URL of the event stream for the capped subscriptions, or `null` when there is nothing to watch. */
export function buildEventsUrl({ sub, lsub }: CappedSubs): string | null {
  if (sub.length + lsub.length === 0) return null;
  const params = new URLSearchParams();
  for (const k of sub) params.append('sub', k);
  for (const k of lsub) params.append('lsub', k);
  return `/api/events?${params.toString()}`;
}

/** Capped exponential backoff with jitter; `rand` is in [0, 1). */
export function backoffDelay(attempt: number, rand: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.5 + 0.5 * rand));
}

export function parseChange(data: string): ChangeEvent | null {
  try {
    const v = JSON.parse(data) as Partial<ChangeEvent> | null;
    if (
      v &&
      typeof v.root === 'string' &&
      typeof v.path === 'string' &&
      (v.op === 'modified' || v.op === 'created' || v.op === 'deleted')
    ) {
      return { root: v.root, path: v.path, op: v.op };
    }
  } catch {
    // Malformed event: ignore.
  }
  return null;
}

/**
 * Query keys to invalidate for a change: the file itself (all `force` variants by prefix), the listing
 * of its parent (the `/view` kind depends on it), and its own listing when it is a watched directory.
 */
export function keysForChange(e: Sub): (readonly unknown[])[] {
  return [
    ['file', e.root, e.path],
    queryKeys.list(e.root, parentDir(e.path)),
    queryKeys.list(e.root, e.path),
  ];
}

/** Whether a query should be refetched after (re)connecting: API data, not immutable renders. */
export function isApiQueryKey(key: readonly unknown[]): boolean {
  return key[0] === 'roots' || key[0] === 'list' || key[0] === 'file';
}

export interface HeadingPos {
  id: string;
  /** Distance from the viewport top (`getBoundingClientRect().top`). */
  top: number;
}

export interface ScrollAnchor {
  id: string;
  offset: number;
}

/** The last heading at or above the viewport top, or `null` when none (keep scrollTop then). */
export function pickAnchor(headings: readonly HeadingPos[]): ScrollAnchor | null {
  let best: HeadingPos | null = null;
  for (const h of headings) {
    if (h.id !== '' && h.top <= 1 && (best === null || h.top >= best.top)) best = h;
  }
  return best ? { id: best.id, offset: best.top } : null;
}
