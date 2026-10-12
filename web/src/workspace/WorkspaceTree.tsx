import { useState } from 'react';
import { Link } from 'react-router';
import { browseHref, viewHref } from '../api/client';
import { useList } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import { KindIcon } from '../browse/KindIcon';
import { joinPath, kindOf } from '../browse/logic';
import { expandedFor, treeEntries } from './logic';
import './tree.css';

interface TreeProps {
  root: string;
  ws: string;
  /** Current path within the root, and whether it is a folder (browse route). */
  path: string;
  isFolder: boolean;
}

/** Lazy-loading tree of the workspace folder; a folder's listing is fetched when it is expanded. */
export function WorkspaceTree({ root, ws, path, isFolder }: TreeProps) {
  // Explicit user toggles win over the auto-expansion of the current path's ancestors.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const auto = expandedFor(path, ws, isFolder);
  const isOpen = (p: string) => toggled[p] ?? auto.has(p);
  const toggle = (p: string) => setToggled((t) => ({ ...t, [p]: !isOpen(p) }));
  const ctx = { root, ws, path, isFolder, isOpen, toggle };
  return (
    <div className="tree">
      <Link
        className="tree-root"
        aria-current={isFolder && path === ws ? 'page' : undefined}
        to={browseHref(root, ws, ws)}
      >
        {ws === '' ? root : ws}
      </Link>
      <TreeChildren dir={ws} {...ctx} />
    </div>
  );
}

interface Ctx extends TreeProps {
  isOpen: (p: string) => boolean;
  toggle: (p: string) => void;
}

function TreeChildren({ dir, ...ctx }: Ctx & { dir: string }) {
  const list = useList(ctx.root, dir);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const entries = treeEntries(list.data.entries);
  if (entries.length === 0) return <p className="muted tree-empty">Empty folder</p>;
  return (
    <ul className="tree-list">
      {entries.map((e) => {
        const child = joinPath(dir, e.name);
        const current = child === ctx.path && (e.type === 'dir') === ctx.isFolder;
        const kind = kindOf(e);
        const open = e.type === 'dir' && ctx.isOpen(child);
        return (
          <li key={e.name}>
            <div className="tree-row">
              {e.type === 'dir' ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${e.name}`}
                  onClick={() => ctx.toggle(child)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-toggle" aria-hidden="true" />
              )}
              <Link
                className="tree-link"
                aria-current={current ? 'page' : undefined}
                to={
                  e.type === 'dir'
                    ? browseHref(ctx.root, child, ctx.ws)
                    : viewHref(ctx.root, child, ctx.ws)
                }
              >
                <KindIcon kind={kind} />
                {e.name}
              </Link>
            </div>
            {open && <TreeChildren dir={child} {...ctx} />}
          </li>
        );
      })}
    </ul>
  );
}
