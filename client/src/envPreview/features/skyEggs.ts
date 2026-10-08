// ENV PREVIEW (temporary): asterisms with no lines, for whoever looks
// closely: five stars climbing in the five level colours, and the eight
// queens on a faint lattice of dots.
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
