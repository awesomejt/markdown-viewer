import { useId, useState } from 'react';
import { Link } from 'react-router';
import { viewHref } from '../api/client';
import { useList } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import { KindIcon } from '../browse/KindIcon';
import { filterEntries, joinPath, kindOf, sortEntries } from '../browse/logic';
import { useMdOnly } from '../browse/mdOnly';
import { useShowHidden } from '../browse/showHidden';
import { useProjectParam } from '../project/useNavScope';
import { useLiveSubscription } from '../live/LiveProvider';
import { TREE_PAGE } from '../workspace/TreeRows';
import '../workspace/tree.css';

/**
 * The files next to a file opened outside a workspace (FR-2.8), so siblings are one tap away. Shares
 * the folder listing with browse and the tree, and follows the show-hidden and Markdown-only toggles;
 * the viewed file is never filtered out.
 */
export function FolderFiles({ root, path }: { root: string; path: string }) {
  const slash = path.lastIndexOf('/');
  const dir = slash < 0 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const list = useList(root, dir);
  const [showHidden] = useShowHidden();
  const [mdOnly] = useMdOnly();
  // Same low-priority watch as a tree folder, so added and removed siblings appear (FR-5.2).
  useLiveSubscription(root, dir, true);
  const [limit, setLimit] = useState(TREE_PAGE);
  const headingId = useId();
  // Siblings keep an open project but never a workspace.
  const project = useProjectParam() ?? undefined;

  let body;
  if (list.isPending) body = <Loading />;
  else if (list.isError)
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else {
    const shown = new Set(filterEntries(list.data.entries, { query: '', mdOnly, showHidden }));
    const files = sortEntries(
      list.data.entries.filter((e) => e.type !== 'dir' && (shown.has(e) || e.name === name)),
      'name',
    );
    // Never hide the current file behind "Show more".
    const current = files.findIndex((e) => e.name === name);
    const visible = files.slice(0, Math.max(limit, current + 1));
    const rest = files.length - visible.length;
    body = (
      <ul className="link-list" aria-labelledby={headingId}>
        {visible.map((e) => (
          <li key={e.name}>
            <Link
              aria-current={e.name === name ? 'page' : undefined}
              to={viewHref(root, joinPath(dir, e.name), { project })}
            >
              <KindIcon kind={kindOf(e)} />
              {e.name}
            </Link>
          </li>
        ))}
        {rest > 0 && (
          <li>
            <button
              type="button"
              className="btn tree-more"
              onClick={() => setLimit(visible.length + TREE_PAGE)}
            >
              Show more ({rest} left)
            </button>
          </li>
        )}
      </ul>
    );
  }

  return (
    <section className="folder-files" aria-labelledby={headingId}>
      <h3 id={headingId}>In this folder</h3>
      <p className="muted folder-files-dir">{dir === '' ? root : dir}</p>
      <Link to={viewHref(root, path, { ws: dir })}>Open as workspace</Link>
      {body}
    </section>
  );
}
