import { Link } from 'react-router';
import { browseHref } from '../api/client';
import { expandedFor } from './logic';
import { TreeChildren, useTreeOpenState, type TreeCtx } from './TreeRows';

interface TreeProps {
  root: string;
  ws: string;
  /** Current path within the root, and whether it is a folder (browse route). */
  path: string;
  isFolder: boolean;
}

/**
 * Lazy-loading tree of the workspace folder; a folder's listing is fetched when it is expanded, and
 * every shown folder is watched while it stays expanded.
 */
export function WorkspaceTree({ root, ws, path, isFolder }: TreeProps) {
  const open = useTreeOpenState(expandedFor(path, ws, isFolder));
  const ctx: TreeCtx = { root, scope: { ws }, path, isFolder, ...open };
  return (
    <div className="tree">
      <Link
        className="tree-root"
        aria-current={isFolder && path === ws ? 'page' : undefined}
        to={browseHref(root, ws, { ws })}
      >
        {ws === '' ? root : ws}
      </Link>
      <TreeChildren dir={ws} ctx={ctx} />
    </div>
  );
}
