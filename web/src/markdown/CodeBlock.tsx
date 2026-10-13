import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { highlightToHast, MAX_HIGHLIGHT_CHARS, resolveLanguage } from './highlight';

export interface CodeBlockProps {
  /** Fence language as written (from the `language-*` class), if any. */
  lang: string | undefined;
  className: string | undefined;
  code: string;
  preProps: ComponentProps<'pre'>;
  children: ReactNode;
}

/** Renders the plain block at once, then swaps in Shiki output when it is ready. */
export default function CodeBlock({ lang, className, code, preProps, children }: CodeBlockProps) {
  const supported =
    lang !== undefined && resolveLanguage(lang) !== null && code.length <= MAX_HIGHLIGHT_CHARS;
  const key = `${className}\0${code}`;
  const [done, setDone] = useState<{ key: string; node: ReactNode } | null>(null);

  useEffect(() => {
    if (!supported || lang === undefined) return;
    let cancelled = false;
    // Shiki keeps a trailing newline as an extra empty line; fenced code always ends with one.
    void highlightToHast(lang, code.replace(/\n$/, ''), className).then((tree) => {
      if (cancelled || !tree) return;
      setDone({ key, node: toJsxRuntime(tree, { Fragment, jsx, jsxs }) });
    });
    return () => {
      cancelled = true;
    };
  }, [supported, lang, className, code, key]);

  if (done && done.key === key) return <>{done.node}</>;
  return <pre {...preProps}>{children}</pre>;
}
