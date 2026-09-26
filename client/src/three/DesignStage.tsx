import { useDesign } from './designs/context';
import type { Orientation } from './layout';

/** The current design's surroundings: background, lights, atmosphere, post-processing. */
export const DesignStage = ({ orientation }: { orientation: Orientation }) => {
  const design = useDesign();
  return <design.Stage layout={design.layout} orientation={orientation} />;
};
