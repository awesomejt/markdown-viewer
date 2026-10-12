import { Children, isValidElement, useEffect, type ComponentProps, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { Link, useLocation } from 'react-router';
import { OUTSIDE_ROOT_TITLE, resolveLink, type LinkContext } from './links';
import Diagram, { type DiagramKind } from '../diagrams/Diagram';
import CodeBlock from './CodeBlock';
import { rehypePlugins, remarkPlugins } from './pipeline';
import { scrollToHash } from './scroll';

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
  ws?: string;
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
        if (lang) {
          return (
            <CodeBlock
              lang={lang}
              className={className}
              code={textOf(code.props.children)}
              preProps={rest}
            >
              {children}
            </CodeBlock>
          );
        }
      }
      return <pre {...rest}>{children}</pre>;
    },
  };
}

export default function MarkdownView({ text, root, docPath, ws }: MarkdownViewProps) {
  const { hash } = useLocation();
  const components = makeComponents({ root, docPath, ws });

  // After content renders, and again on every hash change.
  useEffect(() => {
    scrollToHash(hash || window.location.hash);
  }, [hash, text]);
  useEffect(() => {
    const onHash = () => scrollToHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
