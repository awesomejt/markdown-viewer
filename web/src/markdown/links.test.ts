import { describe, expect, it } from 'vitest';
import { resolveLink, type LinkContext } from './links';

const ctx: LinkContext = { root: 'r', docPath: 'docs/guide.md' };
const withWs = (ws: string): LinkContext => ({ ...ctx, ws });
const href = (h: string, c = ctx, img = false) => {
  const l = resolveLink(h, c, img);
  return l.type === 'blocked' ? `blocked:${l.reason}` : `${l.type}:${l.href}`;
};

describe('resolveLink', () => {
  it('keeps same-document anchors', () => {
    expect(href('#links')).toBe('anchor:#links');
    expect(href('')).toBe('anchor:');
    expect(href('?x=1#top')).toBe('anchor:#top');
  });

  it('resolves relative markdown links against the document folder', () => {
    expect(href('./other.md')).toBe('internal:/view/r/docs/other.md');
    expect(href('other.md')).toBe('internal:/view/r/docs/other.md');
    expect(href('sub/deep.md')).toBe('internal:/view/r/docs/sub/deep.md');
    expect(href('../README.md')).toBe('internal:/view/r/README.md');
    expect(href('sub/../other.md')).toBe('internal:/view/r/docs/other.md');
  });

  it('handles root-relative links', () => {
    expect(href('/top/a.md')).toBe('internal:/view/r/top/a.md');
    expect(href('/')).toBe('internal:/browse/r');
  });

  it('blocks links that climb above the root', () => {
    expect(href('../../x.md')).toBe('blocked:outside-root');
    expect(href('../../../etc/passwd')).toBe('blocked:outside-root');
    expect(href('/../x.md')).toBe('blocked:outside-root');
    expect(href('a/../../../x')).toBe('blocked:outside-root');
  });

  it('treats docs at the root correctly', () => {
    const c = { root: 'r', docPath: 'README.md' };
    expect(href('a.md', c)).toBe('internal:/view/r/a.md');
    expect(href('../a.md', c)).toBe('blocked:outside-root');
  });

  it('leaves http, https and mailto links unchanged (case-insensitive scheme)', () => {
    expect(href('https://example.com/a?b=1#c')).toBe('external:https://example.com/a?b=1#c');
    expect(href('http://example.com')).toBe('external:http://example.com');
    expect(href('mailto:a@b.c')).toBe('external:mailto:a@b.c');
    expect(href('HTTPS://EXAMPLE.COM')).toBe('external:HTTPS://EXAMPLE.COM');
  });

  it('blocks other schemes and protocol-relative links', () => {
    for (const h of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'vbscript:x',
      '//evil.example/x',
    ]) {
      expect(href(h)).toBe('blocked:scheme');
    }
  });

  it('keeps ws inside the workspace and drops it outside', () => {
    expect(href('sub/deep.md#section-two', withWs('docs'))).toBe(
      'internal:/view/r/docs/sub/deep.md?ws=docs#section-two',
    );
    expect(href('../README.md', withWs('docs'))).toBe('internal:/view/r/README.md');
    expect(href('../docs2/a.md', withWs('docs'))).toBe('internal:/view/r/docs2/a.md');
    expect(href('../docs/a.md', withWs('docs'))).toBe('internal:/view/r/docs/a.md?ws=docs');
  });

  it('treats an empty ws as the whole root', () => {
    expect(href('../README.md', withWs(''))).toBe('internal:/view/r/README.md?ws=');
    expect(href('sub/', withWs(''))).toBe('internal:/browse/r/docs/sub?ws=');
  });

  it('routes directories to browse', () => {
    expect(href('sub/')).toBe('internal:/browse/r/docs/sub');
    expect(href('sub/', withWs('docs'))).toBe('internal:/browse/r/docs/sub?ws=docs');
    expect(href('.')).toBe('internal:/browse/r/docs');
    expect(href('..', withWs('docs'))).toBe('internal:/browse/r');
    expect(href('../')).toBe('internal:/browse/r');
  });

  it('routes diagram files to the viewer, ignoring extension case', () => {
    expect(href('a.mmd')).toBe('internal:/view/r/docs/a.mmd');
    expect(href('a.MERMAID')).toBe('internal:/view/r/docs/a.MERMAID');
    expect(href('a.d2')).toBe('internal:/view/r/docs/a.d2');
    expect(href('A.MD')).toBe('internal:/view/r/docs/A.MD');
    expect(href('a.markdown')).toBe('internal:/view/r/docs/a.markdown');
  });

  it('drops source queries and keeps fragments after the ws query', () => {
    expect(href('a.md?x=1#s', withWs('docs'))).toBe('internal:/view/r/docs/a.md?ws=docs#s');
    expect(href('a.md?x=1')).toBe('internal:/view/r/docs/a.md');
  });

  it('decodes percent-encoded segments and re-encodes them', () => {
    expect(href('name%20with%20spaces.md')).toBe('internal:/view/r/docs/name%20with%20spaces.md');
    expect(href('name with spaces.md')).toBe('internal:/view/r/docs/name%20with%20spaces.md');
    expect(href('%E2%82%AC.md')).toBe('internal:/view/r/docs/%E2%82%AC.md');
    expect(href('%2e%2e/%2e%2e/x.md')).toBe('blocked:outside-root');
  });

  it('blocks undecodable and slash-smuggling segments', () => {
    expect(href('%E0%A4%A.md')).toBe('blocked:invalid');
    expect(href('a%2F..%2Fb.md')).toBe('blocked:invalid');
    expect(href('a%5Cb.md')).toBe('blocked:invalid');
    expect(href('a%00.md')).toBe('blocked:invalid');
  });

  it('maps other files and images to /api/file', () => {
    expect(href('../images/pixel.png')).toBe('asset:/api/file?root=r&path=images%2Fpixel.png');
    expect(href('../images/pixel.png', ctx, true)).toBe(
      'asset:/api/file?root=r&path=images%2Fpixel.png',
    );
    expect(href('data.csv')).toBe('asset:/api/file?root=r&path=docs%2Fdata.csv');
    // Images never become view/browse links, even when named like documents.
    expect(href('x.md', ctx, true)).toBe('asset:/api/file?root=r&path=docs%2Fx.md');
    expect(href('https://e.com/i.png', ctx, true)).toBe('external:https://e.com/i.png');
  });
});
