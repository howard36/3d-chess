import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { PieceType } from '../../../engine/pieces';
import { noRaycast } from '../kit/noRaycast';
import { TOWER_MASK } from './mask';
import { GROUND_Y, PALETTE } from './palette';
import { sculptureOf } from './sculptures';

// The garden at night. The tower floats over an endless dark plain of
// glossy stone; under it, nothing, so from straight above there is only
// darkness through the levels. Further out the plain carries a colossal
// chessboard, eight squares by eight, drawn in the faintest lines of light
// and fading into the horizon, and on the ring of its outer squares stand
// eight colossal chess pieces, drawn only in thin white neon tube: their
// outlines (sculptures.ts) turn to face the viewer as a turned piece looks
// the same from every side, and stand on real rings of light round their
// bases and collars. Each has a breath of mist at its feet, and the ground
// gives back a faint, soft reflection. Two flank the tower in the opening
// view, and every side has one or two; whatever of the garden lies behind
// the tower is held down to nothing (mask.ts). Nothing here moves.

// --- The night sky ------------------------------------------------------------------

const Sky = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new SphereGeometry(400, 32, 16),
      material: new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uBottom: { value: new Color(PALETTE.skyBottom) },
          uMist: { value: new Color(PALETTE.mist) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          uniform vec3 uMist;
          varying vec3 vDir;
          void main() {
            float h = normalize(vDir).y;
            vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.45)) : mix(uHorizon, uBottom, pow(-h, 0.5));
            // A breath of mist lying along the horizon
            c += uMist * exp(-pow(h / 0.05, 2.0)) * 0.045;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

// --- The plain and its colossal board -------------------------------------------------

/** Side of one square of the colossal board (world units): eight across. */
const SQUARE = 10;
/** Radius of clear dark ground round the tower's foot. */
const CLEAR = [17, 27] as const;

const groundVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  varying float vCover;
  ${TOWER_MASK}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    // The mask is smooth: per vertex, on a finer mesh
    vCover = towerCover(w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const groundFragment = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uLine;
  uniform vec3 uHorizon;
  uniform float uSquare;
  uniform vec2 uClear;
  varying vec2 vP;
  varying vec3 vWorld;
  varying float vCover;
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    float r = length(vP);
    float dist = distance(vWorld, cameraPosition);
    // The colossal board's lines, coverage-correct at any distance, joined
    // by taking the brighter (never summed), so crossings stay even
    vec2 uv = vP / uSquare + 4.0;
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(0.006);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    float onBoard = step(-0.02, uv.x) * step(uv.x, 8.02) * step(-0.02, uv.y) * step(uv.y, 8.02);
    vec2 span = vec2(step(-0.01, uv.y) * step(uv.y, 8.01), step(-0.01, uv.x) * step(uv.x, 8.01));
    lines *= span;
    // The board's own edge a little brighter than its inner lines
    vec2 edge = step(3.5, abs(floor(uv + 0.5) - 4.0));
    float line = max(lines.x * mix(1.0, 1.7, edge.x), lines.y * mix(1.0, 1.7, edge.y));
    // A whisper of the checker: the light squares a shade lighter
    vec2 sq = floor(uv);
    float lightSq = mod(sq.x + sq.y, 2.0) * onBoard;
    // Clear ground round the tower, fading into the night far off, and
    // nothing at all where the tower stands in front of it
    float clear = smoothstep(uClear.x, uClear.y, r);
    float far = 1.0 - smoothstep(40.0, 110.0, dist);
    float hidden = 1.0 - vCover;
    float lit = (line * 0.04 + lightSq * 0.004) * clear * far * hidden;
    // Polished: toward the horizon it gives back the mist
    float fresnel = pow(1.0 - abs(view.y), 5.0);
    vec3 col = uGround + uLine * lit + uHorizon * fresnel * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Ground = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new PlaneGeometry(260, 260, 44, 44).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        // Drawn first and writing no depth: the reflections go under it
        depthWrite: false,
        uniforms: {
          uGround: { value: new Color(PALETTE.ground) },
          uLine: { value: new Color(PALETTE.neon) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uSquare: { value: SQUARE },
          uClear: { value: [...CLEAR] },
        },
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, GROUND_Y, 0]}
      renderOrder={-900}
      raycast={noRaycast}
    />
  );
};

// --- The sculptures ---------------------------------------------------------------------

/** Their scale: a colossal king stands about 8 units tall. */
const SCALE = 7.5;
/** The ring of the colossal board's outer squares they stand on. */
const RING = Math.hypot(0.5 * SQUARE, 3.5 * SQUARE);
/**
 * Where each stands (degrees round from +z, toward +x), on a square of the
 * colossal board. The opening view looks from 16° toward 196°: the king and
 * queen flank the tower there, well clear of its outline.
 */
const PLACES: { type: PieceType; deg: number }[] = [
  { type: PieceType.King, deg: 171.9 },
  { type: PieceType.Queen, deg: 225 },
  { type: PieceType.Knight, deg: 261.9 },
  { type: PieceType.Rook, deg: 315 },
  { type: PieceType.Pawn, deg: 351.9 },
  { type: PieceType.Unicorn, deg: 45 },
  { type: PieceType.Bishop, deg: 98.1 },
  { type: PieceType.Pawn, deg: 135 },
];

const anchorOf = (deg: number): [number, number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * RING, GROUND_Y, Math.cos(a) * RING];
};

/**
 * Every sculpture's tubes as one ribbon mesh. Each vertex carries its
 * sculpture's anchor, its point and tangent (in the drawing plane for an
 * outline, in 3D for a ring) and its side of the ribbon; the vertex shader
 * turns an outline to face the camera and widens every tube across the view,
 * so the whole garden is one draw call.
 */
const neonGeometry = (): BufferGeometry => {
  const anchor: number[] = [];
  const local: number[] = [];
  const tangent: number[] = [];
  const side: number[] = [];
  const mode: number[] = [];
  const index: number[] = [];
  const addCurve = (
    at: [number, number, number],
    pts: [number, number, number][],
    closed: boolean,
    fixed: boolean,
  ) => {
    const n = pts.length;
    const base = side.length;
    for (let k = 0; k < n; k++) {
      const prev = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)];
      const next = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
      const t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      const l = Math.hypot(t[0], t[1], t[2]) || 1;
      for (const s of [-1, 1]) {
        anchor.push(...at);
        local.push(...pts[k]);
        tangent.push(t[0] / l, t[1] / l, t[2] / l);
        side.push(s);
        mode.push(fixed ? 1 : 0);
      }
    }
    const segments = closed ? n : n - 1;
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % n);
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  };
  for (const { type, deg } of PLACES) {
    const at = anchorOf(deg);
    const drawing = sculptureOf(type);
    for (const o of drawing.outlines) {
      addCurve(
        at,
        o.points.map(([x, y]) => [x * SCALE, y * SCALE, 0]),
        o.closed,
        false,
      );
    }
    for (const ring of drawing.rings) {
      const pts = Array.from({ length: 48 }, (_, k): [number, number, number] => {
        const a = (k / 48) * Math.PI * 2;
        return [
          Math.cos(a) * ring.radius * SCALE,
          ring.y * SCALE,
          Math.sin(a) * ring.radius * SCALE,
        ];
      });
      addCurve(at, pts, true, true);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(local), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangent), 3));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aMode', new BufferAttribute(new Float32Array(mode), 1));
  g.setIndex(index);
  return g;
};

const neonVertex = /* glsl */ `
  uniform float uWidth;
  uniform float uMirror;
  uniform float uGround;
  attribute vec3 aAnchor;
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aMode;
  varying float vAcross;
  varying float vCover;
  varying float vDepth;
  varying float vRing;
  ${TOWER_MASK}
  void main() {
    vec3 toCam = cameraPosition - aAnchor;
    vec2 h = normalize(toCam.xz + vec2(1e-5, 0.0));
    // The drawing's plane faces the camera, turned about the vertical
    vec3 right = vec3(h.y, 0.0, -h.x);
    // A knight looks in toward the board, whichever side of it it stands
    float face = dot(right.xz, -aAnchor.xz) >= 0.0 ? 1.0 : -1.0;
    vec3 p;
    vec3 t;
    if (aMode < 0.5) {
      p = aAnchor + right * position.x * face + vec3(0.0, position.y, 0.0);
      t = right * aTangent.x * face + vec3(0.0, aTangent.y, 0.0);
    } else {
      p = aAnchor + position;
      t = aTangent;
    }
    vDepth = p.y - uGround;
    if (uMirror > 0.5) {
      p.y = 2.0 * uGround - p.y;
      t.y = -t.y;
    }
    vCover = towerCover(p);
    // Widened across the view, so every tube reads the same from any side
    vec3 v = normalize(cameraPosition - p);
    vec3 s = cross(t, v);
    float sl = length(s);
    s = sl > 1e-5 ? s / sl : vec3(0.0, 1.0, 0.0);
    p += s * aSide * uWidth;
    vAcross = aSide;
    vRing = aMode;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const neonFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore;
  uniform float uHalo;
  uniform float uIntensity;
  uniform float uFade;
  uniform float uBoost;
  varying float vAcross;
  varying float vCover;
  varying float vDepth;
  varying float vRing;
  void main() {
    float a = abs(vAcross);
    float fw = max(fwidth(vAcross), 1e-5);
    // The tube: never thinner than about a pixel, dimmer instead
    float w = max(uCore, fw * 0.8);
    float core = (1.0 - smoothstep(w - fw, w + fw, a)) * min(uCore / w, 1.0);
    float halo = exp(-a * a * 7.0) * (1.0 - a) * uHalo;
    // The rings a little quieter than the outlines they stand the pieces on
    float light = (core + halo) * uIntensity * (1.0 + uBoost) * (1.0 - 0.3 * vRing);
    // A reflection fades with its depth under the polished ground
    light *= uFade > 0.0 ? exp(-vDepth / uFade) : 1.0;
    light *= 1.0 - vCover;
    if (light < 0.001) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

/** Brightens the garden for a moment at mate (fx.tsx). */
export const gardenBoost = { value: 0 };

const neonMaterial = (o: {
  width: number;
  core: number;
  halo: number;
  intensity: number;
  mirror: boolean;
  fade: number;
}) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.neon) },
      uWidth: { value: o.width },
      uCore: { value: o.core },
      uHalo: { value: o.halo },
      uIntensity: { value: o.intensity },
      uMirror: { value: o.mirror ? 1 : 0 },
      uGround: { value: GROUND_Y },
      uFade: { value: o.fade },
      uBoost: gardenBoost,
    },
    vertexShader: neonVertex,
    fragmentShader: neonFragment,
  });

const Sculptures = () => {
  const { geometry, tubes, reflection } = useMemo(
    () => ({
      geometry: neonGeometry(),
      tubes: neonMaterial({
        width: 0.26,
        core: 0.12,
        halo: 0.1,
        intensity: 0.15,
        mirror: false,
        fade: 0,
      }),
      // Softer and dimmer in the polished stone, fading with depth
      reflection: neonMaterial({
        width: 0.45,
        core: 0.05,
        halo: 0.14,
        intensity: 0.045,
        mirror: true,
        fade: 3.2,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      tubes.dispose();
      reflection.dispose();
    },
    [geometry, tubes, reflection],
  );
  return (
    <group name="monolith-garden">
      <mesh
        geometry={geometry}
        material={reflection}
        renderOrder={-880}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <mesh
        geometry={geometry}
        material={tubes}
        renderOrder={-870}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- Mist at their feet ---------------------------------------------------------------------

const mistGeometry = (): BufferGeometry => {
  const anchor: number[] = [];
  const corner: number[] = [];
  const size: number[] = [];
  const index: number[] = [];
  PLACES.forEach(({ deg }, i) => {
    const at = anchorOf(deg);
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      anchor.push(...at);
      corner.push(cx, cy, 0);
      size.push(SCALE * 0.62, SCALE * 0.16);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(corner), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 2));
  g.setIndex(index);
  return g;
};

const Mist = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: mistGeometry(),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color(PALETTE.mist) }, uBoost: gardenBoost },
        vertexShader: /* glsl */ `
          attribute vec3 aAnchor;
          attribute vec2 aSize;
          varying vec2 vC;
          varying float vCover;
          ${TOWER_MASK}
          void main() {
            vec2 h = normalize((cameraPosition - aAnchor).xz + vec2(1e-5, 0.0));
            vec3 right = vec3(h.y, 0.0, -h.x);
            vec3 p = aAnchor + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
            vC = position.xy;
            vCover = towerCover(aAnchor + vec3(0.0, aSize.y * 0.5, 0.0));
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBoost;
          varying vec2 vC;
          varying float vCover;
          void main() {
            float m = exp(-dot(vC * vec2(2.0, 2.6), vC * vec2(2.0, 2.6)));
            float a = m * 0.075 * (1.0 + 0.6 * uBoost) * (1.0 - vCover);
            if (a < 0.001) discard;
            gl_FragColor = vec4(uColor * a, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-860}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

export const Stage = () => (
  <>
    <Sky />
    <Ground />
    <Sculptures />
    <Mist />
  </>
);
