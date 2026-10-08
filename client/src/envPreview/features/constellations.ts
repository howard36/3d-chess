// ENV PREVIEW (temporary): the chess constellations. `crafted` draws today's
// eight as a star chart does (lines stopping short of their stars, one
// brighter star each, quieter toward the base); `expanded` adds smaller,
// dimmer figures between them: castling, a knight's fork, a pawn chain and
// a toppled king low over the horizon.
import { defineEnvFeature } from '../registry';

export const constellations = defineEnvFeature({
  id: 'constellations',
  label: 'Constellations',
  group: 'Constellations',
  order: 1,
  options: [
    { id: 'off', label: "Today's eight" },
    { id: 'crafted', label: 'Crafted' },
    { id: 'expanded', label: 'Expanded' },
  ],
  default: 'expanded',
});
