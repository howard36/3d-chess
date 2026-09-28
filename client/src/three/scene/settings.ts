import type { SettingSpec } from '../settings';
import { ENV_SETTINGS } from './settings-env';
import { MARKER_SETTINGS } from './settings-markers';
import { PIECE_SETTINGS } from './settings-pieces';

// How the game is played rather than how it looks: Keyboard play shows the
// move card (the moves so far, the cell under the pointer and a field to type
// a move). Off, the card stays out of sight, but Tab still reaches its field.
const PLAY_SETTINGS: SettingSpec[] = [
  {
    kind: 'toggle',
    key: 'play.keyboard',
    label: 'Keyboard play',
    group: 'Play',
    default: false,
    hint: 'Type moves (Bb1-Cb1) and see the moves so far. Tab reaches the move field either way.',
  },
];

// The settings panel lists groups in the order they first appear: play,
// then board and world, then the pieces and how they are held, then the
// marks on the board, and check (with the mate) last
const GROUP_ORDER = ['Play', 'Board', 'World', 'Pieces', 'Selection', 'Markers', 'Check'];
const rank = (group: string) => {
  const i = GROUP_ORDER.indexOf(group);
  return i < 0 ? GROUP_ORDER.length : i;
};

let ordered: SettingSpec[] | null = null;

/**
 * Every setting the player may adjust, with its default, in the settings
 * panel's order. Built on first use: the settings store and the modules
 * that declare the settings import each other.
 */
export const settingSpecs = (): SettingSpec[] =>
  (ordered ??= [...PLAY_SETTINGS, ...ENV_SETTINGS, ...PIECE_SETTINGS, ...MARKER_SETTINGS]
    .map((spec, i) => ({ spec, i }))
    .sort((a, b) => rank(a.spec.group) - rank(b.spec.group) || a.i - b.i)
    .map(({ spec }) => spec));
