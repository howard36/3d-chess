import type { DesignEntry } from './types';

/**
 * Every design the picker offers, in the order it lists them. The classic
 * design is bundled with the app; each other design is a separate chunk.
 */
export const DESIGNS: DesignEntry[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The original glacier-gray wireframe lattice.',
    swatch: ['#c2cbd8', '#f2ead8', '#413b35', '#14b8a6'],
    load: () => import('./classic'),
  },
  {
    id: 'royal',
    name: 'Royal Marble',
    blurb: 'Marble and onyx on five glass boards framed in gold, in a candlelit salon.',
    swatch: ['#1c1416', '#efe6d6', '#1d1b1c', '#d9ae55'],
    load: () => import('./royal'),
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    blurb: 'Neon wireframes over an endless retro grid at sunset.',
    swatch: ['#120021', '#27e3ff', '#ff2bd6', '#ffb400'],
    load: () => import('./synthwave'),
  },
  {
    id: 'crystal',
    name: 'Crystal Garden',
    blurb: 'Clear crystal against amethyst on frosted glass, in pastel light.',
    swatch: ['#f3e8ff', '#ffffff', '#8b5cf6', '#f472b6'],
    load: () => import('./crystal'),
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    blurb: 'A constellation board adrift in a nebula; suns against dark stars.',
    swatch: ['#050716', '#ffd27a', '#6d5dfc', '#7dd3fc'],
    load: () => import('./cosmos'),
  },
  {
    id: 'toybox',
    name: 'Toy Box',
    blurb: 'Chunky painted-wood toys on stacked candy-coloured trays.',
    swatch: ['#8fd3ff', '#fff4dc', '#2b3a67', '#ff6b6b'],
    load: () => import('./toybox'),
  },
  {
    id: 'hologram',
    name: 'Hologram',
    blurb: 'A war-room projection: flickering holo pieces over a projector table.',
    swatch: ['#020b14', '#3cf2ff', '#ff9a3c', '#9dfcff'],
    load: () => import('./hologram'),
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    blurb: 'Primary colours and pure geometry on paper-white.',
    swatch: ['#f2ecdf', '#e63b2e', '#1f4bd8', '#f6c62a'],
    load: () => import('./bauhaus'),
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Pieces drawn as technical line art on drafting blue.',
    swatch: ['#0b3d91', '#ffffff', '#9cc7ff', '#ffe066'],
    load: () => import('./blueprint'),
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Chunky voxels, pixel rendering and a CRT glow.',
    swatch: ['#1a0b2e', '#ffe9a8', '#b04cff', '#39ff88'],
    load: () => import('./arcade'),
  },
  {
    id: 'elemental',
    name: 'Ice & Fire',
    blurb: 'Carved ice against molten obsidian, with snow and embers.',
    swatch: ['#0d0f1a', '#bfe9ff', '#ff5a1f', '#7ad7ff'],
    load: () => import('./elemental'),
  },
  {
    id: 'zen',
    name: 'Zen Garden',
    blurb: 'River stones on pale maple trays, drifting blossoms.',
    swatch: ['#e9e4d8', '#f4f1ea', '#3b3a38', '#c44536'],
    load: () => import('./zen'),
  },
];
