import type { GridProps } from '../types';
import { focusLevelOf } from './focus';
import { LEVEL_COLORS, PALETTE } from './palette';
import { Levels } from './plates';
import { SmartLabels } from './smartLabels';

/**
 * The levels and their coordinates. Decorative only: Board draws this
 * outside the clickable group. The level the player points at (or has a
 * piece picked up on) brightens its lines, edge and letter.
 */
export const Grid = ({ layout, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Levels focusLevel={focusLevel} />
      <SmartLabels
        layout={layout}
        orientation={orientation}
        // Manrope's double-storey "a" never reads as "o"; its "1" has a flag
        font='"Manrope", system-ui, sans-serif'
        weight={600}
        levelWeight={700}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(2, 3, 7, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(200, 215, 255, 0.25)"
        size={0.32}
        // The level letters keep their colours at the files' and ranks' size;
        // the level in play stands out by the others dimming, not by growing
        levelScale={1}
        opacity={0.9}
        focusLevel={focusLevel}
        focusScale={1}
        focusDim={0.55}
        // Files and ranks are hidden by a piece in front of them, as anything
        // behind a piece is; the glass writes no depth, so it never hides one.
        // The level letters stand at the corner behind the tower, where from
        // low down a piece is often in front of one: they show over it.
        depthTest
        levelDepthTest={false}
      />
    </>
  );
};
