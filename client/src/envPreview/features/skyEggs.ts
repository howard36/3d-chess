// ENV PREVIEW (temporary): asterisms with no lines, for whoever looks
// closely: a 5x5 knight's tour behind White's seat, five stars climbing in the
// five level colours, and the eight queens on a faint drawn board.
import { defineEnvFeature } from '../registry';

export const skyEggs = defineEnvFeature({
  id: 'skyEggs',
  label: 'Hidden asterisms',
  group: 'Constellations',
  order: 2,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});
