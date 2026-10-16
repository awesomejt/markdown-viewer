import { browseHref, fileUrl, viewHref, type NavScope } from '../api/client';
import { scopeNav } from '../browse/logic';

export interface LinkContext {
  root: string;
  /** Path of the current document, relative to the root (e.g. `docs/guide.md`). */
  docPath: string;
  /** Workspace folder (`''` = the whole root) or open project that internal links carry. */
  scope?: NavScope;
}

export type ResolvedLink =
  /** `#frag` (or empty) link within the current document. */
  | { type: 'anchor'; href: string }
  /** `http(s)` / `mailto`: left unchanged, opened in a new tab. */
  | { type: 'external'; href: string }
  /** In-app route (`/view/...`, `/browse/...`). */
  | { type: 'internal'; href: string }
  /** Raw file served by `/api/file`. */
  | { type: 'asset'; href: string; path: string }
  /** Not rendered as a link. */
  | { type: 'blocked'; reason: 'scheme' | 'outside-root' | 'invalid' };

export const OUTSIDE_ROOT_TITLE = 'Link points outside the root';

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);
const DOC_EXTS = ['.md', '.markdown', '.mmd', '.mermaid', '.d2'];

/** Browsers ignore leading whitespace and control characters (and tabs/newlines inside schemes). */
function normalizeRaw(href: string): string {
  // eslint-disable-next-line no-control-regex
  return href.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
}

function safeDecode(seg: string): string | null {
  try {
    const out = decodeURIComponent(seg);
    return out.includes('/') || out.includes('\\') || out.includes('\0') ? null : out;
  } catch {
    return null;
  }
}

/** Resolve `.`/`..` against the document folder. `null` = invalid; `'outside'` = climbs above the root. */
function resolvePath(
  rawPath: string,
  docPath: string,
): { path: string; dir: boolean } | null | 'outside' {
  const rootRelative = rawPath.startsWith('/');
  const stack: string[] = [];
  if (!rootRelative) {
    const docSegs = docPath.split('/').filter(Boolean);
    docSegs.pop();
    stack.push(...docSegs);
  }
  const segs = rawPath.split('/');
  let dir = rawPath.endsWith('/');
  for (let i = 0; i < segs.length; i++) {
    const raw = segs[i];
    if (raw === '') continue;
    const seg = safeDecode(raw);
    if (seg === null) return null;
    const last = i === segs.length - 1;
    if (seg === '.') {
      if (last) dir = true;
    } else if (seg === '..') {
      if (stack.length === 0) return 'outside';
      stack.pop();
      if (last) dir = true;
    } else {
      stack.push(seg);
    }
  }
  return { path: stack.join('/'), dir };
}

/**
 * Map a Markdown `href`/`src` to an app target. Pure; see Architecture "Link rewriting in Markdown".
 * Images pass `isImage` so they always become file URLs when relative.
 */
export function resolveLink(rawHref: string, ctx: LinkContext, isImage = false): ResolvedLink {
  const href = normalizeRaw(rawHref);
  if (href.startsWith('#')) return { type: 'anchor', href };
  if (href.startsWith('//') || href.startsWith('\\\\'))
    return { type: 'blocked', reason: 'scheme' };
  const scheme = SCHEME_RE.exec(href);
  if (scheme) {
    return EXTERNAL_SCHEMES.has(scheme[1].toLowerCase())
      ? { type: 'external', href }
      : { type: 'blocked', reason: 'scheme' };
  }

  const hashAt = href.indexOf('#');
  const frag = hashAt >= 0 ? href.slice(hashAt) : '';
  const beforeFrag = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = beforeFrag.indexOf('?');
  const rawPath = qAt >= 0 ? beforeFrag.slice(0, qAt) : beforeFrag;
  if (rawPath === '') return { type: 'anchor', href: frag };

  const resolved = resolvePath(rawPath, ctx.docPath);
  if (resolved === null) return { type: 'blocked', reason: 'invalid' };
  if (resolved === 'outside') return { type: 'blocked', reason: 'outside-root' };

  const { path, dir } = resolved;
  const scope = scopeNav(path, ctx.scope);
  const lower = path.toLowerCase();
  if (!isImage) {
    if (dir || path === '')
      return { type: 'internal', href: browseHref(ctx.root, path, scope) + frag };
    if (DOC_EXTS.some((e) => lower.endsWith(e))) {
      return { type: 'internal', href: viewHref(ctx.root, path, scope) + frag };
    }
  }
  return { type: 'asset', href: fileUrl(ctx.root, path), path };
}
