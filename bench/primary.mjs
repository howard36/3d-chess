// The primary rows: one number for each moment a player waits on (CLAUDE.md
// "Performance"), each measured from the player's own action (a click, a
// navigation, the opponent's send) to what the player sees, never from a
// point in between, which a change can move without the player noticing.
// Everything else the suite measures is a diagnostic: it says where the time
// goes, not whether the player waits less.
//
// bench/run.mjs leads its report and its A/B comparison with these rows,
// and `--primary` runs only what they need. A row is named by its tier, its
// section (or client bench group) and its metric key exactly as the tiers
// write them: a row renamed there shows here as "not measured", never as a
// near match.

/** @typedef {{ moment: string, tier: 'client' | 'browser', where: string, what: string }} PrimaryRow */

/** @type {PrimaryRow[]} */
export const PRIMARY = [
  {
    moment: 'Start page usable, desktop',
    tier: 'browser',
    where: 'Cold load of the start screen',
    what: 'desktop · create button enabled',
  },
  {
    moment: 'Start page usable, phone (4× CPU, Fast 4G)',
    tier: 'browser',
    where: 'Cold load of the start screen',
    what: 'phone, 4× CPU, Fast 4G · create button enabled',
  },
  {
    moment: 'Start page answers its first click, desktop',
    tier: 'browser',
    where: 'Cold load of the start screen',
    what: 'desktop · click at ready → side choice shown',
  },
  {
    moment: 'A shared game’s page, first screen',
    tier: 'browser',
    where: 'Game setup',
    what: 'join: navigation → Join button',
  },
  {
    moment: 'First board frame, joining a game',
    tier: 'browser',
    where: 'Game setup',
    what: 'join: click → joiner’s first frame',
  },
  {
    moment: 'First board frame, playing the computer',
    tier: 'browser',
    where: 'Playing the computer',
    what: 'way in: Hard click → first frame',
  },
  {
    moment: 'Reopening a long game (2,000 plies)',
    tier: 'browser',
    where: 'Reopening a long game',
    what: 'navigation → record shown (announcer = H) · H = 2000',
  },
  {
    moment: 'A move landing, the player’s',
    tier: 'browser',
    where: 'Move latency',
    what: 'click → mover’s first frame with the move',
  },
  {
    moment: 'A move landing, the opponent’s',
    tier: 'browser',
    where: 'Move latency',
    what: 'opponent’s move: sent → first frame with it',
  },
  {
    moment: 'Selecting a piece',
    tier: 'browser',
    where: 'Selecting a piece',
    what: 'click → first frame with the piece held',
  },
  {
    moment: 'The computer’s strength in its time (search speed)',
    tier: 'client',
    where: 'A1 · The computer thinks (hard level, fixed nodes)',
    what: 'middlegame',
  },
];

/** The browser sections and client bench files the primary rows come from (for `--primary`). */
export const PRIMARY_BROWSER_SECTIONS = [
  'cold-load',
  'setup',
  'move-latency',
  'computer',
  'reopen',
  'select',
];
export const PRIMARY_CLIENT_FILES = ['ai'];

/** The key bench/run.mjs's flatten() gives a measured number. */
export const keyOf = ({ tier, where, what }) => `${tier}\u0000${where}\u0000${what}`;
