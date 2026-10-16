import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListEntry } from '../api/types';
import MarkdownView, { detectDiagram } from './MarkdownView';
import { mayHaveMath } from './math';
import { rehypePlugins, remarkPlugins, sanitizeSchema } from './pipeline';
import { scrollToHash } from './scroll';
import { renderMermaid } from '../diagrams/mermaid';

vi.mock('../diagrams/mermaid', () => ({
  renderMermaid: vi.fn(() => ({
    result: new Promise<string>(() => undefined),
    promote: () => undefined,
    cancel: () => undefined,
  })),
  preloadMermaid: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderMd(text: string, opts: { ws?: string; at?: string } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <MarkdownView
            text={text}
            root="r"
            docPath="docs/guide.md"
            scope={opts.ws === undefined ? undefined : { ws: opts.ws }}
          />
        ),
      },
    ],
    { initialEntries: [opts.at ?? '/view/r/docs/guide.md'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, body: view.container.querySelector('.markdown-body') as HTMLElement };
}

describe('pipeline', () => {
  it('uses the exact plugin order', () => {
    const name = (p: unknown) => (Array.isArray(p) ? p[0] : p).name;
    expect(remarkPlugins.map(name)).toEqual([
      'remarkGfm',
      'remarkFrontmatter',
      'remarkMath',
      'remarkAlerts',
    ]);
    expect(rehypePlugins.map(name)).toEqual(['rehypeRaw', 'rehypeSanitize', 'rehypeSlug']);
    expect(rehypePlugins[1]).toEqual([expect.any(Function), sanitizeSchema]);
  });

  it('keeps the default clobber prefix and allows language-* and math classes on code', () => {
    expect(sanitizeSchema.clobberPrefix).toBe('user-content-');
    expect(sanitizeSchema.attributes?.code).toEqual([
      ['className', /^language-./, 'math-inline', 'math-display'],
    ]);
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
    // Held back until the folder listing settles (see 'live images').
    expect(imgs[0]).not.toHaveAttribute('src');
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
    const { body } = renderMd('![a](https://example.com/i.png)\n\n![b](b.png)');
    for (const img of body.querySelectorAll('img')) {
      expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    }
  });
});

describe('live images', () => {
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  function serveLists(lists: Record<string, ListEntry[] | number>) {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://x');
      const got = lists[url.searchParams.get('path') ?? ''];
      if (url.pathname !== '/api/list' || got === undefined) return json(404, {});
      if (typeof got === 'number') return json(got, { error: { code: 'x', message: 'x' } });
      return json(200, {
        root: 'r',
        path: url.searchParams.get('path'),
        truncated: false,
        entries: got,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const file = (name: string, size: number): ListEntry => ({
    name,
    type: 'file',
    kind: 'image',
    size,
    mtime: '2026-10-12T10:00:00Z',
  });

  it('versions each image from its folder listing, one listing per folder', async () => {
    const fetchMock = serveLists({
      docs: [file('a.png', 5)],
      images: [file('b.png', 7), file('c.png', 9)],
    });
    const { body } = renderMd('![a](a.png) ![b](../images/b.png) ![c](/images/c.png)');
    const imgs = body.querySelectorAll('img');
    await waitFor(() => expect(imgs[2]).toHaveAttribute('src'));
    expect(imgs[0].getAttribute('src')).toBe(
      '/api/file?root=r&path=docs%2Fa.png&v=2026-10-12T10%3A00%3A00Z-5',
    );
    expect(imgs[1].getAttribute('src')).toContain(
      'path=images%2Fb.png&v=2026-10-12T10%3A00%3A00Z-7',
    );
    expect(imgs[2].getAttribute('src')).toContain(
      'path=images%2Fc.png&v=2026-10-12T10%3A00%3A00Z-9',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the plain URL when the image is not listed or the listing fails', async () => {
    serveLists({ docs: [], gone: 503 });
    const { body } = renderMd('![a](a.png) ![b](gone/b.png)');
    const imgs = body.querySelectorAll('img');
    await waitFor(() => expect(imgs[1]).toHaveAttribute('src'));
    expect(imgs[0].getAttribute('src')).toBe('/api/file?root=r&path=docs%2Fa.png');
    expect(imgs[1].getAttribute('src')).toBe('/api/file?root=r&path=docs%2Fgone%2Fb.png');
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

  it('renders diagram figures for diagram fences and normal code otherwise', () => {
    const { body } = renderMd(
      'Before\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```d2\na -> b\n```\n\n```js\nx()\n```\n\nAfter',
    );
    expect(body.querySelector('figure.diagram[data-diagram="mermaid"]')).not.toBeNull();
    expect(body.querySelector('figure.diagram[data-diagram="d2"]')).not.toBeNull();
    expect(body.querySelectorAll('figure.diagram').length).toBe(2);
    expect(body.querySelector('pre code.language-js')).not.toBeNull();
    expect(body.textContent).toContain('Before');
    expect(body.textContent).toContain('After');
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

describe('copy-code button', () => {
  it('wraps fenced code with and without a language, but not diagrams or inline code', () => {
    const { body } = renderMd(
      '```ts\nconst a = 1;\n```\n\n```\nplain\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n`inline`',
    );
    expect(body.querySelectorAll('.code-block')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('copies the code without the trailing newline and shows the result', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderMd('```\nline 1\nline 2\n```');
    screen.getByRole('button', { name: 'Copy' }).click();
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith('line 1\nline 2');
  });

  it('shows a failure and returns to idle after two seconds', async () => {
    vi.stubGlobal('isSecureContext', false);
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    renderMd('```\nx\n```');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      screen.getByRole('button', { name: 'Copy' }).click();
      await screen.findByRole('button', { name: 'Copy failed' });
      await vi.advanceTimersByTimeAsync(2000);
      await screen.findByRole('button', { name: 'Copy' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('front matter panel', () => {
  it('shows the raw YAML in a collapsed panel outside the document body', () => {
    const { container, body } = renderMd('---\ntitle: Secret Title\n---\n\n# Visible');
    const panel = container.querySelector('details.front-matter') as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent).toBe('Front matter');
    expect(panel.querySelector('pre code')?.textContent).toBe('title: Secret Title');
    expect(body.contains(panel)).toBe(false);
    expect(body.textContent).not.toContain('Secret Title');
  });

  it('is absent without front matter or when it is blank', () => {
    expect(renderMd('# A\n\n---\n\nb').container.querySelector('.front-matter')).toBeNull();
    expect(renderMd('---\n  \n---\n# A').container.querySelector('.front-matter')).toBeNull();
  });
});

describe('table of contents', () => {
  afterEach(() => window.localStorage.clear());

  const doc = '# Title\n\n## One\n\n### One `a`\n\n## Two[^n]\n\n[^n]: note';

  it('lists the rendered headings with matching ids, nested by level, outside the body', () => {
    const { container, body } = renderMd(doc);
    const panel = container.querySelector('details.toc') as HTMLDetailsElement;
    expect(panel.querySelector('summary')?.textContent).toBe('Contents');
    expect(body.contains(panel)).toBe(false);
    const nav = screen.getByRole('navigation', { name: 'Table of contents' });
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Title', 'One', 'One a', 'Two1']);
    expect(links.map((a) => a.parentElement!.style.paddingLeft)).toEqual([
      '0em',
      '1em',
      '2em',
      '1em',
    ]);
    for (const a of links) {
      const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
      expect(body.querySelector(`[id="${id}"]`)?.tagName).toMatch(/^H[1-6]$/);
    }
    // The GFM footnotes label heading is not listed.
    expect(body.querySelector('h2.sr-only')?.textContent).toBe('Footnotes');
  });

  it('is absent with fewer than two headings', () => {
    expect(renderMd('# Only\n\ntext').container.querySelector('.toc')).toBeNull();
    expect(renderMd('no headings').container.querySelector('.toc')).toBeNull();
  });

  it('follows live text changes', async () => {
    const client = new QueryClient();
    const ui = (text: string) => (
      <QueryClientProvider client={client}>
        <RouterProvider
          router={createMemoryRouter([
            { path: '*', element: <MarkdownView text={text} root="r" docPath="a.md" /> },
          ])}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(ui('## A\n\n## B'));
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['A', 'B']);
    rerender(ui('## A\n\n## B\n\n## C'));
    await waitFor(() =>
      expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['A', 'B', 'C']),
    );
  });

  it('starts closed on narrow screens and persists its open state', async () => {
    const { container } = renderMd(doc);
    const panel = container.querySelector('details.toc') as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    panel.open = true;
    await waitFor(() => expect(window.localStorage.getItem('mdv-toc-open')).toBe('1'));
    panel.open = false;
    await waitFor(() => expect(window.localStorage.getItem('mdv-toc-open')).toBe('0'));
  });

  it('starts open when stored open or on wide screens', () => {
    window.localStorage.setItem('mdv-toc-open', '1');
    expect((renderMd(doc).container.querySelector('details.toc') as HTMLDetailsElement).open).toBe(
      true,
    );
    cleanup();
    window.localStorage.clear();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(min-width: 1400px)' }));
    expect((renderMd(doc).container.querySelector('details.toc') as HTMLDetailsElement).open).toBe(
      true,
    );
    cleanup();
    window.localStorage.setItem('mdv-toc-open', '0');
    expect((renderMd(doc).container.querySelector('details.toc') as HTMLDetailsElement).open).toBe(
      false,
    );
  });
});

describe('math (KaTeX)', () => {
  const katexIn = async (body: HTMLElement) =>
    waitFor(() => {
      expect(body.getAttribute('aria-busy')).toBeNull();
      expect(body.querySelector('.katex')).not.toBeNull();
    });

  it('detects documents that may contain math', () => {
    expect(mayHaveMath('costs $5')).toBe(true);
    expect(mayHaveMath('```math\nx\n```')).toBe(true);
    expect(mayHaveMath('~~~ Math\nx\n~~~')).toBe(true);
    expect(mayHaveMath('# plain\n\n```js\nmath()\n```')).toBe(false);
  });

  it('renders inline, display and ```math fences', async () => {
    const { body } = renderMd(
      [
        'Inline $E=mc^2$ here.',
        '',
        '$$',
        '\\int_0^1 x\\,dx',
        '$$',
        '',
        '```math',
        'a^2+b^2',
        '```',
      ].join('\n'),
    );
    await katexIn(body);
    const tex = [...body.querySelectorAll('annotation[encoding="application/x-tex"]')].map((a) =>
      a.textContent?.trim(),
    );
    expect(tex).toEqual(['E=mc^2', '\\int_0^1 x\\,dx', 'a^2+b^2']);
    expect(body.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(body.querySelector('.katex-display')?.closest('p')).toBeNull();
    // Math fences are not code blocks (no copy button, no Shiki).
    expect(body.querySelector('.code-block')).toBeNull();
  });

  it('shows a parse error inline instead of failing the document', async () => {
    const { body } = renderMd('Bad $\\frac{1}{$ math and a [link](./other.md).');
    await waitFor(() => expect(body.querySelector('.katex-error')).not.toBeNull());
    expect(body.querySelector('a[href="/view/r/docs/other.md"]')).not.toBeNull();
  });

  it('keeps \\href and \\url disabled; raw HTML math only through code classes', async () => {
    const { body } = renderMd(
      [
        '$\\href{javascript:alert(1)}{x}$ and $\\url{https://example.com}$ and $y$',
        '',
        '<span class="math-inline">z^2</span> <code class="math-display">w</code>',
      ].join('\n'),
    );
    await katexIn(body);
    expect(body.querySelector('a')).toBeNull();
    // `span.math-inline` loses its class; `code.math-display` is allowed, like `$$`.
    expect(body.querySelectorAll('annotation')).toHaveLength(4);
    expect(body.querySelector('span:not([class])')?.textContent).toBe('z^2');
  });

  it('uses the TeX source for heading slugs and TOC text', async () => {
    const { container, body } = renderMd('# Energy $E=mc^2$\n\n## Second\n');
    await katexIn(body);
    expect(body.querySelector('h1')?.id).toBe('energy-emc2');
    const first = container.querySelector('.toc a');
    expect(first?.textContent).toBe('Energy E=mc^2');
    expect(first?.getAttribute('href')).toBe('#energy-emc2');
  });
});

describe('GitHub alerts', () => {
  it('renders every alert type with a title and its content', () => {
    const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    const { body } = renderMd(types.map((t) => `> [!${t}]\n> About ${t}.`).join('\n\n'));
    const alerts = [...body.querySelectorAll('div.markdown-alert')];
    expect(alerts.map((a) => a.className)).toEqual(
      types.map((t) => `markdown-alert markdown-alert-${t.toLowerCase()}`),
    );
    expect(alerts.map((a) => a.querySelector('p.markdown-alert-title')?.textContent)).toEqual([
      'Note',
      'Tip',
      'Important',
      'Warning',
      'Caution',
    ]);
    expect(alerts[0].querySelectorAll('p')[1].textContent).toBe('About NOTE.');
    expect(body.querySelector('blockquote')).toBeNull();
  });

  it('accepts any case, a hard break, and several blocks of content', () => {
    const { body } = renderMd(
      '> [!tip]  \n> **Bold** start\n>\n> - item\n\n> [!Warning]\n>\n> Next para',
    );
    const [tip, warning] = body.querySelectorAll('div.markdown-alert');
    expect(tip.className).toContain('markdown-alert-tip');
    expect(tip.querySelector('p:nth-of-type(2) strong')?.textContent).toBe('Bold');
    expect(tip.querySelector('li')?.textContent).toBe('item');
    expect(warning.querySelector('p:nth-of-type(2)')?.textContent).toBe('Next para');
  });

  it('leaves other blockquotes alone', () => {
    const { body } = renderMd(
      [
        '> [!NOTE] same line',
        '',
        '> [!NOTE] *emphasis*',
        '',
        '> [!NOTE]',
        '',
        '> [!HINT]\n> unknown type',
        '',
        '> text\n> [!NOTE]',
      ].join('\n'),
    );
    expect(body.querySelector('.markdown-alert')).toBeNull();
    expect(body.querySelectorAll('blockquote')).toHaveLength(5);
  });

  it('only keeps the alert classes on raw HTML', () => {
    const { body } = renderMd(
      '<div class="markdown-alert markdown-alert-note evil">x</div>\n\n<p class="markdown-alert-title other">t</p>',
    );
    expect(body.querySelector('div')?.className).toBe('markdown-alert markdown-alert-note');
    expect(body.querySelector('p')?.className).toBe('markdown-alert-title');
  });
});

describe('render stability', () => {
  const doc = '# A\n\n```mermaid\ngraph TD; A-->B\n```\n\n## B\n\n```mermaid\ngraph TD; C-->D\n```';

  it('renders each diagram once across TOC, hash and same-props re-renders', async () => {
    const mock = vi.mocked(renderMermaid);
    mock.mockClear();
    const client = new QueryClient();
    const router = createMemoryRouter([
      { path: '*', element: <MarkdownView text={doc} root="r" docPath="a.md" /> },
    ]);
    const ui = (
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    const { container, rerender } = render(ui);
    await waitFor(() => expect(container.querySelector('.toc')).not.toBeNull());
    expect(mock).toHaveBeenCalledTimes(2);
    rerender(ui);
    await router.navigate('/#b');
    await waitFor(() => expect(router.state.location.hash).toBe('#b'));
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
