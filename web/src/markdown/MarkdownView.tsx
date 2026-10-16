import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import { Link, useLocation } from 'react-router';
import type { Root } from 'mdast';
import type { NavScope } from '../api/client';
import { OUTSIDE_ROOT_TITLE, resolveLink, type LinkContext } from './links';
import { preloadMermaid } from '../diagrams/mermaid';
import Diagram, { type DiagramKind } from '../diagrams/Diagram';
import CodeBlock from './CodeBlock';
import CopyButton from './CopyButton';
import { extractFrontMatter } from './frontMatter';
import MarkdownImage from './MarkdownImage';
import { useMathPlugin } from './math';
import { rehypePlugins, remarkPlugins } from './pipeline';
import { READ_TIME_DEFAULTS, countWords, formatReadTime } from './readTime';
import { scrollToHash } from './scroll';
import Toc from './Toc';
import { collectHeadings, sameEntries, type TocEntry } from './toc';
import { captureScroll, restoreScroll, type ScrollSnapshot } from '../live/scrollAnchor';

export type { DiagramKind };

/** Detects a fenced diagram block from a (sanitized) `code` className such as `language-mermaid`. */
export function detectDiagram(className: string | undefined): DiagramKind | null {
  for (const cls of (className ?? '').split(/\s+/)) {
    if (cls === 'language-mermaid') return 'mermaid';
    if (cls === 'language-d2') return 'd2';
  }
  return null;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

export interface MarkdownViewProps {
  text: string;
  root: string;
  /** Path of this document relative to the root. */
  docPath: string;
  scope?: NavScope;
}

function makeComponents(ctx: LinkContext): Components {
  return {
    a({ node: _node, href, children, ...rest }: ComponentProps<'a'> & { node?: unknown }) {
      // No href: a named anchor, or sanitize removed an unsafe href. Keep the element (and its id).
      if (href === undefined) return <a {...rest}>{children}</a>;
      const props = rest as Record<string, unknown>;
      if (
        href.startsWith('#') &&
        (props['data-footnote-ref'] !== undefined || props['data-footnote-backref'] !== undefined)
      ) {
        // remark-rehype's footnote hrefs are unprefixed (clobberPrefix ''); sanitize prefixes the ids.
        return (
          <a {...rest} href={href.replace(/^#/, '#user-content-')}>
            {children}
          </a>
        );
      }
      const link = resolveLink(href, ctx);
      switch (link.type) {
        case 'anchor':
          // An empty href would reload the page; show the text only.
          if (link.href === '') return <span className="link-blocked">{children}</span>;
          return (
            <a {...rest} href={link.href}>
              {children}
            </a>
          );
        case 'external':
          return (
            <a {...rest} href={link.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        case 'internal':
          return (
            <Link {...(rest as object)} to={link.href}>
              {children}
            </Link>
          );
        case 'asset':
          return (
            <a {...rest} href={link.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        case 'blocked':
          return link.reason === 'outside-root' ? (
            <span className="link-blocked" title={OUTSIDE_ROOT_TITLE}>
              {children}
            </span>
          ) : (
            <span className="link-blocked">{children}</span>
          );
      }
    },
    img({ node: _node, src, alt, ...rest }: ComponentProps<'img'> & { node?: unknown }) {
      if (typeof src !== 'string') return null;
      const link = resolveLink(src, ctx, true);
      if (link.type === 'blocked' || link.type === 'anchor') return alt ? <span>{alt}</span> : null;
      if (link.type === 'asset') {
        return <MarkdownImage {...rest} root={ctx.root} path={link.path} alt={alt ?? ''} />;
      }
      return (
        <img
          {...rest}
          src={link.href}
          alt={alt ?? ''}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    },
    pre({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
      // Diagram fences render via `Diagram` (F4); other fenced blocks are highlighted by Shiki (F3b).
      const code = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: ReactNode }>(code)) {
        const kind = detectDiagram(code.props.className);
        if (kind) {
          return <Diagram kind={kind} source={textOf(code.props.children).replace(/\n$/, '')} />;
        }
        const className = code.props.className;
        const lang = /(?:^|\s)language-(\S+)/.exec(className ?? '')?.[1];
        const text = textOf(code.props.children);
        return (
          <div className="code-block">
            {lang ? (
              <CodeBlock lang={lang} className={className} code={text} preProps={rest}>
                {children}
              </CodeBlock>
            ) : (
              <pre {...rest}>{children}</pre>
            )}
            <CopyButton text={text.replace(/\n$/, '')} />
          </div>
        );
      }
      return <pre {...rest}>{children}</pre>;
    },
  };
}

const remarkRehypeOptions = { clobberPrefix: '' };

export default function MarkdownView({ text, root, docPath, scope }: MarkdownViewProps) {
  const { hash } = useLocation();
  const components = useMemo(
    () => makeComponents({ root, docPath, scope }),
    [root, docPath, scope],
  );
  const math = useMathPlugin(text);
  const hasMermaid = /(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(text);
  useEffect(() => {
    if (hasMermaid) preloadMermaid();
  }, [hasMermaid]);
  const ready = math.ready;
  const plugins = useMemo(
    () => (math.plugin ? [...rehypePlugins, math.plugin] : rehypePlugins),
    [math.plugin],
  );

  // The read-time word count walks the mdast the renderer already parsed: a last remark plugin hands
  // the tree to a ref (no state during render); an effect below publishes the count.
  const mdast = useRef<{ text: string; tree: Root } | null>(null);
  const remarkWithCapture = useMemo(
    () => [
      ...remarkPlugins,
      () => (tree: Root) => {
        mdast.current = { text, tree };
      },
    ],
    [text],
  );

  // Memoized so re-renders (TOC state, hash change) don't re-parse or remount diagrams.
  const body = useMemo(
    () => (
      <Markdown
        remarkPlugins={remarkWithCapture}
        rehypePlugins={plugins}
        remarkRehypeOptions={remarkRehypeOptions}
        components={components}
      >
        {text}
      </Markdown>
    ),
    [text, remarkWithCapture, plugins, components],
  );

  // Live reload: when the text changes under a mounted view, keep the heading nearest the viewport
  // top at the same offset. The snapshot is taken in render, while the DOM still shows the old text.
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevText = useRef(text);
  const snapshot = useRef<ScrollSnapshot | null>(null);
  const restored = useRef(false);
  if (prevText.current !== text) {
    prevText.current = text;
    snapshot.current = bodyRef.current ? captureScroll(bodyRef.current) : null;
  }
  useLayoutEffect(() => {
    if (!ready) return; // keep the snapshot until the body renders
    const snap = snapshot.current;
    snapshot.current = null;
    if (snap && bodyRef.current) {
      restoreScroll(bodyRef.current, snap);
      restored.current = true;
    }
  }, [text, ready]);

  // The TOC is read from the rendered headings, so its ids always match the document's.
  const [toc, setToc] = useState<TocEntry[]>([]);
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const next = collectHeadings(bodyRef.current);
    setToc((prev) => (sameEntries(prev, next) ? prev : next));
  }, [text, ready]);

  const [words, setWords] = useState(0);
  useEffect(() => {
    const captured = mdast.current;
    if (!ready || captured?.text !== text) return;
    const { includeHeadings, includeCode } = READ_TIME_DEFAULTS;
    setWords(countWords(captured.tree, { includeHeadings, includeCode }).words);
  }, [text, ready]);
  const readTime = words > 0 ? formatReadTime(words, READ_TIME_DEFAULTS.wpm) : null;

  // After content renders, and again on every hash change (but not over a live-reload restore).
  useEffect(() => {
    if (!ready) return;
    if (restored.current) {
      restored.current = false;
      return;
    }
    scrollToHash(hash || window.location.hash);
  }, [hash, text, ready]);
  useEffect(() => {
    const onHash = () => scrollToHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const frontMatter = extractFrontMatter(text);

  return (
    <div className="markdown-doc">
      {toc.length >= 2 && <Toc entries={toc} />}
      {frontMatter?.trim() && (
        <details className="front-matter">
          <summary>Front matter</summary>
          <pre>
            <code>{frontMatter}</code>
          </pre>
        </details>
      )}
      {readTime && (
        <p className="read-time" title={readTime.title}>
          {readTime.text}
        </p>
      )}
      <div className="markdown-body" ref={bodyRef} aria-busy={ready ? undefined : true}>
        {ready && body}
      </div>
    </div>
  );
}
