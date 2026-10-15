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
