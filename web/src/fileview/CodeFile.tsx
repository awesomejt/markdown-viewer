import { lazy, Suspense } from 'react';
import { languageForFile } from '../markdown/highlight';

const CodeBlock = lazy(() => import('../markdown/CodeBlock'));

/** Files above this many characters stay plain: Shiki runs on the main thread (NFR-3). */
export const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * A standalone text/code file: plain at once, then Shiki colors when the extension maps to a
 * supported language and the file is small enough (FR-1.5).
 */
export function CodeFile({ path, text }: { path: string; text: string }) {
  const lang = text.length <= MAX_HIGHLIGHT_CHARS ? languageForFile(path) : null;
  const plain = <pre className="text-file">{text}</pre>;
  if (!lang) return plain;
  return (
    <Suspense fallback={plain}>
      <CodeBlock
        lang={lang}
        className={`language-${lang}`}
        code={text}
        preProps={{ className: 'text-file' }}
      >
        {text}
      </CodeBlock>
    </Suspense>
  );
}
