import { describe, expect, it } from 'vitest';
import { katexPlugin } from './katex';

describe('katexPlugin', () => {
  it('caps sizes and keeps trust off', () => {
    expect((katexPlugin as unknown[])[1]).toMatchObject({
      maxSize: 20,
      trust: false,
      strict: 'ignore',
    });
  });
});
