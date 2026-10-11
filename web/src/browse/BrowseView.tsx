import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { browseHref, viewHref } from '../api/client';
import { useList } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import { Breadcrumbs } from './Breadcrumbs';
import { KindIcon } from './KindIcon';
import {
  filterEntries,
  formatMtime,
  formatSize,
  joinPath,
  kindOf,
  loadMdOnly,
  saveMdOnly,
  workspaceTarget,
} from './logic';
import './browse.css';

export function BrowseView() {
  const params = useParams();
  const [search] = useSearchParams();
  const root = params.root ?? '';
  const path = params['*'] ?? '';
  const ws = search.get('ws') ?? undefined;
  // Keyed by folder so the filter text resets on navigation.
  return <FolderView key={`${root}/${path}`} root={root} path={path} ws={ws} />;
}

function FolderView({ root, path, ws }: { root: string; path: string; ws?: string }) {
  const navigate = useNavigate();
  const list = useList(root, path);
  const [query, setQuery] = useState('');
  const [mdOnly, setMdOnly] = useState(loadMdOnly);

  const entries = list.data ? filterEntries(list.data.entries, { query, mdOnly }) : [];

  return (
    <section className="browse">
      <Breadcrumbs root={root} path={path} ws={ws} />
      <h1>{path ? path.split('/').pop() : root}</h1>
      {ws !== undefined && (
        <p className="ws-indicator">
          Workspace: <strong>{ws === '' ? `${root} (root)` : ws}</strong>{' '}
          <Link to={browseHref(root, path)}>Exit workspace</Link>
        </p>
      )}
      {list.isPending && <Loading />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <>
          <div className="toolbar">
            <input
              type="search"
              className="filter-input"
              aria-label="Filter by name"
              placeholder="Filter by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={mdOnly}
                onChange={(e) => {
                  setMdOnly(e.target.checked);
                  saveMdOnly(e.target.checked);
                }}
              />
              Markdown/diagrams only
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => void navigate(workspaceTarget(root, path, list.data.entries))}
            >
              Open as workspace
            </button>
          </div>
          {list.data.truncated && (
            <p className="notice" role="status">
              This folder is very large; only the first entries are shown.
            </p>
          )}
          {entries.length === 0 ? (
            <p className="muted">
              {list.data.entries.length === 0
                ? 'This folder is empty.'
                : 'No entries match the current filter.'}
            </p>
          ) : (
            <ul className="entries" aria-label="Entries">
              {entries.map((e) => {
                const child = joinPath(path, e.name);
                const kind = kindOf(e);
                return (
                  <li key={e.name} className={`entry${kind === 'markdown' ? ' is-markdown' : ''}`}>
                    <KindIcon kind={kind} />
                    <Link
                      className="entry-name"
                      to={
                        e.type === 'dir' ? browseHref(root, child, ws) : viewHref(root, child, ws)
                      }
                    >
                      {e.name}
                    </Link>
                    <span className="entry-size">{formatSize(e)}</span>
                    <time className="entry-time" dateTime={e.mtime} title={e.mtime}>
                      {formatMtime(e.mtime)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
