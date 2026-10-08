// ENV PREVIEW (temporary): area D, the horizon and the far ground
// (three/scene/horizon.tsx). `off` everywhere is main's look.
import { defineEnvFeature } from '../registry';

/** The plain's end: main's square edge, or an endless plain fading into the night. */
export const horizonEdgeFix = defineEnvFeature({
  id: 'horizonEdgeFix',
  label: 'Endless plain',
  group: 'Horizon',
  order: 0,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/** Two ranges of far hills; `chess` hides pieces in their skyline. */
export const hills = defineEnvFeature({
  id: 'hills',
  label: 'Far hills',
  group: 'Horizon',
  order: 1,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'plain', label: 'Plain' },
    { id: 'chess', label: 'Chess skyline' },
  ],
  default: 'chess',
});

/** A far rook-shaped tower with one lit window (dark after a mate). */
export const farTower = defineEnvFeature({
  id: 'farTower',
  label: 'Far tower',
  group: 'Horizon',
  order: 2,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/** Banks of mist lying on the far plain, between the board and the hills. */
export const horizonMist = defineEnvFeature({
  id: 'horizonMist',
  label: 'Far mist',
  group: 'Horizon',
  order: 3,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/** Tiny far lights at the hills' feet, one of them another tower's five levels. */
export const horizonLights = defineEnvFeature({
  id: 'horizonLights',
  label: 'Far lights',
  group: 'Horizon',
  order: 4,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/**
 * A rare event at the horizon: a lighthouse's beam sweeping once through
 * the haze. `often` brings one every few seconds of a low view, to review.
 */
export const horizonEvents = defineEnvFeature({
  id: 'horizonEvents',
  label: 'Lighthouse',
  group: 'Events',
  order: 5,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
    { id: 'often', label: 'Often' },
  ],
  default: 'on',
});
