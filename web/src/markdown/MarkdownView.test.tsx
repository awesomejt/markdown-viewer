import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView, { detectDiagram } from './MarkdownView';
import { rehypePlugins, remarkPlugins, sanitizeSchema } from './pipeline';
import { scrollToHash } from './scroll';

function renderMd(text: string, opts: { ws?: string; at?: string } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <MarkdownView text={text} root="r" docPath="docs/guide.md" ws={opts.ws} />,
      },
    ],
    { initialEntries: [opts.at ?? '/view/r/docs/guide.md'] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router, body: view.container.querySelector('.markdown-body') as HTMLElement };
}

describe('pipeline', () => {
  it('uses the exact plugin order', () => {
    const name = (p: unknown) => (Array.isArray(p) ? p[0] : p).name;
    expect(remarkPlugins.map(name)).toEqual(['remarkGfm', 'remarkFrontmatter']);
    expect(rehypePlugins.map(name)).toEqual(['rehypeRaw', 'rehypeSanitize', 'rehypeSlug']);
    expect(rehypePlugins[1]).toEqual([expect.any(Function), sanitizeSchema]);
  });

  it('keeps the default clobber prefix and allows language-* classes on code', () => {
    expect(sanitizeSchema.clobberPrefix).toBe('user-content-');
    expect(sanitizeSchema.attributes?.code).toContainEqual(['className', /^language-./]);
  });
});

describe('links and images', () => {
  it('rewrites links and images, keeping ws only inside the workspace', () => {
    const { body } = renderMd(
      [
        '[Sibling](./other.md)',
        '[Up](../README.md)',
        '[Deep](sub/deep.md#section-two)',
        '[Dir](sub/)',
        '![Pixel](../images/pixel.png)',
        '![Ext](https://example.com/i.png)',
      ].join('\n\n'),
      { ws: 'docs' },
    );
    const hrefOf = (t: string) => screen.getByRole('link', { name: t }).getAttribute('href');
    expect(hrefOf('Sibling')).toBe('/view/r/docs/other.md?ws=docs');
    expect(hrefOf('Up')).toBe('/view/r/README.md');
    expect(hrefOf('Deep')).toBe('/view/r/docs/sub/deep.md?ws=docs#section-two');
    expect(hrefOf('Dir')).toBe('/browse/r/docs/sub?ws=docs');
    const imgs = body.querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toBe('/api/file?root=r&path=images%2Fpixel.png');
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(imgs[1].getAttribute('src')).toBe('https://example.com/i.png');
  });

  it('opens external links in a new tab', () => {
    renderMd('[E](https://example.com) [M](mailto:a@b.c)');
    for (const n of ['E', 'M']) {
      const a = screen.getByRole('link', { name: n });
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('renders root escapes as a titled span without href', () => {
    renderMd('[Escapes](../../../etc/passwd)');
    expect(screen.queryByRole('link')).toBeNull();
    const span = screen.getByText('Escapes');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveAttribute('title', 'Link points outside the root');
  });

  it('does not make javascript: links clickable', () => {
    const { body } = renderMd('[js](javascript:alert(1)) [d](data:text/html,x)');
    expect(body.querySelector('a[href]')).toBeNull();
    expect(body.textContent).toContain('js');
  });
});

describe('link hardening', () => {
  it('does not let footnote attributes bypass link resolution', () => {
    renderMd(
      '<a data-footnote-ref href="https://evil.example/x">ext</a> <a data-footnote-backref href="../../x.md">up</a>',
    );
    const ext = screen.getByRole('link', { name: 'ext' });
    expect(ext).toHaveAttribute('target', '_blank');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'up' })).toBeNull();
    expect(screen.getByText('up').tagName).toBe('SPAN');
  });

  it('renders an empty link as plain text', () => {
    renderMd('[x]()');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('x').tagName).toBe('SPAN');
  });

  it('sends no referrer for images', () => {
    const { body } = renderMd('![a](https://example.com/i.png)');
    expect(body.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('sanitizing', () => {
  const unsafe = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://example.com"></iframe>',
    '<details><summary>Sum</summary>\n\nBody\n\n</details>',
    'a<br>b',
  ].join('\n\n');

  it('removes script, onerror and iframe but keeps details and br', () => {
    const { body } = renderMd(unsafe);
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('iframe')).toBeNull();
    expect(body.innerHTML).not.toContain('onerror');
    expect(body.querySelector('details > summary')).not.toBeNull();
    expect(body.querySelector('br')).not.toBeNull();
  });

  it('strips javascript: hrefs written as raw HTML', () => {
    const { body } = renderMd('<a href="javascript:alert(1)">x</a>');
    expect(body.querySelector('a[href]')).toBeNull();
  });
});

describe('headings, anchors and front matter', () => {
  it('generates GitHub-compatible slugs with duplicate suffixes', () => {
    const { body } = renderMd('## Repeated\n\n## Repeated\n\n### Repeated\n\n## Hello, World!');
    expect([...body.querySelectorAll('h2, h3')].map((h) => h.id)).toEqual([
      'repeated',
      'repeated-1',
      'repeated-2',
      'hello-world',
    ]);
  });

  it('resolves [x](#heading) to an existing heading id', () => {
    const { body } = renderMd('# Top\n\n## Section Two\n\n[go](#section-two)');
    const target = screen.getByRole('link', { name: 'go' }).getAttribute('href')!.slice(1);
    expect(body.querySelector(`#${target}`)?.tagName).toBe('H2');
  });

  it('prefixes raw-HTML ids with user-content-', () => {
    const { body } = renderMd('<a id="foo"></a>\n\n# Bar');
    expect(body.querySelector('#user-content-foo')).not.toBeNull();
    expect(body.querySelector('#foo')).toBeNull();
    expect(body.querySelector('#bar')).not.toBeNull();
  });

  it('hides front matter', () => {
    const { body } = renderMd('---\ntitle: Secret Title\ntags: [a]\n---\n\n# Visible');
    expect(body.textContent).not.toContain('Secret Title');
    expect(body.textContent).not.toContain('tags');
    expect(body.querySelector('h1')?.textContent).toBe('Visible');
  });

  it('renders GFM tables, task lists and strikethrough', () => {
    const { body } = renderMd('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~');
    expect(body.querySelector('table td')?.textContent).toBe('1');
    expect(body.querySelector('input[type=checkbox]')).not.toBeNull();
    expect(body.querySelector('del')).not.toBeNull();
  });
});

describe('footnotes', () => {
  it('links every footnote reference and backref to an existing id', () => {
    const { body } = renderMd('Text[^1] and more[^note].\n\n[^1]: First.\n\n[^note]: Second.');
    const links = [...body.querySelectorAll('a[data-footnote-ref], a[data-footnote-backref]')];
    expect(links.length).toBe(4);
    for (const a of links) {
      const id = a.getAttribute('href')!.slice(1);
      expect(id).not.toContain('user-content-user-content');
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });
});

describe('diagram detection', () => {
  it('detects mermaid and d2 class names', () => {
    expect(detectDiagram('language-mermaid')).toBe('mermaid');
    expect(detectDiagram('foo language-d2')).toBe('d2');
    expect(detectDiagram('language-js')).toBeNull();
    expect(detectDiagram(undefined)).toBeNull();
  });

  it('renders placeholders for diagram fences and normal code otherwise', () => {
    const { body } = renderMd(
      '```mermaid\ngraph TD\nA-->B\n```\n\n```d2\na -> b\n```\n\n```js\nx()\n```',
    );
    const m = body.querySelector('pre[data-diagram="mermaid"]');
    expect(m?.textContent).toContain('A-->B');
    expect(body.querySelector('pre[data-diagram="d2"]')?.textContent).toContain('a -> b');
    expect(body.querySelector('pre code.language-js')).not.toBeNull();
    expect(body.querySelectorAll('pre[data-diagram]').length).toBe(2);
  });
});

describe('anchor scrolling', () => {
  let scroll: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll as unknown as typeof Element.prototype.scrollIntoView;
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('scrolls to the heading on initial render', () => {
    renderMd('# Top\n\n## Section Two', { at: '/view/r/docs/guide.md#section-two' });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toHaveProperty('id', 'section-two');
  });

  it('scrolls again when the hash changes', async () => {
    const { router } = renderMd('# Top\n\n## Two', {});
    expect(scroll).not.toHaveBeenCalled();
    await router.navigate('/view/r/docs/guide.md#two');
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  });

  it('scrolls on native hashchange events', () => {
    renderMd('# Top\n\n## Two');
    window.location.hash = '#two';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(scroll).toHaveBeenCalled();
  });

  it('falls back to the user-content- prefix and decodes the hash', () => {
    renderMd('<a id="foo"></a>\n\n## Über uns');
    expect(scrollToHash('#foo')).toBe(true);
    expect(scroll.mock.contexts[0]).toHaveProperty('id', 'user-content-foo');
    expect(scrollToHash('#%C3%BCber-uns')).toBe(true);
    expect(scrollToHash('#missing')).toBe(false);
    expect(scrollToHash('#')).toBe(false);
    expect(scrollToHash('#%E0%A4%A')).toBe(false);
  });
});
