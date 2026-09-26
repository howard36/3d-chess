import { Color, MeshStandardMaterial } from 'three';
import { buildStauntonGeometries } from '../../pieceGeometry';
import type { PieceColor } from '../types';
import { basaltTexture, graniteTexture } from './textures';

// The two stones of the armies: pale speckled granite and dark basalt, both
// matte with a tactile grain, turned on a finer lathe than the classic set.

export const stoneGeometries = buildStauntonGeometries(40);

export type StoneState = 'none' | 'hover' | 'selected' | 'check';

const GLOW: Record<StoneState, [string, number]> = {
  none: ['#000000', 0],
  hover: ['#fff1d6', 0.07],
  selected: ['#ffe2a6', 0.16],
  check: ['#d6301f', 0.45],
};

const materials = new Map<string, MeshStandardMaterial>();

/** The shared material of one army in one state. */
export const stoneMaterial = (color: PieceColor, state: StoneState = 'none') => {
  const key = `${color}-${state}`;
  let m = materials.get(key);
  if (m) return m;
  const white = color === 'white';
  const [glow, strength] = GLOW[state];
  m = new MeshStandardMaterial({
    color: white ? '#ffffff' : '#e8eaf0',
    map: white ? graniteTexture : basaltTexture,
    bumpMap: white ? graniteTexture : basaltTexture,
    bumpScale: white ? 1.2 : 0.8,
    roughness: white ? 0.78 : 0.58,
    metalness: 0,
    envMapIntensity: white ? 0.5 : 0.9,
    emissive: new Color(glow),
    emissiveIntensity: strength,
  });
  materials.set(key, m);
  return m;
};

/** The bishop's mitre cut: a darker line of the same stone. */
export const grooveMaterial = {
  white: new MeshStandardMaterial({ color: '#8f887d', roughness: 0.9 }),
  black: new MeshStandardMaterial({ color: '#141517', roughness: 0.8 }),
};
