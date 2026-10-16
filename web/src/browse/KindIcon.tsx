import type { EntryKind } from '../api/types';

const PATHS: Record<EntryKind | 'dir', string> = {
  dir: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  markdown: 'M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 9h3',
  diagram: 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v4h10v2M17 15',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  text: 'M6 3h9l4 4v14H6zM9 12h6M9 16h4',
  project: 'M3 7h18v12H3zM8 7V5h8v2M3 12h18M11 12v2h2v-2',
  other: 'M6 3h9l4 4v14H6zM15 3v4h4',
};

/** Decorative per-kind icon; the entry name carries the meaning. */
export function KindIcon({ kind }: { kind: EntryKind | 'dir' }) {
  return (
    <svg
      className={`kind-icon kind-${kind}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}
