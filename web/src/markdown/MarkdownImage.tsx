import type { ComponentProps } from 'react';
import { fileUrl } from '../api/client';
import { useList } from '../api/hooks';
import { baseName, parentDir } from '../fileview/logic';
import { useLiveSubscription } from '../live/LiveProvider';

type Props = Omit<ComponentProps<'img'>, 'src'> & { root: string; path: string; alt: string };

/**
 * A root-relative image in a Markdown document. Like the image view (FIX-3), its URL carries
 * `v=<mtime>-<size>` from the parent folder listing. The image file itself is watched (a folder
 * watch misses content changes), so a change, or a missing image appearing, refetches the listing
 * and reloads it. Image watches are low priority: past the per-stream cap they are dropped before
 * the document's own. Listings are shared per folder, and the document's own is usually cached.
 *
 * `src` is held back until the listing settles, so the image is not fetched twice. A failed or
 * truncated listing falls back to the unversioned URL.
 */
export default function MarkdownImage({ root, path, alt, ...rest }: Props) {
  const dir = parentDir(path);
  const list = useList(root, dir);
  useLiveSubscription(root, path, true);
  const name = baseName(path);
  const entry = list.data?.entries.find((e) => e.type === 'file' && e.name === name);
  const src = list.isPending
    ? undefined
    : fileUrl(root, path, entry && `${entry.mtime}-${entry.size}`);
  return <img {...rest} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
}
