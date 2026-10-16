import { useState } from 'react';
import { Link } from 'react-router';
import { browseHref, viewHref, type NavScope } from '../api/client';
import type { EntryKind } from '../api/types';
import { useList } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import { KindIcon } from '../browse/KindIcon';
import { isWithin, joinPath, kindOf } from '../browse/logic';
import { useMdOnly } from '../browse/mdOnly';
import { useShowHidden } from '../browse/showHidden';
import { useLiveSubscription } from '../live/LiveProvider';
import { treeEntries } from './logic';
import './tree.css';

/** A folder shows this many children at first, then this many more per "Show more" (NFR-3). */
export const TREE_PAGE = 200;

/** What every row of one tree shares: the root, the link scope, the current item and folder state. */
export interface TreeCtx {
  root: string;
  /** Carried by every link in the tree (`ws` for a workspace, the project for a project tree). */
  scope: NavScope;
  /** Current path within the root, and whether it is a folder (browse route). */
  path: string;
  isFolder: boolean;
  isOpen: (p: string) => boolean;
  toggle: (p: string) => void;
}

/** Explicit user toggles win over the automatic expansion (`auto`) of the current path. */
export function useTreeOpenState(auto: Set<string>): Pick<TreeCtx, 'isOpen' | 'toggle'> {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (p: string) => toggled[p] ?? auto.has(p);
  const toggle = (p: string) => setToggled((t) => ({ ...t, [p]: !isOpen(p) }));
  return { isOpen, toggle };
}

interface RowProps {
  ctx: TreeCtx;
  /** Path within the root. */
  path: string;
  label: string;
  isDir: boolean;
  kind: EntryKind | 'dir';
  title?: string;
}

/** One tree row: a disclosure toggle for a folder (its children load when open), a link. */
export function TreeRow({ ctx, path, label, isDir, kind, title }: RowProps) {
  const current = path === ctx.path && isDir === ctx.isFolder;
  const open = isDir && ctx.isOpen(path);
  return (
    <li>
      <div className="tree-row">
        {isDir ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => ctx.toggle(path)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-toggle" aria-hidden="true" />
        )}
        <Link
          className="tree-link"
          aria-current={current ? 'page' : undefined}
          title={title}
          to={isDir ? browseHref(ctx.root, path, ctx.scope) : viewHref(ctx.root, path, ctx.scope)}
        >
          <KindIcon kind={kind} />
          {label}
        </Link>
      </div>
      {open && <TreeChildren dir={path} ctx={ctx} />}
    </li>
  );
}

/**
 * The children of folder `dir`: listed when it is shown, filtered by the show-hidden and
 * Markdown-only settings, and watched while shown.
 */
export function TreeChildren({ dir, ctx }: { dir: string; ctx: TreeCtx }) {
  const list = useList(ctx.root, dir);
  const [showHidden] = useShowHidden();
  const [mdOnly] = useMdOnly();
  // Child adds/removes/renames refresh this listing (FR-5.2). Low priority: a deep tree must not push
  // the viewed document or browsed folder out of the per-stream sub cap.
  useLiveSubscription(ctx.root, dir, true);
  const [limit, setLimit] = useState(TREE_PAGE);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  // The viewed file's row stays even when the filters would hide it.
  const viewed =
    !ctx.isFolder && ctx.path !== dir && isWithin(ctx.path, dir)
      ? ctx.path.slice(dir === '' ? 0 : dir.length + 1)
      : undefined;
  const entries = treeEntries(list.data.entries, showHidden, mdOnly, viewed);
  if (entries.length === 0) return <p className="muted tree-empty">Empty folder</p>;
  // Never hide the current item or the folder leading to it.
  const current = entries.findIndex((e) => isWithin(ctx.path, joinPath(dir, e.name)));
  const shown = entries.slice(0, Math.max(limit, current + 1));
  const rest = entries.length - shown.length;
  return (
    <ul className="tree-list">
      {shown.map((e) => (
        <TreeRow
          key={e.name}
          ctx={ctx}
          path={joinPath(dir, e.name)}
          label={e.name}
          isDir={e.type === 'dir'}
          kind={kindOf(e)}
        />
      ))}
      {rest > 0 && (
        <li>
          <button
            type="button"
            className="btn tree-more"
            onClick={() => setLimit(shown.length + TREE_PAGE)}
          >
            Show more ({rest} left)
          </button>
        </li>
      )}
    </ul>
  );
}
