// The primary rows: one number for each moment a player waits on (CLAUDE.md
// "Performance"), each measured from the player's own action (a click, a
// navigation, the opponent's send) to what the player sees, never from a
// point in between, which a change can move without the player noticing. A
// move or a piece picked up is timed to the picture drawn by the GPU, not to
// the picture handed to it: in software rendering the GPU finishes a picture
// long after render() returns, and a page that hands pictures over sooner
// can show them later.
// Everything else the suite measures is a diagnostic: it says where the time
// goes, not whether the player waits less.
//
// bench/run.mjs leads its report and its A/B comparison with these rows,
// and `--primary` runs only what they need. A row is named by its tier, its
// section (or client bench group) and its metric key exactly as the tiers
// write them: a row renamed there shows here as "not measured", never as a
// near match.

/**
 * A row: the moment, its tier, the browser section (`section`, its key for
 * --only) or client bench file (`file`) that measures it, and the title and
 * metric that name it there.
 * @typedef {{ moment: string, tier: 'client' | 'browser', section?: string, file?: string, where: string, what: string }} PrimaryRow
 */

/** @type {PrimaryRow[]} */
export const PRIMARY = [
  {
    moment: 'Start page usable, desktop',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'desktop · “Play a friend” enabled',
  },
  {
    moment: 'Start page usable, phone (4× CPU, Fast 4G)',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'phone, 4× CPU, Fast 4G · “Play a friend” enabled',
  },
  {
    moment: 'Start page usable, phone, returning (4× CPU, Fast 4G)',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'phone, 4× CPU, Fast 4G, returning · “Play a friend” enabled',
  },
  {
    moment: 'Start page shows the board, phone (4× CPU, Fast 4G)',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'phone, 4× CPU, Fast 4G · board on screen (its picture, or the live preview)',
  },
  {
    moment: 'Start page shows the board, phone, returning (4× CPU, Fast 4G)',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'phone, 4× CPU, Fast 4G, returning · board on screen (its picture, or the live preview)',
  },
  {
    moment: 'Start page shows the board, desktop',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'desktop · board on screen (its picture, or the live preview)',
  },
  {
    moment: 'Start page answers its first click, desktop',
    tier: 'browser',
    section: 'cold-load',
    where: 'Cold load of the start screen',
    what: 'desktop · first click: side choice shown',
  },
  {
    moment: 'A shared game’s page, first screen',
    tier: 'browser',
    section: 'setup',
    where: 'Game setup',
    what: 'Joining: Join button shown',
  },
  {
    moment: 'A shared game’s page, first screen, phone (4× CPU, Fast 4G)',
    tier: 'browser',
    section: 'setup',
    where: 'Game setup',
    what: 'Joining on a phone (4× CPU, Fast 4G): Join button shown',
  },
  {
    moment: 'First board picture, joining a game',
    tier: 'browser',
    section: 'setup',
    where: 'Game setup',
    what: 'Joining: board’s first picture handed to the GPU',
  },
  {
    moment: 'First board picture, playing the computer',
    tier: 'browser',
    section: 'computer',
    where: 'Playing the computer',
    what: 'Way in: board’s first picture handed to the GPU',
  },
  {
    moment: 'Reopening a long game (2,000 plies)',
    tier: 'browser',
    section: 'reopen',
    where: 'Reopening a long game',
    what: 'move record shown · 2000 plies',
  },
  {
    moment: 'A finished game’s review, every mark in',
    tier: 'browser',
    section: 'review',
    where: 'Reviewing a finished game',
    what: '“Review” clicked → every mark in',
  },
  {
    moment: 'The player’s move appears',
    tier: 'browser',
    section: 'move-latency',
    where: 'Move latency',
    what: 'Player’s move: picture drawn by the GPU',
  },
  {
    moment: 'The opponent’s move appears',
    tier: 'browser',
    section: 'move-latency',
    where: 'Move latency',
    what: 'Opponent’s move: picture drawn by the GPU',
  },
  {
    moment: 'A picked-up piece appears',
    tier: 'browser',
    section: 'select',
    where: 'Picking up a piece',
    what: 'Picking up a piece: picture drawn by the GPU',
  },
  {
    moment: 'The computer’s strength in its time (search speed)',
    tier: 'client',
    file: 'ai',
    where: 'A1 · The computer thinks (hard level, fixed nodes)',
    what: 'middlegame',
  },
];

/** The browser sections and client bench files the primary rows come from (for `--primary`). */
const from = (k) => [...new Set(PRIMARY.map((r) => r[k]).filter(Boolean))];
export const PRIMARY_BROWSER_SECTIONS = from('section');
export const PRIMARY_CLIENT_FILES = from('file');

/** The key bench/run.mjs's flatten() gives a measured number. */
export const keyOf = ({ tier, where, what }) => `${tier}\u0000${where}\u0000${what}`;
