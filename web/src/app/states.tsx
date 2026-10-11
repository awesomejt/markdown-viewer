import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      {label}
    </div>
  );
}

interface Description {
  title: string;
  hint: string;
  retry: boolean;
}

const DESCRIPTIONS: Record<string, Description> = {
  not_found: { title: 'Not found', hint: 'That file or folder does not exist.', retry: false },
  forbidden: { title: 'Access denied', hint: 'That path is not accessible.', retry: false },
  bad_request: { title: 'Invalid request', hint: 'That path is not valid.', retry: false },
  fs_timeout: {
    title: 'The share is not responding',
    hint: 'The storage behind this folder is slow or offline. Try again in a moment.',
    retry: true,
  },
  too_large: { title: 'File too large', hint: 'This file is too large to display.', retry: false },
  busy: {
    title: 'Server busy',
    hint: 'The server is busy right now. Try again shortly.',
    retry: true,
  },
  internal: { title: 'Something went wrong', hint: 'The server hit an error.', retry: true },
  network: {
    title: 'Cannot reach the server',
    hint: 'Check your connection and try again.',
    retry: true,
  },
};

const FALLBACK: Description = {
  title: 'Something went wrong',
  hint: 'An unexpected error occurred.',
  retry: true,
};

export function describeError(error: unknown): Description {
  if (error instanceof ApiError) return DESCRIPTIONS[error.code] ?? FALLBACK;
  return FALLBACK;
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  /** Extra actions, e.g. F5's "load anyway" for too_large. */
  actions?: ReactNode;
}

export function ErrorState({ error, onRetry, actions }: ErrorStateProps) {
  const d = describeError(error);
  return (
    <div className="state state-error" role="alert">
      <h2>{d.title}</h2>
      <p>{d.hint}</p>
      {error instanceof ApiError && error.message && <p className="muted">{error.message}</p>}
      <div className="state-actions">
        {d.retry && onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}
