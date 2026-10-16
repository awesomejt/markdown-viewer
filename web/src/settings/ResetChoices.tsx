import { useProject } from '../project/context';
import { useSettings } from './useSettings';

/** Clears this device's choices of the current scope: the open project's, else the global ones. */
export function ResetChoices() {
  const { resetChoices } = useSettings();
  const { ref } = useProject();
  return (
    <div className="sidebar-foot">
      <button type="button" className="btn" onClick={resetChoices}>
        Reset this device&apos;s choices
      </button>
      <p className="muted">
        {ref
          ? 'Theme, Markdown-only, hidden files and sort for this project.'
          : 'Theme, Markdown-only, hidden files and sort. Text size is kept.'}
      </p>
    </div>
  );
}
