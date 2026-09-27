import { useEffect, useRef } from 'react';
import type React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import type { Group } from 'three';
import { prefersReducedMotion } from '../../motion';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ContactShadow } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { BEAM, CARBON, CERAMIC, CHECK, GRAPHITE, LEVELS, STEEL, TITANIUM } from './palette';

// The armies, in spacecraft materials on the shared Staunton set:
//
// - White: heat-shield ceramic, a warm matte white laid in fine staggered
//   tiles (the seams fade out before they could shimmer), with its
//   identifying details (the knight's mane, the bishop's cut, the unicorn's
//   spiral, the queen's pearls, the king's cross) in black carbon tile.
// - Black: anodised graphite, satin, with the same details in bright
//   machined titanium, so they read even from straight above; a cool rim
//   of light round every edge keeps each piece a sculpted form against the
//   dark bay, never a silhouette.
//
// Both wear a collar of brushed metal and stand on a foot band that glows
// in their deck's colour, spilling a ring of that light onto the glass.

type State = 'idle' | 'hover' | 'selected' | 'check';

const RIM: Record<PieceColor, Record<State, [string, number]>> = {
  white: {
    idle: ['#a9c2e2', 0.1],
    hover: ['#bcd6f5', 0.28],
    selected: [BEAM, 0.45],
    check: [CHECK, 0.7],
  },
  black: {
    idle: ['#7d9cc6', 0.55],
    hover: ['#9bbbe6', 0.85],
    selected: [BEAM, 1.0],
    check: [CHECK, 1.1],
  },
};

const common = /* glsl */ `
  varying vec3 vObj;
  uniform vec3 uRim;
  uniform float uRim_k;
  uniform float uSeams;

  // Staggered tiles round a turned form: rows of equal height, ten tiles
  // round, every other row offset by half a tile. Returns the seam's cover.
  float tileSeams(vec3 p) {
    float rowH = 0.072;
    float row = p.y / rowH;
    float ri = floor(row);
    float rad = length(p.xz);
    float n = 10.0;
    float around = (atan(p.z, p.x) / 6.2831853 + 0.5) * n + mod(ri, 2.0) * 0.5;
    float dy = min(fract(row), 1.0 - fract(row)) * rowH;
    float dx = min(fract(around), 1.0 - fract(around)) * 6.2831853 * rad / n;
    // Only where the form is wide enough to carry a tile
    dx = mix(1.0, dx, step(0.06, rad));
    float dd = min(dy, dx);
    float fw = max(fwidth(dd), 1e-5);
    float s = 1.0 - smoothstep(0.0024 - fw, 0.0024 + fw, dd);
    // Fade out where the rows crowd closer than a few pixels
    s *= 1.0 - smoothstep(0.12, 0.3, fwidth(row));
    return s;
  }
`;

interface Finish {
  color: string;
  roughness: number;
  metalness: number;
  /** How deep the tile seams darken the surface (0: none). */
  seams: number;
  envMapIntensity?: number;
}

const skin = (finish: Finish, rim: [string, number]) => {
  const m = new MeshStandardMaterial({
    color: finish.color,
    roughness: finish.roughness,
    metalness: finish.metalness,
    envMapIntensity: finish.envMapIntensity ?? 1,
  });
  const uniforms = {
    uRim: { value: new Color(rim[0]) },
    uRim_k: { value: rim[1] },
    uSeams: { value: finish.seams },
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
          ? '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uSeams * tileSeams(vObj);'
          : '#include <color_fragment>',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * uRim_k * pow(1.0 - rimFacing, 2.6);`,
      );
  };
  m.customProgramCacheKey = () => `orbital-skin-${tiled ? 'tiled' : 'plain'}`;
  return m;
};

type Part = 'body' | 'collar' | 'accent';

const FINISH: Record<PieceColor, Record<Part, Finish>> = {
  white: {
    body: { color: CERAMIC, roughness: 0.62, metalness: 0, seams: 0.3, envMapIntensity: 0.8 },
    collar: { color: STEEL, roughness: 0.32, metalness: 0.85, seams: 0 },
    accent: { color: CARBON, roughness: 0.55, metalness: 0.1, seams: 0.35 },
  },
  black: {
    body: { color: GRAPHITE, roughness: 0.4, metalness: 0.45, seams: 0, envMapIntensity: 1.3 },
    collar: { color: TITANIUM, roughness: 0.3, metalness: 0.85, seams: 0 },
    accent: { color: TITANIUM, roughness: 0.28, metalness: 0.9, seams: 0 },
  },
};

const skins = new Map<string, MeshStandardMaterial>();
/** A part's material for an army and state: shared by every piece in that state. */
export const skinFor = (color: PieceColor, part: Part, state: State) => {
  const key = `${color}/${part}/${state}`;
  let m = skins.get(key);
  if (!m) {
    m = skin(FINISH[color][part], RIM[color][state]);
    skins.set(key, m);
  }
  return m;
};

/** A part's material of its own (not shared), for an effect that changes it. */
export const freshSkin = (color: PieceColor, part: Part, state: State) =>
  skin(FINISH[color][part], RIM[color][state]);

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
      emissiveIntensity: bright ? 1.4 : 0.85,
      roughness: 0.4,
      metalness: 0,
      toneMapped: false,
    });
    feet.set(key, m);
  }
  return m;
};

// --- The light the foot band spills on the glass -------------------------------------

const spillTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    // Drawn as grey on black: an alpha map reads the colour, not the alpha
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const grey = (v: number) =>
      `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;
    g.addColorStop(0, grey(0));
    g.addColorStop(0.62, grey(0.05));
    g.addColorStop(0.7, grey(0.22));
    // The ring itself, crisp
    g.addColorStop(0.72, grey(0.95));
    g.addColorStop(0.765, grey(0.95));
    g.addColorStop(0.785, grey(0.3));
    g.addColorStop(0.88, grey(0.08));
    g.addColorStop(1, grey(0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    t = new CanvasTexture(c);
    return t;
  };
})();

const SPILL_RADIUS = 0.46;
const spillPlane = new PlaneGeometry(SPILL_RADIUS * 2, SPILL_RADIUS * 2).rotateX(-Math.PI / 2);
const spills = new Map<number, MeshBasicMaterial>();
const spillFor = (level: number) => {
  let m = spills.get(level);
  if (!m) {
    m = new MeshBasicMaterial({
      color: LEVELS[level] ?? LEVELS[0],
      alphaMap: spillTexture(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    spills.set(level, m);
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
      body: skinFor(color, 'body', state),
      collar: skinFor(color, 'collar', state),
      accent: skinFor(color, 'accent', state),
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
        <ContactShadow radius={0.36} opacity={0.6} />
        <mesh
          geometry={spillPlane}
          material={spillFor(level)}
          position={[0, 0.006, 0]}
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
