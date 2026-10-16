import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from './device';
import {
  decreaseTextScale,
  increaseTextScale,
  resetTextScale,
  useTextScalePercent,
} from './useTextScale';

/** Header group: smaller, percent (click resets to 100 %), larger. */
export function TextScaleControls() {
  const percent = useTextScalePercent();
  return (
    <div className="text-scale" role="group" aria-label="Text size">
      <button
        type="button"
        className="btn"
        aria-label="Smaller text"
        disabled={percent <= TEXT_SCALE_MIN}
        onClick={decreaseTextScale}
      >
        A−
      </button>
      <button
        type="button"
        className="btn text-scale-reset"
        aria-label={`Reset text size (${percent}%)`}
        onClick={resetTextScale}
      >
        {percent}%
      </button>
      <button
        type="button"
        className="btn"
        aria-label="Larger text"
        disabled={percent >= TEXT_SCALE_MAX}
        onClick={increaseTextScale}
      >
        A+
      </button>
    </div>
  );
}
