import { useProject } from './context';
import { useProjectWarnings } from '../settings/project';

/**
 * The project's warnings (server and client): open when there are any, with a count badge and a
 * "Re-check" button that refetches the project (paths it references may have changed on disk).
 */
export function ProjectWarnings() {
  const { query } = useProject();
  const warnings = useProjectWarnings();
  return (
    <details className="project-warnings" open={warnings.length > 0}>
      <summary>
        Warnings{' '}
        <span className="badge" aria-label={`${warnings.length} warnings`}>
          {warnings.length}
        </span>
      </summary>
      {warnings.length > 0 && (
        <ul className="project-warning-list" aria-label="Project warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.message}
              {(w.ref ?? w.key) !== undefined && (
                <>
                  {' '}
                  <code>{w.ref ?? w.key}</code>
                </>
              )}
              {w.line !== undefined && <span className="muted"> line {w.line}</span>}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn"
        disabled={query?.isFetching}
        onClick={() => void query?.refetch()}
      >
        Re-check
      </button>
    </details>
  );
}
