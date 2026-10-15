import type { EntryKind } from '../api/types';

/** Parent folder of a slash path (`""` for top-level entries). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Last segment of a slash path. */
export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

const MARKDOWN_EXTS = 'md markdown mdx';
const DIAGRAM_EXTS = 'mmd mermaid d2';
const IMAGE_EXTS = 'png jpg jpeg gif webp svg avif';
// Mirrors the text list in internal/fsroot/kind.go.
const TEXT_EXTS =
  'txt text log json jsonc json5 yaml yml toml ini cfg conf env properties ' +
  'csv tsv rst adoc org tex bib diff patch ' +
  'go mod sum py pyi rb rs js mjs cjs jsx ts tsx java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs ' +
  'swift m php pl pm lua r jl dart ex exs erl hs ml clj sh bash zsh fish ps1 bat cmd ' +
  'sql graphql gql proto css scss sass less vue svelte tf hcl nix cmake make dockerfile';

const EXT_KINDS = new Map<string, EntryKind>();
for (const [kind, exts] of [
  ['markdown', MARKDOWN_EXTS],
  ['diagram', DIAGRAM_EXTS],
  ['image', IMAGE_EXTS],
  ['text', TEXT_EXTS],
] as const) {
  for (const e of exts.split(' ')) EXT_KINDS.set(e, kind);
}

/**
 * Fallback kind when the parent listing has no entry for the file (listing failed or truncated).
 * Mirrors `ClassifyName` in internal/fsroot/kind.go; the server's `/api/list` classification
 * stays authoritative. A base ending in `.mdv.yaml`/`.mdv.yml` is a `project` (the exact dotfile
 * names qualify). A leading dot does not start an extension (`.hidden` is `other`).
 */
export function fileKind(path: string): EntryKind {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const lower = base.toLowerCase();
  if (lower.endsWith('.mdv.yaml') || lower.endsWith('.mdv.yml')) return 'project';
  const i = base.lastIndexOf('.');
  if (i <= 0) return 'other';
  return EXT_KINDS.get(base.slice(i + 1).toLowerCase()) ?? 'other';
}
