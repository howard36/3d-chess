import { levelRamp } from '../kit/colors';

// Gallery's palette. The value structure, darkest to lightest:
//
//   the room (walls, floor, far plinths)   3–12 %: a dim museum after hours
//   the glass platforms                    near-clear, a faint frost
//   basalt army                            dark stone, lit to 20–35 % with a cool rim
//   level inlays (jewel anodised brass)    72 % OKLCH lightness, cool hues
//   gameplay marks (brass, platinum, rope) warm metals and crimson velvet
//   Carrara army                           the brightest thing in the room
//
// Levels are cool jewels (amethyst, sapphire, azure, teal, emerald) so they
// never meet the warm gameplay colours: brass for where a piece may go,
// crimson velvet rope for a capture and for check, platinum wire for the
// last move, warm spotlight white for the selection.

/** A (bottom) to E: amethyst, sapphire, azure, teal, emerald. */
export const LEVELS = levelRamp({ from: 305, to: 155, lightness: 0.72, chroma: 0.135 });

/** Ivory for the file and rank letters, like a wall label printed on card. */
export const LABEL = '#e9e2d3';

/** Legal destinations: polished brass inlay and a pool of warm light. */
export const BRASS = '#e6bd6a';
export const BRASS_DEEP = '#9c7430';
/** Captures and check: crimson velvet museum rope. */
export const ROPE = '#d8344a';
export const ROPE_DEEP = '#7c1022';
/** The last move: a platinum hanging wire. */
export const WIRE = '#dfe3ea';
export const WIRE_GLINT = '#ffffff';
/** The selection's spotlight. */
export const SPOT = '#ffe2a8';

/** The room. */
export const ROOM = {
  background: '#07080a',
  wall: '#1a1a1d',
  wash: '#6b5a43',
  floor: '#141416',
  dais: '#101113',
  plinth: '#0f1012',
  moon: '#8fa6c8',
  exit: '#3fd88a',
};

/** The armies. */
export const MARBLE = { base: '#eee9e0', vein: '#8d939c', warm: '#fff4e2' };
export const BASALT = { base: '#34363b', grain: '#50545b', rim: '#b9cbe6' };
