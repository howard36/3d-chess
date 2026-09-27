import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';
import type { Sprite, SpriteMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { ribbonData, tracePath } from '../kit/markerGeometry';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CHECK_RED, CHERRY, INK, MINT, PIECE_SCALE, pitch, SPARKLE, SUNFLOWER } from './palette';

// Stickers: every marker is a die-cut candy sticker lying flat on the glass,
// a rounded outline in one gameplay colour with a dark ink border (so it
// reads on sky, glass, cream or navy) and a glossy highlight down the middle
// of its stroke, like a candy rope. One shape, four meanings:
// - mint: the selected piece can go here;
// - the same sticker in cherry red, with four teeth biting inward: it can
//   take here;
// - sunflower: the last move's two squares, joined by a striped candy path
//   with an arrowhead;
// - red and filled, with a "!" badge over the king: check.
// A sticker pops onto the glass when it appears (a quick overshoot) and then
// holds perfectly still.

const stickerVertex = /* glsl */ `
  varying vec2 vP;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const stickerFragment = /* glsl */ `
  uniform int uShape;
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHalf;
  uniform float uLine;
  uniform float uInkWidth;
  uniform float uRadius;
  uniform float uRing;
  uniform float uTeeth;
  uniform float uHover;
  uniform float uPop;
  uniform float uDash;
  varying vec2 vP;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  // Isosceles triangle, tip at the origin, base (half width q.x) at height q.y
  float tri(vec2 p, vec2 q) {
    p.x = abs(p.x);
    vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    float s = -sign(q.y);
    vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
  }
  vec4 over(vec4 top, vec4 bottom) {
    float a = top.a + bottom.a * (1.0 - top.a);
    vec3 c = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(a, 1e-4);
    return vec4(c, a);
  }

  void main() {
    vec2 p = vP / max(uPop, 1e-3);
    float shape = uShape == 1 ? length(p) - uRing : roundBox(p, uHalf, uRadius);
    float stroke = abs(shape) - uLine * 0.5;
    if (uDash > 0.0) {
      // Dashes round the outline (for the square a piece left)
      float f = fract(atan(p.y, p.x) / 6.2831853 * uDash + 0.125);
      float gap = abs(f - 0.5) * 2.0;
      stroke = max(stroke, (0.42 - gap) * uHalf * 0.8);
    }
    if (uTeeth > 0.5) {
      // Four teeth biting in from the middle of each side
      vec2 q = abs(p);
      float depth = uHalf * 0.46;
      vec2 size = vec2(uHalf * 0.26, depth + uLine * 0.5);
      float tx = tri(vec2(q.y, q.x - (uHalf - depth)), size);
      float ty = tri(vec2(q.x, q.y - (uHalf - depth)), size);
      stroke = min(stroke, min(tx, ty));
    }
    float inkShape = stroke - uInkWidth;
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float ink = 1.0 - smoothstep(-aa, aa, inkShape);
    float area = 1.0 - smoothstep(-aa, aa, shape);
    // Candy-rope gloss: lighter down the middle of the stroke
    float mid = clamp(-stroke / (uLine * 0.5), 0.0, 1.0);
    vec3 col = uColor * (1.0 + 0.2 * uHover);
    col = mix(col, vec3(1.0), 0.38 * mid * mid);
    vec4 c = vec4(uColor, area * (uFill + 0.1 * uHover));
    c = over(vec4(uInk, ink * 0.9), c);
    c = over(vec4(col, line), c);
    c.a *= uOpacity;
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

const quad = new PlaneGeometry(1, 1);
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

interface StickerStyle {
  shape?: 'square' | 'ring';
  color: string;
  opacity?: number;
  fill?: number;
  /** Stroke width, as a fraction of the pitch. */
  line?: number;
  inset?: number;
  radius?: number;
  ring?: number;
  teeth?: boolean;
  dashes?: number;
  hovered?: boolean;
  /** Pop onto the glass when first shown. */
  pop?: boolean;
  lift?: number;
}

/** A sticker lying on the glass at a cell's floor. */
export const Sticker = ({
  floor,
  shape = 'square',
  color,
  opacity = 1,
  fill = 0,
  line = 0.085,
  inset = 0.11,
  radius = 0.16,
  ring = 0.34,
  teeth = false,
  dashes = 0,
  hovered = false,
  pop = true,
  lift = 0.012,
}: StickerStyle & { floor: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const age = useRef(pop ? 0 : 1);
  const hover = useRef(hovered ? 1 : 0);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uShape: { value: 0 },
          uColor: { value: new Color() },
          uInk: { value: new Color(INK) },
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uQuad: { value: pitch },
          uHalf: { value: 0.4 },
          uLine: { value: 0.07 },
          uInkWidth: { value: 0.022 * pitch },
          uRadius: { value: 0.12 },
          uRing: { value: 0.34 },
          uTeeth: { value: 0 },
          uHover: { value: 0 },
          uPop: { value: 1 },
          uDash: { value: 0 },
        },
        vertexShader: stickerVertex,
        fragmentShader: stickerFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  const lw = line * pitch;
  const half = pitch / 2 - inset * pitch - lw / 2 - 0.022 * pitch;
  u.uShape.value = shape === 'ring' ? 1 : 0;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uHalf.value = half;
  u.uLine.value = lw;
  u.uRadius.value = Math.min(radius * pitch, half);
  u.uRing.value = ring * pitch;
  u.uTeeth.value = teeth ? 1 : 0;
  u.uDash.value = dashes;

  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    let moving = false;
    if (age.current < 1) {
      age.current = Math.min(1, age.current + dt / 0.26);
      moving = true;
    }
    const goal = hovered ? 1 : 0;
    if (hover.current !== goal) {
      const step = dt / 0.12;
      hover.current =
        goal > hover.current
          ? Math.min(goal, hover.current + step)
          : Math.max(goal, hover.current - step);
      moving = true;
    }
    u.uPop.value = (0.55 + 0.45 * easeOutBack(age.current)) * (1 + 0.06 * hover.current);
    u.uHover.value = hover.current;
    if (moving) invalidate();
  });

  return (
    <mesh
      geometry={quad}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[pitch, pitch, 1]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- Destinations -------------------------------------------------------------------

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Sticker floor={floor} color={MINT} fill={0.07} hovered={hovered} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Sticker floor={floor} color={CHERRY} fill={0.1} teeth hovered={hovered} />
);

// --- Selection: a sparkle ring ------------------------------------------------------

const sparkleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform vec3 uGlint;
  uniform float uRing;
  uniform float uLine;
  uniform float uTime;
  uniform float uPop;
  varying vec2 vP;
  float star(vec2 p, float r) {
    // A four-pointed twinkle: thin where both coordinates are large
    p = abs(p);
    return pow(p.x, 0.55) + pow(p.y, 0.55) - pow(r, 0.55);
  }
  vec4 over(vec4 top, vec4 bottom) {
    float a = top.a + bottom.a * (1.0 - top.a);
    vec3 c = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(a, 1e-4);
    return vec4(c, a);
  }
  void main() {
    vec2 p = vP / max(uPop, 1e-3);
    float r = length(p);
    float stroke = abs(r - uRing) - uLine * 0.5;
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float ink = 1.0 - smoothstep(-aa, aa, stroke - uLine * 0.32);
    float mid = clamp(-stroke / (uLine * 0.5), 0.0, 1.0);
    // A soft pool of light inside the ring
    float pool = (1.0 - smoothstep(uRing * 0.2, uRing, r)) * 0.3;
    vec4 c = vec4(uColor, pool);
    c = over(vec4(uInk, ink * 0.85), c);
    c = over(vec4(mix(uColor, vec3(1.0), 0.3 * mid), line), c);
    // Six twinkles circling slowly just outside the ring
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float a = uTime * 0.55 + fi * 1.0471976;
      vec2 at = vec2(cos(a), sin(a)) * (uRing + uLine * 1.9);
      float tw = 0.55 + 0.45 * sin(uTime * 2.2 + fi * 2.3);
      float s = star(p - at, 0.07 * tw);
      float sa = fwidth(s);
      float glint = 1.0 - smoothstep(-sa, sa, s);
      c = over(vec4(uGlint, glint * (0.6 + 0.4 * tw)), c);
    }
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

const selectQuad = new PlaneGeometry(1, 1);

export const Selection = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const age = useRef(0);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color(SPARKLE) },
          uInk: { value: new Color(INK) },
          uGlint: { value: new Color('#fff6c8') },
          uRing: { value: 0.35 * pitch },
          uLine: { value: 0.07 * pitch },
          uTime: { value: 0 },
          uPop: { value: 1 },
          uQuad: { value: pitch * 1.1 },
        },
        vertexShader: stickerVertex,
        fragmentShader: sparkleFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const stars = useRef<(Sprite | null)[]>([]);
  useFrame((state, delta) => {
    age.current = Math.min(1, age.current + Math.min(delta, 1 / 30) / 0.3);
    const pop = 0.5 + 0.5 * easeOutBack(age.current);
    const t = state.clock.elapsedTime;
    material.uniforms.uPop.value = pop;
    material.uniforms.uTime.value = t;
    // Sticker stars circling the lifted toy, each on its own height and beat
    STARS.forEach(([phase, height, radius, size], i) => {
      const s = stars.current[i];
      if (!s) return;
      const a = t * 0.9 + phase;
      s.position.set(
        floor[0] + Math.cos(a) * radius * pitch,
        floor[1] + height * pop,
        floor[2] + Math.sin(a) * radius * pitch,
      );
      const twinkle = 0.75 + 0.25 * Math.sin(t * 2.6 + phase * 3);
      s.scale.setScalar(size * twinkle * Math.min(1, age.current * 1.6));
      (s.material as SpriteMaterial).rotation = Math.sin(t * 1.3 + phase) * 0.35;
    });
    invalidate();
  });
  return (
    <>
      <mesh
        geometry={selectQuad}
        material={material}
        position={[floor[0], floor[1] + 0.014, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[pitch * 1.1, pitch * 1.1, 1]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
      {STARS.map((_, i) => (
        <sprite
          key={i}
          ref={(s) => {
            stars.current[i] = s;
          }}
          scale={0.0001}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        >
          <spriteMaterial map={starTexture()} depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
};

// Phase, height above the floor, orbit radius, size
const STARS: [number, number, number, number][] = [
  [0, 0.22, 0.44, 0.25],
  [1.3, 0.52, 0.4, 0.2],
  [2.5, 0.34, 0.46, 0.23],
  [3.8, 0.64, 0.38, 0.18],
  [5.0, 0.12, 0.44, 0.2],
];

/** A cartoon five-pointed sticker star: warm white, ink border, a gloss dot. */
const starTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const h = size / 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? h * 0.8 : h * 0.38;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r * 0.98 + 3);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#fff0a8';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(h - 8, h - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
})();

// --- Last move: a striped candy path ------------------------------------------------

const traceVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aHalf;
  attribute float aAlong;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * aHalf;
    vAcross = aSide * aHalf;
    vHalf = aHalf;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const traceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uStripe;
  uniform vec3 uInk;
  uniform float uInkWidth;
  uniform float uPeriod;
  uniform float uShaftEnd;
  uniform float uReveal;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    if (vAlong > uReveal) discard;
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float rim = smoothstep(vHalf - uInkWidth - aa, vHalf - uInkWidth + aa, d);
    vec3 col = uColor;
    if (vAlong < uShaftEnd - uPeriod * 0.3) {
      // Candy stripes bent into chevrons, all pointing the way the piece went
      float phase = fract((vAlong - d * 1.4) / uPeriod);
      float ab = max(fwidth(phase), 1e-4);
      float stripe = smoothstep(0.0, ab, phase) * (1.0 - smoothstep(0.4 - ab, 0.4, phase));
      col = mix(col, uStripe, stripe);
    } else {
      // The arrowhead: glossy, lighter toward its centre line
      col = mix(col, vec3(1.0), 0.25 * (1.0 - clamp(d / max(vHalf, 1e-4), 0.0, 1.0)));
    }
    col = mix(col, uInk, rim);
    if (body < 0.004) discard;
    gl_FragColor = vec4(col, body);
    #include <colorspace_fragment>
  }`;

const TRACE = { width: 0.13, headLength: 0.42, headWidth: 0.46 };

export const CandyPath = ({ from, to }: { from: Vec3; to: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const key = JSON.stringify([from, to]);
  const { geometry, length, shaftEnd } = useMemo(() => {
    const data = ribbonData(tracePath(from, to, { arc: 0.5, endInset: 0.4, lift: 0.05 }), TRACE);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('aTangent', new BufferAttribute(data.tangent, 3));
    g.setAttribute('aSide', new BufferAttribute(data.side, 1));
    g.setAttribute('aHalf', new BufferAttribute(data.halfWidth, 1));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(data.index);
    g.computeBoundingSphere();
    return {
      geometry: g,
      length: data.length,
      shaftEnd: data.length - Math.min(TRACE.headLength, data.length * 0.6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(SUNFLOWER) },
          uStripe: { value: new Color('#fff4c4') },
          uInk: { value: new Color(INK) },
          uInkWidth: { value: 0.028 },
          uPeriod: { value: 0.3 },
          uShaftEnd: { value: 1 },
          uReveal: { value: 0 },
        },
        vertexShader: traceVertex,
        fragmentShader: traceFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uShaftEnd.value = shaftEnd;
  // The path draws itself from the square left to the square reached, once
  const drawn = useRef({ key: '', t: 0 });
  useFrame((_, delta) => {
    const d = drawn.current;
    if (d.key !== key) {
      d.key = key;
      d.t = 0;
    }
    if (d.t >= 1) return;
    d.t = Math.min(1, d.t + Math.min(delta, 1 / 30) / 0.42);
    const e = 1 - (1 - d.t) ** 3;
    material.uniforms.uReveal.value = d.t >= 1 ? length + 1 : e * length;
    invalidate();
  });
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

export const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    <Sticker floor={from.floor} color={SUNFLOWER} fill={0.06} dashes={12} pop={false} />
    <Sticker floor={to.floor} color={SUNFLOWER} fill={0.12} pop={false} />
    <CandyPath from={from.floor} to={to.floor} />
  </>
);

// --- Check --------------------------------------------------------------------------

/** A red speech bubble with a white "!", drawn once. */
const alertTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const w = 128;
    const h = 160;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const bubble = () => {
      ctx.beginPath();
      ctx.roundRect(14, 10, w - 28, h - 58, 34);
      ctx.moveTo(w / 2 - 16, h - 50);
      ctx.lineTo(w / 2, h - 22);
      ctx.lineTo(w / 2 + 16, h - 50);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    bubble();
    ctx.lineWidth = 14;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = CHECK_RED;
    ctx.fill();
    // Gloss
    ctx.save();
    bubble();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(14, 10, w - 28, 30);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 84px "Fredoka", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', w / 2, 58);
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
})();

const BADGE_HEIGHT = 0.86 * PIECE_SCALE + 0.2;

export const Check = ({ floor }: MarkerProps) => {
  const badge = useRef<Sprite>(null);
  return (
    <>
      <Sticker floor={floor} color={CHECK_RED} fill={0.26} line={0.09} inset={0.07} />
      <Sticker floor={floor} shape="ring" ring={0.31} line={0.05} color={CHECK_RED} lift={0.016} />
      <sprite
        ref={badge}
        position={[floor[0], floor[1] + BADGE_HEIGHT, floor[2]]}
        scale={[0.4, 0.5, 1]}
        center={[0.5, 0]}
        renderOrder={LAYER.label}
        raycast={noRaycast}
      >
        <spriteMaterial
          map={alertTexture()}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </sprite>
    </>
  );
};
