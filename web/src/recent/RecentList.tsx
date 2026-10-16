import { useEffect, useId } from 'react';
import { Link } from 'react-router';
import { browseHref, viewHref } from '../api/client';
import { KindIcon } from '../browse/KindIcon';
import { fileKind } from '../fileview/logic';
import { recordRecent, useRecent, type RecentItem } from './recent';

/** Records `item` once it is known to exist (`item` undefined = not yet, or not found). */
export function useRecordRecent(item: RecentItem | undefined): void {
  const root = item?.root;
  const path = item?.path;
  const type = item?.type;
  const ws = item?.ws;
  useEffect(() => {
    if (root !== undefined && path !== undefined && type !== undefined) {
      recordRecent(ws === undefined ? { root, path, type } : { root, path, type, ws });
    }
  }, [root, path, type, ws]);
}

function label(item: RecentItem): string {
  return item.path === '' ? item.root : (item.path.split('/').pop() ?? item.path);
}

function where(item: RecentItem): string {
  const slash = item.path.lastIndexOf('/');
  return slash < 0 ? item.root : `${item.root}/${item.path.slice(0, slash)}`;
}

/** Recently opened files and folders (FR-2.6); renders nothing while the list is empty. */
export function RecentList({ heading: Heading = 'h2' }: { heading?: 'h2' | 'h3' }) {
  const [items, clear] = useRecent();
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className="recent" aria-labelledby={headingId}>
      <div className="recent-head">
        <Heading id={headingId}>Recent</Heading>
        <button type="button" className="btn" aria-label="Clear recent" onClick={clear}>
          Clear
        </button>
      </div>
      <ul className="link-list recent-list" aria-label="Recent">
        {items.map((r) => (
          <li key={`${r.type}:${r.root}/${r.path}`}>
            <Link
              to={
                r.type === 'dir'
                  ? browseHref(r.root, r.path, { ws: r.ws })
                  : viewHref(r.root, r.path, { ws: r.ws })
              }
              title={`${r.root}/${r.path}`}
            >
              <KindIcon kind={r.type === 'dir' ? 'dir' : fileKind(r.path)} />
              <span className="recent-name">{label(r)}</span>
              <span className="recent-where muted">{where(r)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
