import { useState } from 'react';
import { readTocOpen, writeTocOpen, type TocEntry } from './toc';

/** Collapsible "Contents" panel; indentation is relative to the shallowest heading level. */
export default function Toc({ entries }: { entries: TocEntry[] }) {
  const [open, setOpen] = useState(readTocOpen);
  const base = Math.min(...entries.map((e) => e.level));
  return (
    <details
      className="toc"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        writeTocOpen(next);
      }}
    >
      <summary>Contents</summary>
      <nav aria-label="Table of contents">
        <ul>
          {entries.map((e, i) => (
            <li key={`${i}-${e.id}`} style={{ paddingLeft: `${e.level - base}em` }}>
              <a href={`#${encodeURIComponent(e.id)}`}>{e.text}</a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
