import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  highlightToHast,
  isHighlighterStarted,
  languageForFile,
  languageLoaders,
  resetHighlighter,
  resolveLanguage,
} from './highlight';
import MarkdownView from './MarkdownView';

vi.mock('../diagrams/mermaid', () => ({
  renderMermaid: () => new Promise<string>(() => undefined),
}));

function renderMd(text: string) {
  const router = createMemoryRouter(
    [{ path: '*', element: <MarkdownView text={text} root="r" docPath="a.md" /> }],
    { initialEntries: ['/view/r/a.md'] },
  );
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, body: view.container.querySelector('.markdown-body') as HTMLElement };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => resetHighlighter());
afterEach(() => vi.restoreAllMocks());

describe('resolveLanguage', () => {
  it('maps aliases and rejects unknown or prototype names', () => {
    expect(resolveLanguage('ts')).toBe('typescript');
    expect(resolveLanguage('YML')).toBe('yaml');
    expect(resolveLanguage('sh')).toBe('bash');
    expect(resolveLanguage('go')).toBe('go');
    expect(resolveLanguage('notalang')).toBeNull();
    expect(resolveLanguage('constructor')).toBeNull();
    expect(resolveLanguage('__proto__')).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });
});

describe('languageForFile', () => {
  it('maps extensions, including file-only aliases', () => {
    expect(languageForFile('a/b/sample.go')).toBe('go');
    expect(languageForFile('config.YAML')).toBe('yaml');
    expect(languageForFile('x.yml')).toBe('yaml');
    expect(languageForFile('run.sh')).toBe('bash');
    expect(languageForFile('lib.h')).toBe('c');
    expect(languageForFile('lib.hpp')).toBe('cpp');
    expect(languageForFile('tsconfig.jsonc')).toBe('json');
    expect(languageForFile('build.gradle.kts')).toBe('kotlin');
    expect(languageForFile('stub.pyi')).toBe('python');
  });

  it('returns null without a supported extension', () => {
    expect(languageForFile('notes.txt')).toBeNull();
    expect(languageForFile('data.csv')).toBeNull();
    expect(languageForFile('Makefile')).toBeNull();
    expect(languageForFile('.bashrc')).toBeNull();
    expect(languageForFile('dir.go/file')).toBeNull();
    expect(languageForFile('x.constructor')).toBeNull();
    expect(languageForFile('x.hasOwnProperty')).toBeNull();
  });
});

describe('syntax highlighting', () => {
  it('shows plain text first, then colored Shiki spans', async () => {
    const { body } = renderMd('```ts\nconst x: number = 1;\n```');
    expect(body.querySelector('pre code.language-ts')?.textContent).toContain('const x');
    expect(body.querySelector('.shiki')).toBeNull();
    await vi.waitFor(() => expect(body.querySelector('pre.shiki')).not.toBeNull());
    const code = body.querySelector('pre.shiki code');
    expect(code).toHaveClass('language-ts');
    expect(code?.textContent).toBe('const x: number = 1;');
    const span = body.querySelector('.shiki span span') as HTMLElement;
    expect(span.getAttribute('style')).toMatch(/(^|;\s*)color:\s*(rgb|#)/i);
    expect(span.getAttribute('style')).toContain('--shiki-dark');
  });

  it('keeps highlighted output sanitized: code stays text', async () => {
    const { body } = renderMd(
      [
        '```js\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```',
        '<script>alert(2)</script>',
        '<img src=x onerror=alert(3)>',
      ].join('\n\n'),
    );
    await vi.waitFor(() => expect(body.querySelector('pre.shiki')).not.toBeNull());
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('.shiki img, .shiki script')).toBeNull();
    expect(body.querySelector('img[onerror]')).toBeNull();
    expect(body.innerHTML).not.toContain('onerror=');
    expect(body.querySelector('.shiki')?.textContent).toContain('<script>alert(1)</script>');
    expect(body.querySelector('.shiki')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('falls back to plain text for an unknown language without loading anything', async () => {
    const spies = Object.keys(languageLoaders).map((k) => vi.spyOn(languageLoaders, k));
    const { body } = renderMd('```notalang\nhello\n```');
    await settle();
    expect(body.querySelector('pre code.language-notalang')?.textContent).toBe('hello\n');
    expect(body.querySelector('.shiki')).toBeNull();
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
    expect(isHighlighterStarted()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('does not start Shiki for blocks without a language', async () => {
    const { body } = renderMd('```\nplain\n```\n\n    indented\n');
    await settle();
    expect(body.querySelectorAll('pre').length).toBe(2);
    expect(isHighlighterStarted()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('loads only the needed languages, once each', async () => {
    const go = vi.spyOn(languageLoaders, 'go');
    const rust = vi.spyOn(languageLoaders, 'rust');
    const python = vi.spyOn(languageLoaders, 'python');
    const { body } = renderMd(
      '```go\npackage a\n```\n\n```golang\npackage b\n```\n\n```py\nx = 1\n```',
    );
    await vi.waitFor(() => expect(body.querySelectorAll('pre.shiki').length).toBe(3));
    expect(go).toHaveBeenCalledTimes(1);
    expect(python).toHaveBeenCalledTimes(1);
    expect(rust).not.toHaveBeenCalled();
  });

  it('falls back to plain text when the language fails to load', async () => {
    vi.spyOn(languageLoaders, 'lua').mockRejectedValue(new Error('chunk failed'));
    const { body } = renderMd('```lua\nprint(1)\n```');
    await settle();
    expect(body.querySelector('pre code')?.textContent).toBe('print(1)\n');
    expect(body.querySelector('.shiki')).toBeNull();
  });

  it('re-highlights when the text changes', async () => {
    const make = (text: string) =>
      createMemoryRouter(
        [{ path: '*', element: <MarkdownView text={text} root="r" docPath="a.md" /> }],
        { initialEntries: ['/view/r/a.md'] },
      );
    const { rerender, container } = render(
      <RouterProvider router={make('```json\n{"a": 1}\n```')} />,
    );
    await vi.waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull());
    expect(container.querySelector('pre.shiki')?.textContent).toBe('{"a": 1}');
    rerender(<RouterProvider router={make('```json\n{"b": 2}\n```')} />);
    await vi.waitFor(() =>
      expect(container.querySelector('pre.shiki')?.textContent).toBe('{"b": 2}'),
    );
  });

  it('does not update after unmount', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderMd('```yaml\na: 1\n```');
    unmount();
    await settle();
    expect(err).not.toHaveBeenCalled();
  });

  it('serves repeated blocks from the cache', async () => {
    const a = await highlightToHast('json', '{}');
    const b = await highlightToHast('json', '{}');
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(await highlightToHast('nope', 'x')).toBeNull();
  });

  it('renders diagram figures and never invokes Shiki for them', async () => {
    const spies = Object.keys(languageLoaders).map((k) => vi.spyOn(languageLoaders, k));
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    const { body } = renderMd('```mermaid\ngraph TD\nA-->B\n```\n\n```d2\na -> b\n```');
    await settle();
    expect(body.querySelectorAll('figure.diagram').length).toBe(2);
    expect(body.querySelector('.shiki')).toBeNull();
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
    expect(isHighlighterStarted()).toBe(false);
    vi.unstubAllGlobals();
  });
});
