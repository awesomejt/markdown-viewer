export type EntryType = 'dir' | 'file';
export type EntryKind = 'markdown' | 'diagram' | 'image' | 'text' | 'project' | 'other';

export interface Root {
  name: string;
  watch: string;
  available: boolean;
}

export interface RootsResponse {
  roots: Root[];
}

export interface ListEntry {
  name: string;
  type: EntryType;
  kind: EntryKind;
  size: number;
  /** RFC 3339 timestamp. */
  mtime: string;
}

export interface Listing {
  root: string;
  path: string;
  truncated: boolean;
  entries: ListEntry[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface FileContent {
  text: string;
  contentType: string;
  etag: string;
}

/** A non-fatal problem in a preferences or project file (also produced by the client registry). */
export interface Warning {
  code: string;
  message: string;
  /** Dotted path such as `settings.fontSize`. */
  key?: string;
  ref?: string;
  line?: number;
}

export interface PrefsError {
  code: string;
  message: string;
  line?: number;
}

/** `GET /api/prefs` always answers 200. `settings` is sparse; the client sanitizes it before use. */
export interface PrefsResponse {
  configured: boolean;
  settings: Record<string, unknown>;
  warnings: Warning[];
  error: PrefsError | null;
}

export interface ProjectEntry {
  root: string;
  path: string;
  type: EntryType;
  kind: EntryKind;
  /** The reference text as written in the project file. */
  ref: string;
  line: number;
}

/** `GET /api/project`. `settings` is sparse; the client sanitizes it before use. */
export interface ProjectResponse {
  root: string;
  path: string;
  name: string | null;
  open: { root: string; path: string; kind: EntryKind } | null;
  entries: ProjectEntry[];
  settings: Record<string, unknown>;
  warnings: Warning[];
}
