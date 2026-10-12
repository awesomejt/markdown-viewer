import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveController, type EventSourceLike } from './controller';
import { LiveProvider, useLiveSubscription } from './LiveProvider';
import { captureScroll, restoreScroll } from './scrollAnchor';

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, (ev: MessageEvent<string>) => void>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, l);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.(new Event('error'));
  }
  emit(data: string) {
    this.listeners.get('change')?.({ data } as MessageEvent<string>);
  }
}

const last = () => FakeES.all[FakeES.all.length - 1]!;

function setup() {
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const c = new LiveController({
    queryClient: qc,
    createSource: (u) => new FakeES(u),
    random: () => 1,
  });
  c.start();
  return { qc, inv, c };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeES.all = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LiveController', () => {
  it('opens one stream for the coalesced, de-duplicated subs and closes when empty', () => {
    const { c } = setup();
    vi.advanceTimersByTime(100);
    expect(FakeES.all).toHaveLength(0);
    const u1 = c.subscribe('r', 'a.md');
    const u2 = c.subscribe('r', 'a.md');
    c.subscribe('r', 'd');
    vi.advanceTimersByTime(100);
    expect(FakeES.all).toHaveLength(1);
    expect(last().url).toBe('/api/events?sub=r%3Aa.md&sub=r%3Ad');
    u1();
    u1();
    vi.advanceTimersByTime(100);
    expect(FakeES.all).toHaveLength(1);
    u2();
    vi.advanceTimersByTime(100);
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.all[0]!.closed).toBe(true);
    expect(last().url).toBe('/api/events?sub=r%3Ad');
    c.stop();
  });

  it('closes the stream when the last sub goes away', () => {
    const { c } = setup();
    const u = c.subscribe('r', 'a');
    vi.advanceTimersByTime(100);
    const es = last();
    u();
    vi.advanceTimersByTime(100);
    expect(es.closed).toBe(true);
    expect(FakeES.all).toHaveLength(1);
  });

  it('invalidates on open and on change events', () => {
    const { c, inv } = setup();
    c.subscribe('r', 'd/a.md');
    vi.advanceTimersByTime(100);
    last().open();
    expect(inv).toHaveBeenCalledTimes(1);
    expect(inv.mock.calls[0]![0]).toMatchObject({ type: 'active' });
    const pred = inv.mock.calls[0]![0]!.predicate!;
    expect(pred({ queryKey: ['list', 'r', ''] } as never)).toBe(true);
    expect(pred({ queryKey: ['d2', 'x'] } as never)).toBe(false);
    last().emit('garbage');
    expect(inv).toHaveBeenCalledTimes(1);
    last().emit('{"root":"r","path":"d/a.md","op":"deleted"}');
    expect(inv.mock.calls.slice(1).map((x) => x[0]!.queryKey)).toEqual([
      ['file', 'r', 'd/a.md'],
      ['list', 'r', 'd'],
      ['list', 'r', 'd/a.md'],
    ]);
  });

  it('reopens a CLOSED stream with backoff, resets on open, ignores CONNECTING errors', () => {
    const { c } = setup();
    c.subscribe('r', 'a');
    vi.advanceTimersByTime(100);
    last().fail(0);
    vi.advanceTimersByTime(60000);
    expect(FakeES.all).toHaveLength(1);
    last().fail(2);
    vi.advanceTimersByTime(999);
    expect(FakeES.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeES.all).toHaveLength(2);
    last().fail(2);
    vi.advanceTimersByTime(1999);
    expect(FakeES.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeES.all).toHaveLength(3);
    last().open();
    last().fail(2);
    vi.advanceTimersByTime(1000);
    expect(FakeES.all).toHaveLength(4);
  });

  it('on becoming visible refetches and reopens a closed stream immediately', () => {
    const { c, inv } = setup();
    c.subscribe('r', 'a');
    vi.advanceTimersByTime(100);
    last().fail(2);
    inv.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(inv).toHaveBeenCalledTimes(1);
    expect(FakeES.all).toHaveLength(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(inv).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('never sends more than 32 subs and stop() is final', () => {
    const { c } = setup();
    for (let i = 0; i < 40; i++) c.subscribe('r', `f${i}`);
    vi.advanceTimersByTime(100);
    expect(new URL(last().url, 'http://x').searchParams.getAll('sub')).toHaveLength(32);
    const es = last();
    c.stop();
    expect(es.closed).toBe(true);
    c.subscribe('r', 'zzz');
    vi.advanceTimersByTime(100);
    expect(FakeES.all).toHaveLength(1);
  });

  it('drops low-priority subs first at the cap', () => {
    const { c } = setup();
    const lows = Array.from({ length: 40 }, (_, i) => c.subscribe('r', `a${i}.png`, true));
    c.subscribe('r', 'z.md');
    vi.advanceTimersByTime(100);
    const subs = new URL(last().url, 'http://x').searchParams.getAll('sub');
    expect(subs).toHaveLength(32);
    expect(subs[0]).toBe('r:z.md');
    expect(subs.filter((s) => s.endsWith('.png'))).toHaveLength(31);
    for (const u of lows.slice(1)) u();
    vi.advanceTimersByTime(100);
    expect(new URL(last().url, 'http://x').searchParams.getAll('sub')).toEqual([
      'r:z.md',
      'r:a0.png',
    ]);
  });
});

describe('LiveProvider', () => {
  it('subscribes while a component is mounted', () => {
    vi.stubGlobal('EventSource', FakeES);
    function Watcher({ path }: { path: string }) {
      useLiveSubscription('r', path);
      return null;
    }
    const qc = new QueryClient();
    const ui = (path: string | null) => (
      <QueryClientProvider client={qc}>
        <LiveProvider>{path !== null && <Watcher path={path} />}</LiveProvider>
      </QueryClientProvider>
    );
    const { rerender, unmount } = render(ui('a'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(last().url).toBe('/api/events?sub=r%3Aa');
    rerender(ui('b'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(last().url).toBe('/api/events?sub=r%3Ab');
    rerender(ui(null));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(FakeES.all).toHaveLength(2);
    expect(last().closed).toBe(true);
    unmount();
    vi.unstubAllGlobals();
  });

  it('hooks are no-ops without a provider', () => {
    function Watcher() {
      useLiveSubscription('r', 'a');
      return null;
    }
    expect(() => render(<Watcher />)).not.toThrow();
  });
});

describe('scroll anchor', () => {
  it('restores the anchor heading offset, or scrollTop as fallback', () => {
    document.body.innerHTML = '<div id="c"><h2 id="a">A</h2></div>';
    const c = document.getElementById('c')!;
    const h = document.getElementById('a')!;
    let top = -40;
    h.getBoundingClientRect = () => ({ top }) as DOMRect;
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    const snap = captureScroll(c);
    expect(snap).toEqual({ anchor: { id: 'a', offset: -40 }, scrollTop: 500 });
    const by = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const to = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    top = 100;
    restoreScroll(c, snap);
    expect(by).toHaveBeenCalledWith(0, 140);
    restoreScroll(c, { anchor: { id: 'gone', offset: 0 }, scrollTop: 500 });
    expect(to).toHaveBeenCalledWith(0, 500);
    restoreScroll(c, { anchor: null, scrollTop: 7 });
    expect(to).toHaveBeenCalledWith(0, 7);
    vi.restoreAllMocks();
  });
});
