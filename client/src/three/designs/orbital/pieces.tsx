import { useEffect, useRef } from 'react';
import type React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { Group } from 'three';
import { prefersReducedMotion } from '../../motion';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, pieceSet } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { BEAM, CARBON, CERAMIC, GRAPHITE, LEVELS, STEEL, TITANIUM } from './palette';

// The armies, in spacecraft materials on the shared Staunton set:
//
// - White: heat-shield ceramic, a warm matte white laid in broad staggered
//   panels below the collar (each a shade apart; the seams fade out before
//   they could shimmer), with its identifying details (the knight's mane,
//   the bishop's cut, the unicorn's spiral, the queen's pearls, the king's
//   cross) in black carbon.
// - Black: anodised graphite, satin and light enough for the key light to
//   model it, with the same details in bright machined titanium, so they
//   read even from straight above; a cool rim of light round every edge
//   keeps each piece a sculpted form against the dark bay.
//
// Both wear a collar of brushed metal and stand on a foot band that glows
// in their deck's colour, with a thin quiet ring of that light on the glass:
// the resting army stays calmer than the play lights.

type State = 'idle' | 'hover' | 'selected' | 'check';

/** A rim of light: colour, strength, and how tightly it hugs the silhouette (power). */
type Rim = [string, number, number];

// A check is a red edge, not a red king: tight and light, so the king keeps
// its army's colour. Held in the beam, the graphite takes a cool edge rather
// than the beam's white, so it still reads as graphite.
const RIM: Record<PieceColor, Record<State, Rim>> = {
  white: {
    idle: ['#a9c2e2', 0.1, 2.6],
    hover: ['#bcd6f5', 0.3, 2.4],
    selected: [BEAM, 0.4, 2.6],
    check: ['#ff5a6e', 0.35, 3.5],
  },
  black: {
    idle: ['#7d9cc6', 0.45, 2.0],
    hover: ['#9bbbe6', 0.7, 2.0],
    selected: ['#bcd8ff', 0.6, 2.2],
    check: ['#ff5a6e', 0.5, 3.5],
  },
};

const common = /* glsl */ `
  varying vec3 vObj;
  uniform vec3 uRim;
  uniform float uRim_k;
  uniform float uRimPow;
  uniform float uSeams;
  uniform float uSeamTop;

  // Heat-shield panels round a turned form: rows of equal height, six
  // panels round, every other row offset by half a panel, each panel a
  // shade lighter or darker than the next. Returns the seam's cover (x) and
  // the panel's shade (y). Only below the collar: the head stays clean.
  vec2 tileSeams(vec3 p) {
    float rowH = 0.13;
    float row = p.y / rowH;
    float ri = floor(row);
    float rad = length(p.xz);
    float n = 6.0;
    float around = (atan(p.z, p.x) / 6.2831853 + 0.5) * n + mod(ri, 2.0) * 0.5;
    float ci = mod(floor(around), n);
    float shade = fract(sin(ri * 12.9898 + ci * 78.233) * 43758.5453) * 2.0 - 1.0;
    float dy = min(fract(row), 1.0 - fract(row)) * rowH;
    float dx = min(fract(around), 1.0 - fract(around)) * 6.2831853 * rad / n;
    // Only where the form is wide enough to carry a panel
    dx = mix(1.0, dx, step(0.06, rad));
    float dd = min(dy, dx);
    float fw = max(fwidth(dd), 1e-5);
    float s = 1.0 - smoothstep(0.0026 - fw, 0.0026 + fw, dd);
    // Fade out where the rows crowd closer than a few pixels
    s *= 1.0 - smoothstep(0.12, 0.3, fwidth(row));
    float below = 1.0 - smoothstep(uSeamTop - 0.01, uSeamTop, p.y);
    return vec2(s * below, shade * below);
  }
`;

interface Finish {
  color: string;
  roughness: number;
  metalness: number;
  /** How deep the panel seams darken the surface (0: none). */
  seams: number;
  envMapIntensity?: number;
}

const skin = (finish: Finish, rim: Rim, seamTop = 1) => {
  const m = new MeshStandardMaterial({
    color: finish.color,
    roughness: finish.roughness,
    metalness: finish.metalness,
    envMapIntensity: finish.envMapIntensity ?? 1,
  });
  const uniforms = {
    uRim: { value: new Color(rim[0]) },
    uRim_k: { value: rim[1] },
    uRimPow: { value: rim[2] },
    uSeams: { value: finish.seams },
    uSeamTop: { value: seamTop },
  };
  const tiled = finish.seams > 0;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${common}`)
      .replace(
        '#include <color_fragment>',
        tiled
          ? `#include <color_fragment>
          vec2 tile = tileSeams(vObj);
          diffuseColor.rgb *= (1.0 + 0.03 * tile.y) * (1.0 - uSeams * tile.x);`
          : '#include <color_fragment>',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * uRim_k * pow(1.0 - rimFacing, uRimPow);`,
      );
  };
  m.customProgramCacheKey = () => `orbital-skin-${tiled ? 'tiled' : 'plain'}`;
  return m;
};

type Part = 'body' | 'collar' | 'accent';

const FINISH: Record<PieceColor, Record<Part, Finish>> = {
  white: {
    body: { color: CERAMIC, roughness: 0.62, metalness: 0, seams: 0.2, envMapIntensity: 0.8 },
    collar: { color: STEEL, roughness: 0.32, metalness: 0.85, seams: 0 },
    accent: { color: CARBON, roughness: 0.55, metalness: 0.1, seams: 0 },
  },
  black: {
    body: { color: GRAPHITE, roughness: 0.35, metalness: 0.2, seams: 0, envMapIntensity: 1 },
    collar: { color: TITANIUM, roughness: 0.3, metalness: 0.85, seams: 0 },
    accent: { color: TITANIUM, roughness: 0.28, metalness: 0.9, seams: 0 },
  },
};

/**
 * Where a piece's panels stop: the bottom of its collar (the head above it
 * stays clean). The knight has none: panels would read as brickwork on its
 * sculpted head.
 */
const seamTop = (type: PieceType) => {
  if (type === PieceType.Knight) return -1;
  const collar = pieceSet()[type].collar;
  return collar.boundingBox?.min.y ?? 1;
};

const skins = new Map<string, MeshStandardMaterial>();
/**
 * The rook's accent is its whole hollow (and sills): seen from above it is
 * most of the piece, so it stays in its own army's value (a shaded ceramic,
 * a deeper graphite) rather than the contrasting detail colour.
 */
const ROOK_ACCENT: Record<PieceColor, Finish> = {
  white: { color: '#b4aea4', roughness: 0.62, metalness: 0, seams: 0 },
  black: { color: '#2e343d', roughness: 0.42, metalness: 0.2, seams: 0 },
};

const finishFor = (color: PieceColor, part: Part, type: PieceType) => {
  const f = part === 'accent' && type === PieceType.Rook ? ROOK_ACCENT[color] : FINISH[color][part];
  const top = f.seams > 0 ? seamTop(type) : 1;
  return { finish: top < 0 ? { ...f, seams: 0 } : f, top };
};

/**
 * A part's material for an army, piece and state: shared by every such
 * piece in that state (only the panelled ceramic differs from piece to piece).
 */
export const skinFor = (color: PieceColor, part: Part, state: State, type: PieceType) => {
  const perType = FINISH[color][part].seams > 0 || (part === 'accent' && type === PieceType.Rook);
  const key = `${color}/${part}/${state}${perType ? `/${type}` : ''}`;
  let m = skins.get(key);
  if (!m) {
    const { finish, top } = finishFor(color, part, type);
    m = skin(finish, RIM[color][state], top);
    skins.set(key, m);
  }
  return m;
};

/** A part's material of its own (not shared), for an effect that changes it. */
export const freshSkin = (color: PieceColor, part: Part, state: State, type: PieceType) => {
  const { finish, top } = finishFor(color, part, type);
  return skin(finish, RIM[color][state], top);
};

// The foot band: a strip light in the deck's colour, a little brighter while held
const feet = new Map<string, MeshStandardMaterial>();
export const footFor = (level: number, bright: boolean) => {
  const key = `${level}/${bright}`;
  let m = feet.get(key);
  if (!m) {
    const c = new Color(LEVELS[level] ?? LEVELS[0]);
    m = new MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: bright ? 1.3 : 0.7,
      roughness: 0.4,
      metalness: 0,
      toneMapped: false,
    });
    feet.set(key, m);
  }
  return m;
};

// --- On the glass: the contact shadow and the ring of the foot band's light ---------

/** Radius of the floor plane (piece units): the ring sits at about 0.29, hugging the foot. */
const FLOOR_RADIUS = 0.4;

const floorTextures = new Map<number, CanvasTexture>();
/**
 * One texture per deck, both in one: a soft shadow under the base and, just
 * round the foot, a thin quiet ring of the deck's colour, notched once per
 * deck (A one notch, E five). One plane per piece instead of two.
 */
const floorTexture = (level: number) => {
  let t = floorTextures.get(level);
  if (t) return t;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  // The canvas takes sRGB: the hex as it is
  const hex = parseInt((LEVELS[level] ?? LEVELS[0]).slice(1), 16);
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const lit = (a: number) => `rgba(${r},${g},${b},${a})`;
  const dark = (a: number) => `rgba(0,0,0,${a})`;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, dark(0.85));
  grad.addColorStop(0.45, dark(0.78));
  grad.addColorStop(0.62, dark(0.3));
  grad.addColorStop(0.68, lit(0.1));
  // The ring itself, crisp but quiet
  grad.addColorStop(0.715, lit(0.5));
  grad.addColorStop(0.76, lit(0.5));
  grad.addColorStop(0.79, lit(0.1));
  grad.addColorStop(0.9, lit(0.03));
  grad.addColorStop(1, lit(0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // The deck's number, not only its colour: the ring is cut by one notch on
  // deck A, up to five on deck E
  const notches = level + 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const half = (9 * Math.PI) / 180;
  for (let k = 0; k < notches; k++) {
    const at = -Math.PI / 2 + (k * 2 * Math.PI) / notches;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.41, at - half, at + half);
    ctx.arc(size / 2, size / 2, size * 0.335, at + half, at - half, true);
    ctx.closePath();
    ctx.fill();
  }
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  floorTextures.set(level, t);
  return t;
};

const floorPlane = new PlaneGeometry(FLOOR_RADIUS * 2, FLOOR_RADIUS * 2).rotateX(-Math.PI / 2);
const floors = new Map<number, MeshBasicMaterial>();
const floorFor = (level: number) => {
  let m = floors.get(level);
  if (!m) {
    m = new MeshBasicMaterial({
      map: floorTexture(level),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    floors.set(level, m);
  }
  return m;
};

/**
 * Keeps its children on the floor while Board lifts the piece (hover and
 * selection raise a Lift group round the body): the shadow and the ring of
 * light stay on the glass as the piece rises off it.
 */
const OnFloor = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    let lift = 0;
    for (let a = g.parent; a; a = a.parent) {
      if (a.userData.lift) {
        lift = a.position.y;
        break;
      }
    }
    g.position.y = -lift;
    // A toppled piece (a mated king: Board tips a group a few levels up
    // back through -1.4 rad) leaves its light behind rather than tipping it
    // up on edge
    let toppled = false;
    let a = g.parent;
    for (let k = 0; a && k < 6; k++, a = a.parent) if (a.rotation.x < -0.35) toppled = true;
    g.visible = !toppled;
  });
  return <group ref={ref}>{children}</group>;
};

const SPIN = 0.7;
const TAU = Math.PI * 2;

/** Turns its children slowly while `active`, and eases them back to rest after. */
const Spin = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [active, invalidate]);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    if (active && !prefersReducedMotion()) {
      g.rotation.y = (g.rotation.y + dt * SPIN) % TAU;
      invalidate();
      return;
    }
    if (g.rotation.y === 0) return;
    const r = ((g.rotation.y % TAU) + TAU) % TAU;
    const goal = r > Math.PI ? TAU : 0;
    const next = r + (goal - r) * Math.min(1, dt * 7);
    g.rotation.y = Math.abs(goal - next) < 1e-3 ? 0 : next;
    invalidate();
  });
  return <group ref={ref}>{children}</group>;
};

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'idle';

/** Just the piece, in a state's materials: for effects that redraw one. */
export const PieceModel = ({
  type,
  color,
  level = 0,
  state = 'idle',
}: Pick<PieceBodyProps, 'type' | 'color' | 'level'> & { state?: State }) => (
  <ChessPiece
    type={type}
    parts={{
      body: skinFor(color, 'body', state, type),
      collar: skinFor(color, 'collar', state, type),
      accent: skinFor(color, 'accent', state, type),
      foot: footFor(level, state === 'selected'),
    }}
  />
);

/**
 * A piece: on its contact shadow and its deck's ring of light, which stay on
 * the glass while the piece lifts. Picked up, it turns slowly in the
 * tractor beam (Selection) and its foot band flares.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  const state = stateOf(props);
  return (
    <>
      <OnFloor>
        <mesh
          geometry={floorPlane}
          material={floorFor(level)}
          position={[0, 0.005, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
      </OnFloor>
      <Spin active={props.selected}>
        <PieceModel type={props.type} color={props.color} level={level} state={state} />
      </Spin>
    </>
  );
};
