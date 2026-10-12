import type { Root } from 'hast';
import type { HighlighterCore, LanguageRegistration } from '@shikijs/types';

type LangModule = { default: LanguageRegistration[] };
type LangLoader = () => Promise<LangModule>;

/**
 * Fixed set of supported languages. Every entry is a literal `import()` so Vite emits one chunk
 * per language; import paths are never built from document text.
 */
export const languageLoaders: Record<string, LangLoader> = {
  bash: () => import('@shikijs/langs/shellscript'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  makefile: () => import('@shikijs/langs/makefile'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};

const aliases: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  shellscript: 'bash',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
  golang: 'go',
  htm: 'html',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  kt: 'kotlin',
  make: 'makefile',
  md: 'markdown',
  patch: 'diff',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  ts: 'typescript',
  yml: 'yaml',
};

const LIGHT = 'github-light';
const DARK = 'github-dark';
const CACHE_MAX = 100;

/** Maps a fence info string to a supported language id, or null. */
export function resolveLanguage(lang: string | undefined): string | null {
  const key = (lang ?? '').toLowerCase();
  const id = aliases[key] ?? key;
  return Object.hasOwn(languageLoaders, id) ? id : null;
}

// File extensions that are not fence aliases (fence aliases and ids also work as extensions).
const extAliases: Record<string, string> = {
  h: 'c',
  cc: 'cpp',
  cxx: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  jsonc: 'json',
  json5: 'json',
  kts: 'kotlin',
  pyi: 'python',
};

/**
 * Maps a file name to a supported language id by its extension, or null (FR-1.5). A leading dot
 * does not start an extension, as in `fileKind`.
 */
export function languageForFile(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  if (i <= 0) return null;
  const ext = base.slice(i + 1).toLowerCase();
  return resolveLanguage(Object.hasOwn(extAliases, ext) ? extAliases[ext] : ext);
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Map<string, Promise<void>>();
const cache = new Map<string, Root>();

/** Forget the highlighter, loaded languages and cached results (tests). */
export function resetHighlighter(): void {
  highlighterPromise = null;
  loadedLangs.clear();
  cache.clear();
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterPromise;
}

function ensureLanguage(hl: HighlighterCore, id: string): Promise<void> {
  let p = loadedLangs.get(id);
  if (!p) {
    p = hl.loadLanguage(languageLoaders[id]());
    loadedLangs.set(id, p);
  }
  return p;
}

/**
 * Highlights `code` to a hast tree (dual light/dark themes via CSS variables). Resolves to null for
 * an unknown language or on any failure, so callers keep the plain-text block.
 */
export async function highlightToHast(
  rawLang: string,
  code: string,
  className = `language-${rawLang}`,
): Promise<Root | null> {
  const id = resolveLanguage(rawLang);
  if (!id) return null;
  const key = `${className}\0${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const hl = await getHighlighter();
    try {
      await ensureLanguage(hl, id);
    } catch (err) {
      loadedLangs.delete(id);
      throw err;
    }
    const tree = hl.codeToHast(code, {
      lang: id,
      themes: { light: LIGHT, dark: DARK },
      defaultColor: 'light',
      transformers: [
        {
          code(node) {
            node.properties.className = [className];
          },
        },
      ],
    });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, tree);
    return tree;
  } catch {
    return null;
  }
}

/** True once Shiki has been requested (tests: plain blocks must never start it). */
export function isHighlighterStarted(): boolean {
  return highlighterPromise !== null;
}
