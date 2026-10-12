import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHighlighterStarted, resetHighlighter } from '../markdown/highlight';
import { CodeFile, MAX_HIGHLIGHT_CHARS } from './CodeFile';

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => resetHighlighter());

describe('CodeFile', () => {
  it('shows the plain file first, then Shiki colors for a known extension', async () => {
    const { container } = render(
      <CodeFile path="text/sample.go" text={'package sample\n\nfunc Hello() {}\n'} />,
    );
    expect(container.querySelector('pre.text-file')?.textContent).toContain('package sample');
    await vi.waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull());
    const code = container.querySelector('pre.shiki code');
    expect(code).toHaveClass('language-go');
    expect(code?.textContent).toBe('package sample\n\nfunc Hello() {}');
    const span = container.querySelector('.shiki span span') as HTMLElement;
    expect(span.getAttribute('style')).toMatch(/(^|;\s*)color:\s*(rgb|#)/i);
  });

  it('keeps file content as text', async () => {
    const text = 'const s = "<img src=x onerror=alert(1)>";\n';
    const { container } = render(<CodeFile path="x.ts" text={text} />);
    await vi.waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre.shiki code')?.textContent).toBe(text.trimEnd());
  });

  it('stays plain without starting Shiki for an unsupported extension', async () => {
    const { container } = render(<CodeFile path="notes.txt" text="Plain text notes." />);
    await settle();
    expect(container.querySelector('pre.text-file')?.textContent).toBe('Plain text notes.');
    expect(container.querySelector('.shiki')).toBeNull();
    expect(isHighlighterStarted()).toBe(false);
  });

  it('stays plain above the size cap', async () => {
    const text = 'x'.repeat(MAX_HIGHLIGHT_CHARS + 1);
    const { container } = render(<CodeFile path="big.go" text={text} />);
    await settle();
    expect(container.querySelector('pre.text-file')).not.toBeNull();
    expect(container.querySelector('.shiki')).toBeNull();
    expect(isHighlighterStarted()).toBe(false);
  });
});
