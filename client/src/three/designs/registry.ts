import classic from './classic';
import type { DesignEntry } from './types';

/**
 * Every design, listed by the picker under its group (in DESIGN_GROUPS
 * order, see groups.ts) and in this order within it; `hidden` ones are only
 * reachable by `?design=<id>`.
 * The classic design is bundled with the app; each other design is a
 * separate chunk.
 */
export const DESIGNS: DesignEntry[] = [
  {
    id: 'atelier',
    name: 'Atelier',
    blurb: 'Porcelain and ink-blue lacquer on frosted acrylic, lit like a studio product shot.',
    swatch: ['#c6c2ba', '#f3eee4', '#1c2a4a', '#ee9a22'],
    load: () => import('./atelier'),
    group: 'clarity',
  },
  {
    id: 'command',
    name: 'Command',
    blurb:
      'A naval tactical hologram: ice and burnished-amber units on teal-to-ice glass over a dark plotting floor.',
    swatch: ['#060e1a', '#e6f0f6', '#d56d1c', '#39d0ff'],
    load: () => import('./command'),
    group: 'clarity',
  },
  {
    id: 'kontur',
    name: 'Kontur',
    blurb: 'A Bauhaus board game: ink-drawn geometric pieces on colour-coded acrylic sheets.',
    swatch: ['#ece5d6', '#ffffff', '#2d3038', '#1d4fd8'],
    load: () => import('./kontur'),
    group: 'clarity',
  },
  {
    id: 'candy',
    name: 'Candy Tower',
    blurb: 'Chunky vinyl toys on candy-glass platforms, floating over sunny clouds.',
    swatch: ['#aaa6e0', '#fbe9c9', '#252a66', '#ffcc2e'],
    load: () => import('./candy'),
    group: 'clarity',
  },
  {
    id: 'nightdrive',
    name: 'Nightdrive',
    blurb: 'Pearl and neon-edged ink on glass floors, over an endless grid at dusk.',
    swatch: ['#2b0d3a', '#f7f5fb', '#120d26', '#d946ef'],
    load: () => import('./nightdrive'),
    group: 'clarity',
  },
  {
    id: 'sumi',
    name: 'Sumi',
    blurb:
      'Ink and paper: porcelain and lacquer on washi sheets, brush-stroke markers, misty ink mountains.',
    swatch: ['#e4dccb', '#f7f6f2', '#15100d', '#b8322a'],
    load: () => import('./sumi'),
    group: 'clarity',
  },
  {
    id: 'kit-demo',
    name: 'Kit Demo',
    blurb: 'The clarity kit on neutral styling: the template for new designs.',
    swatch: ['#2c333f', '#f1ebdf', '#262a31', '#4cc9f0'],
    load: () => import('./kit-demo'),
    group: 'clarity',
    hidden: true,
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The original glacier-gray wireframe lattice.',
    swatch: ['#c2cbd8', '#f2ead8', '#413b35', '#14b8a6'],
    // Bundled: it is the default, drawn before any other design has loaded.
    load: async () => ({ default: classic }),
    group: 'classic',
  },
  {
    id: 'royal',
    name: 'Royal Marble',
    blurb: 'Marble and onyx on five glass boards framed in gold, in a candlelit salon.',
    swatch: ['#1c1416', '#efe6d6', '#1d1b1c', '#d9ae55'],
    load: () => import('./royal'),
    group: 'earlier',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    blurb: 'Neon wireframes over an endless retro grid at sunset.',
    swatch: ['#120021', '#27e3ff', '#ff2bd6', '#ffb400'],
    load: () => import('./synthwave'),
    group: 'earlier',
  },
  {
    id: 'crystal',
    name: 'Crystal Garden',
    blurb: 'Clear crystal against amethyst on frosted glass, in pastel light.',
    swatch: ['#f3e8ff', '#ffffff', '#8b5cf6', '#f472b6'],
    load: () => import('./crystal'),
    group: 'earlier',
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    blurb: 'A constellation board adrift in a nebula; suns against dark stars.',
    swatch: ['#050716', '#ffd27a', '#6d5dfc', '#7dd3fc'],
    load: () => import('./cosmos'),
    group: 'earlier',
  },
  {
    id: 'toybox',
    name: 'Toy Box',
    blurb: 'Chunky painted-wood toys on stacked candy-coloured trays.',
    swatch: ['#8fd3ff', '#fff4dc', '#2b3a67', '#ff6b6b'],
    load: () => import('./toybox'),
    group: 'earlier',
  },
  {
    id: 'hologram',
    name: 'Hologram',
    blurb: 'A war-room projection: flickering holo pieces over a projector table.',
    swatch: ['#020b14', '#3cf2ff', '#ff9a3c', '#9dfcff'],
    load: () => import('./hologram'),
    group: 'earlier',
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    blurb: 'Primary-colour primitives on a floating cube of paper tiles, before a printed poster.',
    swatch: ['#f1ebdd', '#e63b2e', '#1f4bd8', '#f6c62a'],
    load: () => import('./bauhaus'),
    group: 'earlier',
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Pieces drawn as technical line art on drafting blue; moves measured, captures erased.',
    swatch: ['#0d3f94', '#eef5ff', '#041536', '#ffe066'],
    load: () => import('./blueprint'),
    group: 'earlier',
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Chunky voxels, pixel rendering and a CRT glow.',
    swatch: ['#1a0b2e', '#ffe9a8', '#b04cff', '#39ff88'],
    load: () => import('./arcade'),
    group: 'earlier',
  },
  {
    id: 'elemental',
    name: 'Ice & Fire',
    blurb: 'Carved ice against molten obsidian, with snow and embers.',
    swatch: ['#0d0f1a', '#bfe9ff', '#ff5a1f', '#7ad7ff'],
    load: () => import('./elemental'),
    group: 'earlier',
  },
  {
    id: 'zen',
    name: 'Zen Garden',
    blurb: 'River stones on pale maple trays, drifting blossoms.',
    swatch: ['#e9e4d8', '#f4f1ea', '#3b3a38', '#c44536'],
    load: () => import('./zen'),
    group: 'earlier',
  },
];
