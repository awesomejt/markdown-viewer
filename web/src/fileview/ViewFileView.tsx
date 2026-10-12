import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ApiError, fileUrl } from '../api/client';
import { useFile, useList } from '../api/hooks';
import type { EntryKind } from '../api/types';
import { ErrorState, Loading } from '../app/states';
import { useLiveSubscription } from '../live/LiveProvider';
import { useRecordRecent } from '../recent/RecentList';
import { formatSize } from '../browse/logic';
import { CodeFile } from './CodeFile';
import { baseName, fileKind, parentDir } from './logic';
import './fileview.css';

const MarkdownView = lazy(() => import('../markdown/MarkdownView'));
const DiagramPage = lazy(() => import('../diagrams/DiagramPage'));

/** Fetches a text file; on 413 shows a size notice with a "Load anyway" (`force=1`) button (D-21). */
function TextGate({
  root,
  path,
  size,
  children,
}: {
  root: string;
  path: string;
  size?: number;
  children: (text: string) => ReactNode;
}) {
  const [force, setForce] = useState(false);
  const file = useFile(root, path, force);
  if (file.isPending) return <Loading />;
  if (file.isError) {
    if (file.error instanceof ApiError && file.error.code === 'too_large') {
      return (
        <div className="state large-file" role="status">
          <p>
            {size === undefined ? 'File is too large' : `File is ${(size / 1048576).toFixed(1)} MB`}
          </p>
          <button type="button" className="btn" onClick={() => setForce(true)}>
            Load anyway
          </button>
        </div>
      );
    }
    return <ErrorState error={file.error} onRetry={() => void file.refetch()} />;
  }
  return <>{children(file.data.text)}</>;
}

/** `version` comes from the parent listing, which live reload refetches on change (FIX-3). */
function ImageFile({ root, path, version }: { root: string; path: string; version?: string }) {
  const name = baseName(path);
  return (
    <section className="file-view">
      <h1>{name}</h1>
      <img
        className="file-image"
        src={fileUrl(root, path, version)}
        alt={name}
        referrerPolicy="no-referrer"
      />
    </section>
  );
}

function OtherFile({ root, path, size }: { root: string; path: string; size?: number }) {
  const name = baseName(path);
  return (
    <section className="file-view">
      <h1>{name}</h1>
      <p className="muted">No preview is available for this file type.</p>
      <p>
        <a className="btn" href={fileUrl(root, path)} download={name}>
          Download {name}
          {size !== undefined && ` (${formatSize({ type: 'file', size })})`}
        </a>
      </p>
    </section>
  );
}

function ViewByKind({
  kind,
  root,
  path,
  ws,
  size,
  version,
}: {
  kind: EntryKind;
  root: string;
  path: string;
  ws?: string;
  size?: number;
  version?: string;
}) {
  switch (kind) {
    case 'markdown':
      return (
        <TextGate root={root} path={path} size={size}>
          {(text) => (
            <Suspense fallback={<Loading />}>
              <MarkdownView text={text} root={root} docPath={path} ws={ws} />
            </Suspense>
          )}
        </TextGate>
      );
    case 'diagram':
      return (
        <TextGate root={root} path={path} size={size}>
          {(text) => (
            <Suspense fallback={<Loading />}>
              <DiagramPage path={path} source={text} />
            </Suspense>
          )}
        </TextGate>
      );
    case 'image':
      return <ImageFile root={root} path={path} version={version} />;
    case 'text':
      return (
        <TextGate root={root} path={path} size={size}>
          {(text) => (
            <section className="file-view">
              <h1>{baseName(path)}</h1>
              <CodeFile path={path} text={text} />
            </section>
          )}
        </TextGate>
      );
    default:
      return <OtherFile root={root} path={path} size={size} />;
  }
}

/** `/view/:root/*`: the kind comes from the parent folder listing (the server's classification). */
export function ViewFileView() {
  const params = useParams();
  const [search] = useSearchParams();
  const root = params.root ?? '';
  const path = params['*'] ?? '';
  const ws = search.get('ws') ?? undefined;
  const list = useList(root, parentDir(path));
  useLiveSubscription(root, path);
  const entry = list.data?.entries.find((e) => e.type === 'file' && e.name === baseName(path));
  useRecordRecent(entry && { root, path, type: 'file', ws });
  if (list.isPending) return <Loading />;
  return (
    <ViewByKind
      key={`${root}/${path}`}
      kind={entry?.kind ?? fileKind(path)}
      root={root}
      path={path}
      ws={ws}
      size={entry?.size}
      version={entry && `${entry.mtime}-${entry.size}`}
    />
  );
}
