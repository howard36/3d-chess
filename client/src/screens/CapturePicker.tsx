import {
  CAPTURE_STYLE_LABELS,
  CAPTURE_STYLES,
  replayLastMove,
  setCaptureStyle,
  useCaptureStyle,
} from '../lib/captureStyle';
import type { CaptureStyle } from '../lib/captureStyle';

/**
 * How captures play, chosen at the bottom right of the board, and a button
 * that plays the last move again, so the styles can be compared on one
 * capture. Choosing a style plays the last move in it.
 */
const CapturePicker = ({ canReplay }: { canReplay: boolean }) => {
  const { style } = useCaptureStyle();
  return (
    <div className="hud-capture hud-glass" data-testid="capture-picker">
      <label htmlFor="capture-style">Capture</label>
      <select
        id="capture-style"
        value={style}
        onChange={(e) => {
          setCaptureStyle(e.target.value as CaptureStyle);
          if (canReplay) replayLastMove();
        }}
      >
        {CAPTURE_STYLES.map((s) => (
          <option key={s} value={s}>
            {CAPTURE_STYLE_LABELS[s]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="hud-replay"
        aria-label="Replay the last move"
        title="Replay"
        disabled={!canReplay}
        onClick={replayLastMove}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path
            d="M3.5 8a4.5 4.5 0 1 0 1.4-3.26M3.5 2.5v2.6h2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
};

export default CapturePicker;
