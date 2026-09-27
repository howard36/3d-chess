import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { GILT, GILT_DEEP, IVORY, LEVEL, RUBY, RUBY_DEEP, SUNLIGHT } from './palette';

// Vitrail's marks, all lying flat on the glass like light and gilding laid
// on a window: a gilt quatrefoil where a piece may go, a cabochon of its
// level's jewel glass at its heart; the same quatrefoil in ruby, opened round
// the victim's base and cusped with four thorns, for a capture; a candle-ivory
// rosette on each square of the last move, joined by a thin thread of the
// same light; a crown of ruby light round a king in check, and a small
// circlet of it floating over his cross; and for the selection, a column of
// sunlight falling from the platform above onto the piece, pooling on the
// glass in a crisp sunlit ring, motes of dust turning slowly in it. Every
// flat mark is one quad shaded by a signed-distance function, crisp and
// antialiased at any angle, with a thin dark keyline so it holds on pale
// glass as well as dark.
//
// From high above, where the levels stack, the marks sort themselves out:
// destinations on other levels than the held piece's draw smaller, so a
// stack of them nests (each with its level's jewel), the pool keeps only its
// ring, and a gilt ▲ or ▼ at the ring's edge says the piece may also go
// straight up or down.

export const SHAPE = {
  quatrefoil: 0,
  capture: 1,
  rosette: 2,
  crown: 3,
  pool: 4,
  pane: 5,
  tick: 6,
  ring: 7,
} as const;
export type MarkShape = keyof typeof SHAPE;

/** Per-frame clamp on the clock for entrances: generous, so a slow device still ends on time. */
const MAX_FRAME = 1 / 8;
const DEG = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const target = new Vector3();
/** The camera's elevation above the board's centre (radians). */
const elevationOf = (camera: { position: Vector3 }, controls: unknown) => {
  const t = (controls as { target?: Vector3 } | null)?.target ?? target.set(0, 0, 0);
  const dx = camera.position.x - t.x;
  const dy = camera.position.y - t.y;
  const dz = camera.position.z - t.z;
  return Math.atan2(dy, Math.hypot(dx, dz));
};

/**
 * Where the held piece stands, shared so that the destination marks can
 * tell a move straight up or down, and draw themselves smaller from above
 * when they lie on another level.
 */
const held: { floor: Vec3 | null; owner: object | null } = { floor: null, owner: null };

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uShape;
  uniform vec3 uColor;
  uniform vec3 uKey;
  uniform vec3 uJewel;
  uniform float uJewelR;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uKeyAlpha;
  uniform float uHover;
  uniform float uGrow;
  varying vec2 vP;

  const float PI = 3.14159265;

  float sdQuatrefoil(vec2 p, float R) {
    float c = R * 0.43;
    float r = R - c;
    float d = length(p - vec2(c, 0.0)) - r;
    d = min(d, length(p + vec2(c, 0.0)) - r);
    d = min(d, length(p - vec2(0.0, c)) - r);
    d = min(d, length(p + vec2(0.0, c)) - r);
    return d;
  }
  // A thorn along the diagonal, from radius a to b, tapering to its point
  float thorn(vec2 p, float a, float b, float w) {
    vec2 q = abs(p);
    vec2 d = vec2(0.70710678);
    vec2 pa = q - d * a;
    vec2 ba = d * (b - a);
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - w * (1.0 - 0.8 * h);
  }
  // An equilateral triangle pointing up (+y), of circumradius-ish r
  float sdTriangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    // Under the pointer a mark swells a little, as if the glass caught the light
    vec2 p = vP / max(uGrow * (1.0 + 0.12 * uHover), 0.001);
    float R = uRadius;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float stroke = 1e3;   // signed distance to the stroke
    float area = 1e3;     // signed distance to what it encloses
    float glow = 0.0;     // soft light, added to the fill
    if (uShape == 0) {
      float q = sdQuatrefoil(p, R);
      stroke = abs(q) - uWidth * 0.5;
      area = q;
    } else if (uShape == 1) {
      float q = sdQuatrefoil(p, R);
      stroke = abs(q) - uWidth * 0.5;
      area = q;
      // Four thorns out from the cusps toward the square's corners, ending
      // inside the square and finer than the stroke
      stroke = min(stroke, thorn(p, R * 0.66, R * 1.02, uWidth * 0.5));
    } else if (uShape == 2) {
      // Eight petals: a rosette
      float rr = R * (0.9 + 0.1 * abs(cos(ang * 4.0)));
      float s = (r - rr) * 0.9;
      stroke = abs(s) - uWidth * 0.5;
      area = s;
    } else if (uShape == 3) {
      // A crown of light: a band with eight tines, and a ruby floor within
      float seg = PI / 4.0;
      float phi = mod(ang + seg * 0.5, seg) - seg * 0.5;
      float tine = max(0.0, 1.0 - abs(phi) / (seg * 0.28));
      float outer = R + R * 0.24 * tine;
      stroke = max(R - uWidth - r, r - outer);
      area = r - R;
    } else if (uShape == 4) {
      // A pool of sunlight: bright at the heart, soft at the rim
      area = r - R;
      float k = r / (R * 1.2);
      glow = exp(-k * k * 2.6);
      // Faint petals of the window the light came through
      glow *= 0.82 + 0.18 * cos(ang * 8.0) * smoothstep(0.15, 0.6, k);
    } else if (uShape == 5) {
      // A pane lit from within: a soft square
      vec2 q = abs(p) - vec2(R * 0.82);
      float b = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R * 0.18;
      area = b;
      glow = 1.0 - smoothstep(-R * 0.5, R * 0.05, b);
    } else if (uShape == 6) {
      // A small solid triangle: up (or down) a level
      area = sdTriangle(p, R);
      stroke = abs(area) - uWidth * 0.5;
    } else {
      // A crisp ring of sunlight, haloed
      stroke = abs(r - R) - uWidth * 0.5;
      glow = exp(-pow(max(abs(r - R) - uWidth * 0.5, 0.0) / (uWidth * 1.4), 2.0)) * 0.6;
    }
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float key = 1.0 - smoothstep(-aa, aa, stroke - uWidth * 0.55);
    float ia = max(fwidth(area), 1e-4);
    float inside = 1.0 - smoothstep(-ia, ia, area);
    // Gilding catches the light unevenly round the stroke
    float sheen = 0.84 + 0.3 * (0.5 + 0.5 * sin(ang * 2.0 + 0.9));
    vec3 lit = uColor * sheen * (1.0 + 0.45 * uHover);
    float strength = uOpacity * (1.0 + 0.5 * uHover);
    float fill = (uFill + 0.26 * uHover) * inside + glow * uFill;
    float a = line * strength;
    float halo = max(key - line, 0.0) * uKeyAlpha;
    vec3 col = lit;
    float alpha = a + (1.0 - a) * fill;
    col = mix(uColor, lit, a / max(alpha, 1e-4));
    // The keyline goes under everything
    float outA = alpha + (1.0 - alpha) * halo;
    col = mix(uKey, col, alpha / max(outA, 1e-4));
    // A cabochon of jewel glass at the heart: the mark's level, in colour
    if (uJewelR > 0.0) {
      float jd = r - uJewelR;
      float ja = max(fwidth(jd), 1e-4);
      float jewel = 1.0 - smoothstep(-ja, ja, jd);
      float jkey = 1.0 - smoothstep(-ja, ja, jd - uJewelR * 0.35);
      // Lit from one side, like a domed stone
      float dome = 0.72 + 0.55 * smoothstep(0.9, -0.6, dot(p / uJewelR, vec2(0.6, -0.6)));
      vec3 jc = uJewel * dome;
      col = mix(col, uKey, max(jkey - jewel, 0.0) * 0.7);
      outA = max(outA, max(jkey - jewel, 0.0) * 0.6);
      col = mix(col, jc, jewel);
      outA = max(outA, jewel);
    }
    if (outA < 0.003) discard;
    gl_FragColor = vec4(col, min(outA, 1.0));
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(size, g);
  }
  return g;
};

const markMaterial = (additive = false) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : undefined,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uShape: { value: 0 },
      uColor: { value: new Color() },
      uKey: { value: new Color() },
      uJewel: { value: new Color() },
      uJewelR: { value: 0 },
      uOpacity: { value: 1 },
      uFill: { value: 0 },
      uRadius: { value: 0.3 },
      uWidth: { value: 0.04 },
      uKeyAlpha: { value: 0.4 },
      uHover: { value: 0 },
      uGrow: { value: 1 },
      uQuad: { value: 1 },
    },
    vertexShader,
    fragmentShader,
  });

export interface GlassMarkProps {
  floor: Vec3;
  shape: MarkShape;
  color: string;
  /** Keyline colour, drawn just outside the stroke. */
  keyColor?: string;
  keyAlpha?: number;
  /** Size of the shape (world units: the quatrefoil's outer reach). */
  radius: number;
  /** Stroke width (world units). */
  width?: number;
  opacity?: number;
  fill?: number;
  hovered?: boolean;
  /** A cabochon of this colour at the mark's heart. */
  jewel?: string;
  jewelRadius?: number;
  /** Draw smaller from high above when not on the held piece's level, so stacks nest. */
  nest?: boolean;
  /** What share of the fill remains seen from straight above (1: all of it). */
  steepFill?: number;
  /** Grow in from nothing over this long when mounted (0: at once). */
  growMs?: number;
  delayMs?: number;
  lift?: number;
  renderOrder?: number;
  additive?: boolean;
}

/** One flat mark on the glass at a cell's floor. */
export const GlassMark = ({
  floor,
  shape,
  color,
  keyColor = '#140c06',
  keyAlpha = 0.45,
  radius,
  width = 0.04,
  opacity = 0.95,
  fill = 0,
  hovered = false,
  jewel,
  jewelRadius = 0,
  nest = false,
  steepFill = 1,
  growMs = 0,
  delayMs = 0,
  lift = 0.014,
  renderOrder = LAYER.marker,
  additive = false,
}: GlassMarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const quad = radius * (shape === 'capture' ? 2.5 : shape === 'crown' ? 2.6 : 2.4);
  const material = useMemo(() => markMaterial(additive), [additive]);
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uShape.value = SHAPE[shape];
  (u.uColor.value as Color).set(color);
  (u.uKey.value as Color).set(keyColor);
  (u.uJewel.value as Color).set(jewel ?? color);
  u.uJewelR.value = jewel ? jewelRadius : 0;
  u.uOpacity.value = opacity;
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uKeyAlpha.value = keyAlpha;
  u.uHover.value = hovered ? 1 : 0;
  u.uQuad.value = quad;

  // Grow in: a quick overshoot, like a drop of light landing
  const since = useRef(growMs > 0 ? -delayMs : Infinity);
  const grow = useRef(growMs > 0 ? 0.001 : 1);
  useEffect(() => invalidate(), [invalidate]);
  useFrame(({ camera, controls }, delta) => {
    if (since.current < growMs) {
      since.current += Math.min(delta, MAX_FRAME) * 1000;
      const k = Math.min(Math.max(since.current / growMs, 0), 1);
      const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
      grow.current = since.current < 0 ? 0.001 : Math.max(back, 0.001);
      invalidate();
    }
    // Seen from high above: nest when on another level, and thin the fill
    let scale = 1;
    let fillK = 1;
    if (nest || steepFill !== 1) {
      const steep = smooth(52 * DEG, 70 * DEG, elevationOf(camera, controls));
      const off = held.floor !== null && Math.abs(held.floor[1] - floor[1]) > 0.05;
      if (nest && off) scale = 1 - 0.35 * steep;
      fillK = 1 + (steepFill - 1) * steep;
    }
    u.uGrow.value = grow.current * scale;
    u.uFill.value = fill * fillK;
  });
  u.uFill.value = fill;
  u.uGrow.value = grow.current;

  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- ▲ / ▼ for a move straight up or down -------------------------------------------

const away = new Vector3();

/**
 * A small gilt triangle at the edge of the held piece's pool, pointing up
 * the screen (a move straight up a level is open) or down it (straight
 * down), drawn by a destination that stands directly above or below the
 * held piece. From high above such a destination hides behind the piece
 * itself; this says it is there. It fades out at low angles, where the
 * stacked levels show the move plainly.
 */
const VerticalTick = ({
  floor,
  gap,
  reach,
  size,
}: {
  floor: Vec3;
  gap: number;
  /** Distance from the held piece's centre to the tick. */
  reach: number;
  size: number;
}) => {
  const group = useRef<Group>(null);
  const material = useMemo(() => {
    const m = markMaterial();
    const u = m.uniforms;
    u.uShape.value = SHAPE.tick;
    (u.uColor.value as Color).set(GILT);
    (u.uKey.value as Color).set(GILT_DEEP);
    u.uRadius.value = size;
    u.uWidth.value = size * 0.2;
    u.uFill.value = 1;
    u.uKeyAlpha.value = 0.6;
    u.uQuad.value = size * 3;
    return m;
  }, [size]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera, controls }) => {
    const g = group.current;
    if (!g) return;
    const h = held.floor;
    const dy = h ? floor[1] - h[1] : 0;
    const vertical =
      h !== null &&
      Math.abs(floor[0] - h[0]) < 1e-3 &&
      Math.abs(floor[2] - h[2]) < 1e-3 &&
      Math.abs(Math.abs(dy) - gap) < gap * 0.25;
    const k = smooth(25 * DEG, 45 * DEG, elevationOf(camera, controls));
    g.visible = vertical && k > 0.01;
    if (!g.visible || !h) return;
    const t = (controls as { target?: Vector3 } | null)?.target ?? target.set(0, 0, 0);
    away.set(t.x - camera.position.x, 0, t.z - camera.position.z);
    if (away.lengthSq() < 1e-8) away.set(0, 0, -1);
    away.normalize();
    const sign = dy > 0 ? 1 : -1;
    g.position.set(h[0] + away.x * reach * sign, h[1] + 0.016, h[2] + away.z * reach * sign);
    // The triangle's tip (local +y, laid flat onto world -z) points away for
    // up and toward the camera for down
    g.rotation.set(0, Math.atan2(-away.x * sign, -away.z * sign), 0);
    material.uniforms.uOpacity.value = k;
    material.uniforms.uFill.value = k;
  });
  return (
    <group ref={group} visible={false}>
      <mesh
        geometry={planeFor(size * 3)}
        material={material}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker + 0.4}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- The selection's column of light ------------------------------------------------

const shaftVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const shaftFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  uniform float uHeight;
  uniform float uMaskTop;
  uniform float uFront;
  uniform float uOpenTop;
  uniform float uReveal;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    float h = vUv.y;
    // It falls from above: revealed from the top down as the piece is taken up
    if (h < 1.0 - uReveal) discard;
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 n = normalize(vNormalW);
    // A volume of lit dust: brightest where the view passes through most of
    // it (the middle), thinning softly to its edges
    float through = pow(abs(dot(n, view)), 0.9);
    // Soft where it meets the glass; under a platform it runs full height
    // from the glass above, and on the top level it fades out into the air
    float along = smoothstep(0.0, 0.08, h) * mix(0.78 + 0.22 * h, pow(1.0 - h, 1.2), uOpenTop);
    // Slow bands of brighter dust drifting down the beam
    float bands = 0.86 + 0.14 * sin(h * 14.0 + uTime * 0.9 + vUv.x * 12.566);
    // The near side of the beam never lies over the piece it lights
    float mask = uFront > 0.5 ? 0.35 * smoothstep(uMaskTop, uMaskTop + 0.1, h * uHeight) : 1.0;
    float a = uStrength * through * along * bands * mask;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const moteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uHeight;
  uniform float uRadius;
  attribute vec3 aSeed;
  varying float vAlpha;
  void main() {
    // Each mote drifts slowly down the beam, turning round its axis
    float t = uTime * (0.05 + 0.04 * aSeed.z) + aSeed.x;
    float h = fract(-t);
    float a = aSeed.y * 6.2831853 + uTime * 0.25 * (aSeed.z - 0.5);
    float rr = uRadius * (0.25 + 0.75 * fract(aSeed.x * 7.13));
    vec3 p = vec3(cos(a) * rr, h * uHeight, sin(a) * rr);
    vAlpha = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.6, h) * (0.55 + 0.45 * sin(uTime * 1.7 + aSeed.x * 30.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.022 + 0.018 * aSeed.z) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.9;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const SHAFT_RADIUS = 0.36;
const shaftGeometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 32, 1, true).translate(
  0,
  0.5,
  0,
);
const MOTES = 18;
const moteGeometry = (() => {
  const g = new BufferGeometry();
  const random = rng(17);
  const seeds = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES * 3; i++) seeds[i] = random();
  g.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
  g.setAttribute('aSeed', new BufferAttribute(seeds, 3));
  return g;
})();

const beamMaterial = (front: boolean) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: front ? FrontSide : BackSide,
    uniforms: {
      uColor: { value: new Color(SUNLIGHT) },
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uHeight: { value: 1 },
      uMaskTop: { value: 0 },
      uFront: { value: front ? 1 : 0 },
      uOpenTop: { value: 0 },
      uReveal: { value: 0 },
    },
    vertexShader: shaftVertex,
    fragmentShader: shaftFragment,
  });

/** Strength of the column at its heart. */
const BEAM = 0.95;

/**
 * A column of sunlight falling onto the selected piece: from the glass of
 * the platform above down to the piece's own, or, on the top level, out of
 * the air above it. Its far side glows behind the piece; its near side
 * shows only above the piece, so it never veils it, and motes of dust drift
 * slowly down it. It pours down from above as the piece is taken up.
 */
export const LightShaft = ({
  floor,
  height,
  open,
  maskTop,
}: {
  floor: Vec3;
  height: number;
  /** No platform above: the column fades out into the air. */
  open: boolean;
  /** Height above the floor below which the near side is not drawn. */
  maskTop: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const { back, front, motes } = useMemo(() => {
    const back = beamMaterial(false);
    const front = beamMaterial(true);
    for (const m of [back, front]) {
      m.uniforms.uHeight.value = height;
      m.uniforms.uMaskTop.value = maskTop;
      m.uniforms.uOpenTop.value = open ? 1 : 0;
    }
    const motes = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color('#fff1cf') },
        uTime: { value: 0 },
        uScale: { value: 400 },
        uHeight: { value: height },
        uRadius: { value: SHAFT_RADIUS * 0.9 },
      },
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
    });
    return { back, front, motes };
  }, [height, open, maskTop]);
  useEffect(
    () => () => {
      back.dispose();
      front.dispose();
      motes.dispose();
    },
    [back, front, motes],
  );
  const age = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((state, delta) => {
    age.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(age.current / 0.4, 1);
    const ease = 1 - (1 - k) ** 3;
    for (const m of [back, front]) {
      m.uniforms.uStrength.value = BEAM * (0.5 + 0.5 * ease);
      m.uniforms.uReveal.value = ease;
      m.uniforms.uTime.value = age.current;
    }
    motes.uniforms.uTime.value = age.current;
    const size = state.size.height * state.viewport.dpr;
    motes.uniforms.uScale.value = size / (2 * Math.tan((36 * Math.PI) / 360));
    // The dust keeps turning while the piece is held
    invalidate();
  });
  return (
    <group position={floor}>
      <mesh
        geometry={shaftGeometry}
        material={back}
        scale={[1, height, 1]}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
      />
      <mesh
        geometry={shaftGeometry}
        material={front}
        scale={[1, height, 1]}
        renderOrder={LAYER.trace + 0.55}
        raycast={noRaycast}
      />
      <points
        geometry={moteGeometry}
        material={motes}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

// --- The circlet over a king in check -------------------------------------------------

const circletGeometry = (() => {
  const parts: BufferGeometry[] = [new TorusGeometry(0.17, 0.013, 6, 40).rotateX(Math.PI / 2)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(
      new ConeGeometry(0.024, 0.085, 5).translate(Math.cos(a) * 0.17, 0.042, Math.sin(a) * 0.17),
    );
  }
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  return merged;
})();

const circletMaterial = new MeshBasicMaterial({ color: RUBY, toneMapped: false, fog: false });

/** A small, still circlet of ruby light floating over the king's cross. */
const Circlet = ({ floor, height }: { floor: Vec3; height: number }) => (
  <mesh
    geometry={circletGeometry}
    material={circletMaterial}
    position={[floor[0], floor[1] + height, floor[2]]}
    raycast={noRaycast}
  />
);

// --- The set -------------------------------------------------------------------------

export interface MarkerSetOptions {
  pitch: number;
  /** Height of the air between one platform and the next (for the shaft). */
  gap: number;
  /** World height of each level's surface, A to E. */
  levelY: number[];
  /** How long a move glides (the last move's marks wait for it to land). */
  moveMs: number;
  /** The pieces' scale (for clearing the tallest piece). */
  pieceScale: number;
  /** How far the held piece rises (world units). */
  heldLift: number;
}

export const makeMarkers = ({
  pitch,
  gap,
  levelY,
  moveMs,
  pieceScale,
  heldLift,
}: MarkerSetOptions) => {
  const QUATREFOIL = 0.36 * pitch;
  const CAPTURE = 0.46 * pitch;
  const ROSETTE = 0.39 * pitch;
  const JEWEL = 0.07 * pitch;
  const POOL = 0.42 * pitch;
  const kingTop = pieceTop(pieceSet(), PieceType.King) * pieceScale;
  const levelAt = (y: number) => {
    let best = 0;
    levelY.forEach((ly, z) => {
      if (Math.abs(ly - y) < Math.abs(levelY[best] - y)) best = z;
    });
    return best;
  };
  const tick = (floor: Vec3) => (
    <VerticalTick floor={floor} gap={gap} reach={POOL + 0.1 * pitch} size={0.075 * pitch} />
  );

  /** A legal destination: a gilt quatrefoil with its level's jewel at the heart. */
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <>
      <GlassMark
        floor={floor}
        shape="quatrefoil"
        color={GILT}
        keyColor={GILT_DEEP}
        radius={QUATREFOIL}
        width={0.05 * pitch}
        fill={0.16}
        hovered={hovered}
        jewel={LEVEL[levelAt(floor[1])]}
        jewelRadius={JEWEL}
        nest
      />
      {tick(floor)}
    </>
  );

  /** A capture: the quatrefoil in ruby glass, opened round the victim, with four thorns. */
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <>
      <GlassMark
        floor={floor}
        shape="capture"
        color={RUBY}
        keyColor={RUBY_DEEP}
        radius={CAPTURE}
        width={0.052 * pitch}
        fill={0.2}
        hovered={hovered}
        jewel={LEVEL[levelAt(floor[1])]}
        jewelRadius={JEWEL}
        nest
      />
      {tick(floor)}
    </>
  );

  /**
   * The selection: a column of sunlight falls on the piece, pooling round
   * its base inside a crisp sunlit ring, the brightest mark on the board.
   * From above the pool keeps only its ring, so what lies under it shows.
   */
  const Selection = ({ floor }: MarkerProps) => {
    const token = useRef({});
    useLayoutEffect(() => {
      const me = token.current;
      held.floor = floor;
      held.owner = me;
      return () => {
        if (held.owner === me) {
          held.floor = null;
          held.owner = null;
        }
      };
    }, [floor]);
    const top = levelAt(floor[1]) === levelY.length - 1;
    return (
      <>
        <GlassMark
          floor={floor}
          shape="pool"
          color={SUNLIGHT}
          radius={POOL}
          opacity={0}
          fill={0.42}
          keyAlpha={0}
          steepFill={0.12}
          growMs={320}
          renderOrder={LAYER.shadow + 0.5}
          lift={0.008}
        />
        <GlassMark
          floor={floor}
          shape="ring"
          color="#fff2cc"
          keyColor="#3a2508"
          radius={POOL}
          width={0.035 * pitch}
          opacity={1}
          fill={0.9}
          keyAlpha={0.5}
          growMs={320}
          renderOrder={LAYER.marker + 0.3}
          lift={0.016}
        />
        <LightShaft
          floor={floor}
          height={top ? 1.6 : gap - 0.02}
          open={top}
          maskTop={kingTop * 1.1 + heldLift}
        />
      </>
    );
  };

  /**
   * The last move: an ivory rosette on the square it left and on the square
   * it reached, joined by a thin thread of candlelight from centre to
   * centre. A fresh move draws its thread in behind the gliding piece, and
   * the destination's rosette blooms as it lands. A move straight up or
   * down draws its origin wider than its arrival, so from above both show.
   */
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
    const vertical =
      Math.abs(from.floor[0] - to.floor[0]) < 1e-3 && Math.abs(from.floor[2] - to.floor[2]) < 1e-3;
    return (
      <>
        <GlassMark
          floor={from.floor}
          shape="rosette"
          color={IVORY}
          keyColor="#2a1d10"
          radius={vertical ? 0.47 * pitch : ROSETTE * 0.78}
          width={0.028 * pitch}
          opacity={vertical ? 0.8 : 0.62}
          fill={0.07}
          keyAlpha={0.3}
        />
        <GlassMark
          floor={to.floor}
          shape="rosette"
          color={IVORY}
          keyColor="#2a1d10"
          radius={ROSETTE}
          width={0.032 * pitch}
          opacity={0.88}
          fill={0.05}
          keyAlpha={0.3}
          growMs={fresh ? 320 : 0}
          delayMs={moveMs * 0.85}
        />
        <LastMoveLine
          from={from.floor}
          to={to.floor}
          arc={arc}
          color={IVORY}
          pulseColor="#fff7e2"
          radius={0.013}
          opacity={0.9}
          shade={0.3}
          pulse={0.55}
          pulseLength={0.35}
          flowSpeed={0.45}
          outline="#3a2a18"
          outlineWidth={0.006}
          drawInMs={fresh ? moveMs * 0.9 : 0}
        />
      </>
    );
  };

  /**
   * Check: the king's square turns to ruby glass inside a crown of red light,
   * and a small circlet of the same light floats over his cross, clear of
   * every piece in front, from any seat and any angle.
   */
  const Check = ({ floor }: MarkerProps) => (
    <>
      <GlassMark
        floor={floor}
        shape="pane"
        color={RUBY}
        radius={0.47 * pitch}
        opacity={0}
        fill={0.28}
        keyAlpha={0}
        renderOrder={LAYER.shadow + 0.4}
        lift={0.006}
      />
      <GlassMark
        floor={floor}
        shape="crown"
        color={RUBY}
        keyColor={RUBY_DEEP}
        radius={0.4 * pitch}
        width={0.045 * pitch}
        opacity={1}
        keyAlpha={0.5}
        growMs={420}
      />
      <Circlet floor={floor} height={kingTop + heldLift + 0.06} />
    </>
  );

  return { Quiet, Capture, Selection, LastMove, Check };
};
