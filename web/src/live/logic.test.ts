import { describe, expect, it } from 'vitest';
import {
  MAX_SUBS,
  backoffDelay,
  buildEventsUrl,
  capSubs,
  isApiQueryKey,
  keysForChange,
  parseChange,
  pickAnchor,
} from './logic';

describe('subscriptions', () => {
  it('dedupes, sorts and caps', () => {
    expect(capSubs(['b:x', 'a:y', 'b:x'])).toEqual(['a:y', 'b:x']);
    const many = Array.from({ length: 40 }, (_, i) => `r:${String(i).padStart(2, '0')}`);
    const capped = capSubs(many);
    expect(capped).toHaveLength(MAX_SUBS);
    expect(capped).toEqual(many.slice(0, MAX_SUBS));
  });

  it('builds an encoded URL, or null when empty', () => {
    expect(buildEventsUrl([])).toBeNull();
    const url = buildEventsUrl(['docs:a b/c&d.md', 'docs:']);
    expect(url).toBe('/api/events?sub=docs%3Aa+b%2Fc%26d.md&sub=docs%3A');
    const params = new URL(url!, 'http://x').searchParams.getAll('sub');
    expect(params).toEqual(['docs:a b/c&d.md', 'docs:']);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    expect(backoffDelay(0, 1)).toBe(1000);
    expect(backoffDelay(1, 1)).toBe(2000);
    expect(backoffDelay(3, 1)).toBe(8000);
    expect(backoffDelay(20, 1)).toBe(30000);
  });
  it('applies jitter between 50% and 100%', () => {
    expect(backoffDelay(2, 0)).toBe(2000);
    expect(backoffDelay(2, 0.5)).toBe(3000);
    expect(backoffDelay(-1, 1)).toBe(1000);
  });
});

describe('parseChange', () => {
  it('accepts valid events and rejects the rest', () => {
    expect(parseChange('{"root":"r","path":"a.md","op":"created"}')).toEqual({
      root: 'r',
      path: 'a.md',
      op: 'created',
    });
    expect(parseChange('{"root":"r","path":"a.md","op":"nope"}')).toBeNull();
    expect(parseChange('not json')).toBeNull();
    expect(parseChange('null')).toBeNull();
  });
});

describe('keysForChange', () => {
  it('covers the file, its parent listing and its own listing', () => {
    expect(keysForChange({ root: 'r', path: 'd/a.md' })).toEqual([
      ['file', 'r', 'd/a.md'],
      ['list', 'r', 'd'],
      ['list', 'r', 'd/a.md'],
    ]);
    expect(keysForChange({ root: 'r', path: 'a.md' })[1]).toEqual(['list', 'r', '']);
  });
  it('only refetches API queries on reconnect', () => {
    expect(isApiQueryKey(['list', 'r', ''])).toBe(true);
    expect(isApiQueryKey(['file', 'r', 'a', false])).toBe(true);
    expect(isApiQueryKey(['roots'])).toBe(true);
    expect(isApiQueryKey(['d2', 'src'])).toBe(false);
  });
});

describe('pickAnchor', () => {
  it('picks the last heading at or above the viewport top', () => {
    expect(
      pickAnchor([
        { id: 'a', top: -300 },
        { id: 'b', top: -20 },
        { id: 'c', top: 200 },
      ]),
    ).toEqual({ id: 'b', offset: -20 });
  });
  it('returns null when nothing is above the top or ids are empty', () => {
    expect(pickAnchor([{ id: 'a', top: 50 }])).toBeNull();
    expect(pickAnchor([{ id: '', top: -5 }])).toBeNull();
    expect(pickAnchor([])).toBeNull();
  });
});
