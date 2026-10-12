import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import type { ListEntry } from '../api/types';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { browseHref, viewHref } from '../api/client';
import { useList } from '../api/hooks';
import { ErrorState, Loading } from '../app/states';
import { useLiveSubscription } from '../live/LiveProvider';
import { useRecordRecent } from '../recent/RecentList';
import { Breadcrumbs } from './Breadcrumbs';
import { KindIcon } from './KindIcon';
import { useShowHidden } from './showHidden';
import {
  filterEntries,
  formatMtime,
  formatSize,
  joinPath,
  kindOf,
  loadMdOnly,
  loadSort,
  saveMdOnly,
  saveSort,
  scopeWs,
  sortEntries,
  type SortKey,
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
  useLiveSubscription(root, path);
  // Roots are always listed already; only folders inside them are worth remembering.
  useRecordRecent(list.data && path !== '' ? { root, path, type: 'dir', ws } : undefined);
  const [query, setQuery] = useState('');
  const [mdOnly, setMdOnly] = useState(loadMdOnly);
  const [showHidden, setShowHidden] = useShowHidden();
  const [sort, setSort] = useState<SortKey>(loadSort);

  const entries = list.data
    ? sortEntries(filterEntries(list.data.entries, { query, mdOnly, showHidden }), sort)
    : [];

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
            <label className="toggle">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              Show hidden files
            </label>
            <label className="sort-control">
              Sort by
              <select
                value={sort}
                onChange={(e) => {
                  const next: SortKey = e.target.value === 'date' ? 'date' : 'name';
                  setSort(next);
                  saveSort(next);
                }}
              >
                <option value="name">Name</option>
                <option value="date">Date (newest first)</option>
              </select>
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
            <EntryList root={root} path={path} ws={ws} entries={entries} />
          )}
        </>
      )}
    </section>
  );
}

/** Folders with at least this many shown entries render only the rows near the viewport (NFR-3). */
const VIRTUAL_MIN = 200;

interface ListProps {
  root: string;
  path: string;
  ws?: string;
  entries: readonly ListEntry[];
}

function EntryList(props: ListProps) {
  if (props.entries.length >= VIRTUAL_MIN) return <VirtualEntryList {...props} />;
  return (
    <ul className="entries" aria-label="Entries">
      {props.entries.map((e) => (
        <EntryRow key={e.name} entry={e} {...props} />
      ))}
    </ul>
  );
}

/** Window-scrolled virtual list: rows are measured, so wrapped names and phone layouts fit. */
function VirtualEntryList(props: ListProps) {
  const { entries } = props;
  const listRef = useRef<HTMLUListElement>(null);
  // The list's offset in the page; the toolbar above it can wrap, so re-check after every render.
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const top = listRef.current
      ? Math.round(listRef.current.getBoundingClientRect().top + window.scrollY)
      : 0;
    if (top !== margin) setMargin(top);
  });
  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: () => 45,
    overscan: 10,
    scrollMargin: margin,
    getItemKey: (i) => entries[i]!.name,
  });
  return (
    <ul
      ref={listRef}
      className="entries is-virtual"
      aria-label="Entries"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <EntryRow
          key={item.key}
          entry={entries[item.index]!}
          {...props}
          rowRef={virtualizer.measureElement}
          index={item.index}
          style={{ transform: `translateY(${item.start - margin}px)` }}
        />
      ))}
    </ul>
  );
}

interface RowProps extends ListProps {
  entry: ListEntry;
  /** Set for virtual rows: position in the full list and the measuring ref. */
  index?: number;
  rowRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
}

function EntryRow({ root, path, ws, entries, entry: e, index, rowRef, style }: RowProps) {
  const child = joinPath(path, e.name);
  const kind = kindOf(e);
  return (
    <li
      ref={rowRef}
      data-index={index}
      aria-setsize={index === undefined ? undefined : entries.length}
      aria-posinset={index === undefined ? undefined : index + 1}
      style={style}
      className={`entry${kind === 'markdown' ? ' is-markdown' : ''}`}
    >
      <KindIcon kind={kind} />
      <Link
        className="entry-name"
        to={
          e.type === 'dir'
            ? browseHref(root, child, scopeWs(child, ws))
            : viewHref(root, child, scopeWs(child, ws))
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
}
