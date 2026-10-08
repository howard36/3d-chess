// ENV PREVIEW (temporary): area C, the court, the near ground between the
// tower and the colossal board (three/scene/court.tsx). Each `off` is
// today's look; together they are the court as main draws it (nothing).
import { defineEnvFeature } from '../registry';

/** The polished stone itself: paving slabs shown only by their sheen, and veins. */
export const courtFloor = defineEnvFeature({
  id: 'courtFloor',
  label: 'Court stone',
  group: 'Garden',
  order: 30,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'sheen', label: 'Sheen' },
    { id: 'veined', label: 'Veined' },
  ],
  default: 'sheen',
});

/** A light inlay round the tower: its spokes point the eight ways a knight jumps. */
export const courtInlay = defineEnvFeature({
  id: 'courtInlay',
  label: 'Court inlay',
  group: 'Garden',
  order: 31,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'ring', label: 'Knight ring' },
    { id: 'double', label: 'Two rings' },
    { id: 'star', label: 'Knight star' },
  ],
  default: 'double',
});

/** Glow-moss in the slabs' joints: still points of cool light, in clusters. */
export const courtLife = defineEnvFeature({
  id: 'courtLife',
  label: 'Court moss',
  group: 'Garden',
  order: 32,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/** Hidden things: stepping stones laid in knight's jumps, out between the knights. */
export const courtEggs = defineEnvFeature({
  id: 'courtEggs',
  label: 'Court secrets',
  group: 'Garden',
  order: 33,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});
