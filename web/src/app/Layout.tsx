import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { browseHref } from '../api/client';
import { useRoots } from '../api/hooks';
import { ErrorState, Loading } from './states';
import { useTheme } from './theme';

const THEME_LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' } as const;

function SidebarContent() {
  const roots = useRoots();
  if (roots.isPending) return <Loading />;
  if (roots.isError) return <ErrorState error={roots.error} onRetry={() => void roots.refetch()} />;
  return (
    <ul className="link-list">
      {roots.data.roots.map((r) => (
        <li key={r.name}>
          {r.available ? (
            <Link to={browseHref(r.name, '')}>{r.name}</Link>
          ) : (
            <span className="unavailable">
              {r.name} <span className="muted">(unavailable)</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Layout() {
  const { mode, cycle } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [lastKey, setLastKey] = useState(location.key);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Close the drawer on navigation.
  if (lastKey !== location.key) {
    setLastKey(location.key);
    setOpen(false);
  }

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      menuRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="shell">
      <header className="header">
        <button
          ref={menuRef}
          type="button"
          className="btn menu-btn"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(true)}
        >
          ☰
        </button>
        <Link to="/" className="app-title">
          Markdown Viewer
        </Link>
        <button
          type="button"
          className="btn theme-btn"
          onClick={cycle}
          aria-label={`Theme: ${THEME_LABEL[mode]}. Change theme`}
        >
          {THEME_LABEL[mode]}
        </button>
      </header>
      <div className="body">
        <div
          className={`backdrop${open ? ' is-open' : ''}`}
          data-testid="backdrop"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
        <nav id="sidebar" className={`sidebar${open ? ' is-open' : ''}`} aria-label="Sidebar">
          <div className="sidebar-head">
            <h2>Roots</h2>
            <button
              ref={closeRef}
              type="button"
              className="btn close-btn"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <SidebarContent />
        </nav>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
