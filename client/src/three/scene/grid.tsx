import type { GridProps } from '../types';
import { focusLevelOf } from './focus';
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
      <SmartLabels layout={layout} orientation={orientation} focusLevel={focusLevel} />
    </>
  );
};
