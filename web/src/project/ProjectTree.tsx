import type { ProjectEntry } from '../api/types';
import { kindOf } from '../browse/logic';
import { TreeRow, useTreeOpenState, type TreeCtx } from '../workspace/TreeRows';
import { projectExpanded } from './logic';
import { useProject } from './context';

interface Props {
  entries: readonly ProjectEntry[];
  /** Current path within the project's root, and whether it is a folder (browse route). */
  path: string;
  isFolder: boolean;
}

/**
 * The project's entries as a tree: files are links, folders are disclosure rows (open when they
 * contain the current path) whose contents share the workspace tree's rows, listing, paging,
 * filters and low-priority watches. The entries themselves always show, whatever the filters.
 */
export function ProjectTree({ entries, path, isFolder }: Props) {
  const { ref } = useProject();
  const open = useTreeOpenState(projectExpanded(path, isFolder, entries));
  if (!ref) return null;
  const ctx: TreeCtx = { root: ref.root, scope: { project: ref }, path, isFolder, ...open };
  return (
    <ul className="tree-list project-tree" aria-label="Project tree">
      {entries.map((e, i) => (
        <TreeRow
          key={`${i}:${e.path}`}
          ctx={ctx}
          path={e.path}
          label={e.path === '' ? e.root : e.path}
          isDir={e.type === 'dir'}
          kind={kindOf(e)}
          title={e.ref}
        />
      ))}
    </ul>
  );
}
