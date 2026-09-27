import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Sprite, SpriteMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import {
  CHECK_RED,
  CHERRY,
  INK,
  MINT,
  ORCHID,
  PIECE_SCALE,
  pitch,
  SPARKLE,
  SUNFLOWER,
} from './palette';

// Stickers: every marker is a die-cut candy sticker lying flat on the glass,
// a rounded outline in one gameplay colour with a dark ink border (so it
// reads on sky, glass, cream or navy) and a glossy highlight down the middle
// of its stroke, like a candy rope. One shape, four meanings:
// - mint: the selected piece can go here;
// - the same sticker in cherry red, with four teeth biting in from its sides
//   (they stop short of the victim's base, so they show): it can take here;
// - sunflower: the last move's two squares, joined by a board-game path of
//   glossy beads running straight from square to square;
// - red and filled, with a "!" bubble beside the king: check.
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
    // Under the pointer the stroke thickens a little
    float line = uLine * (1.0 + 0.3 * uHover);
    float stroke = abs(shape) - line * 0.5;
    if (uDash > 0.0) {
      // Dashes round the outline (for the square a piece left)
      float f = fract(atan(p.y, p.x) / 6.2831853 * uDash + 0.125);
      float gap = abs(f - 0.5) * 2.0;
      stroke = max(stroke, (0.42 - gap) * uHalf * 0.8);
    }
    if (uTeeth > 0.5) {
      // Four teeth biting in from the middle of each side, stopping short of
      // a piece's base so they show round the victim
      vec2 q = abs(p);
      float depth = uHalf * 0.3;
      vec2 size = vec2(uHalf * 0.24, depth + line * 0.5);
      float tx = tri(vec2(q.y, q.x - (uHalf - depth)), size);
      float ty = tri(vec2(q.x, q.y - (uHalf - depth)), size);
      stroke = min(stroke, min(tx, ty));
    }
    float inkShape = stroke - uInkWidth;
    float aa = max(fwidth(stroke), 1e-4);
    float body = 1.0 - smoothstep(-aa, aa, stroke);
    float ink = 1.0 - smoothstep(-aa, aa, inkShape);
    float area = 1.0 - smoothstep(-aa, aa, shape);
    // Candy-rope gloss: lighter down the middle of the stroke
    float mid = clamp(-stroke / (line * 0.5), 0.0, 1.0);
    vec3 col = uColor * (1.0 + 0.25 * uHover);
    col = mix(col, vec3(1.0), 0.38 * mid * mid);
    vec4 c = vec4(uColor, area * (uFill + 0.2 * uHover));
    c = over(vec4(uInk, ink * 0.9), c);
    c = over(vec4(col, body), c);
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
    u.uPop.value = (0.55 + 0.45 * easeOutBack(age.current)) * (1 + 0.07 * hover.current);
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

// A capture's sticker reaches a little further out than a quiet one, so it
// shows well clear of the victim standing on it
export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Sticker floor={floor} color={CHERRY} fill={0.1} inset={0.075} teeth hovered={hovered} />
);

// --- Selection: a sparkle ring ------------------------------------------------------

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform float uRing;
  uniform float uLine;
  uniform float uPop;
  varying vec2 vP;
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
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

/** Sticker-sparkle textures, drawn once: a white five-point star, and a pink twinkle. */
const sparkTextures = (() => {
  let made: { star: CanvasTexture; twinkle: CanvasTexture } | null = null;
  const canvas = (draw: (ctx: CanvasRenderingContext2D, h: number) => void) => {
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.lineJoin = 'round';
    draw(ctx, size / 2);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  const points = (
    ctx: CanvasRenderingContext2D,
    h: number,
    n: number,
    outer: number,
    inner: number,
  ) => {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? h * outer : h * inner;
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      ctx.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r + (n === 5 ? 3 : 0));
    }
    ctx.closePath();
  };
  return () => {
    made ??= {
      star: canvas((ctx, h) => {
        points(ctx, h, 5, 0.8, 0.38);
        ctx.lineWidth = 9;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = SPARKLE;
        ctx.fill();
        ctx.fillStyle = ORCHID;
        ctx.beginPath();
        ctx.arc(h + 7, h + 6, 5, 0, Math.PI * 2);
        ctx.fill();
      }),
      twinkle: canvas((ctx, h) => {
        points(ctx, h, 4, 0.85, 0.2);
        ctx.lineWidth = 8;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = ORCHID;
        ctx.fill();
      }),
    };
    return made;
  };
})();

// Sparkles round a picked-up toy: phase, height above the floor, orbit
// radius, size, and whether it is a pink twinkle. Every one stays within
// 0.45 of the piece's axis, inside its own square.
const SPARKS: [number, number, number, number, boolean][] = [
  [0, 0.24, 0.34, 0.2, false],
  [1.25, 0.56, 0.32, 0.12, true],
  [2.5, 0.38, 0.35, 0.18, false],
  [3.75, 0.66, 0.3, 0.1, true],
  [5.0, 0.16, 0.34, 0.16, false],
];

export const Selection = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const age = useRef(0);
  const sparks = useRef<(Sprite | null)[]>([]);
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
          uRing: { value: 0.35 * pitch },
          uLine: { value: 0.07 * pitch },
          uPop: { value: 1 },
          uQuad: { value: pitch },
        },
        vertexShader: stickerVertex,
        fragmentShader: ringFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const textures = sparkTextures();
  useFrame((state, delta) => {
    age.current = Math.min(1, age.current + Math.min(delta, 1 / 30) / 0.3);
    const pop = 0.5 + 0.5 * easeOutBack(age.current);
    const t = state.clock.elapsedTime;
    material.uniforms.uPop.value = pop;
    // Sparkles circling the lifted toy, each on its own height and beat
    SPARKS.forEach(([phase, height, radius, size], i) => {
      const s = sparks.current[i];
      if (!s) return;
      const a = t * 0.9 + phase;
      s.position.set(
        floor[0] + Math.cos(a) * radius * pitch,
        floor[1] + height * pop,
        floor[2] + Math.sin(a) * radius * pitch,
      );
      const twinkle = 0.78 + 0.22 * Math.sin(t * 2.6 + phase * 3);
      s.scale.setScalar(size * twinkle * Math.min(1, age.current * 1.6));
      (s.material as SpriteMaterial).rotation = Math.sin(t * 1.3 + phase) * 0.35;
    });
    invalidate();
  });
  return (
    <>
      <mesh
        geometry={quad}
        material={material}
        position={[floor[0], floor[1] + 0.014, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[pitch, pitch, 1]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
      {SPARKS.map(([, , , , pink], i) => (
        <sprite
          key={i}
          ref={(s) => {
            sparks.current[i] = s;
          }}
          scale={0.0001}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        >
          <spriteMaterial
            map={pink ? textures.twinkle : textures.star}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  );
};

// --- Last move: a board-game path ----------------------------------------------------

/**
 * The last move: sunflower stickers on both squares, joined by a row of
 * glossy candy beads, like the spaces of a board-game path, running straight
 * from square to square and drifting slowly toward the destination. A live
 * move lays the beads down one by one from the square the piece left.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Sticker floor={from.floor} color={SUNFLOWER} fill={0.06} dashes={12} pop={false} />
    <Sticker floor={to.floor} color={SUNFLOWER} fill={0.12} pop={fresh} />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      pattern="dotted"
      color={SUNFLOWER}
      beadRadius={0.042}
      spacing={0.17}
      shade={0.4}
      flowSpeed={0.22}
      drawInMs={fresh ? 420 : 0}
    />
  </>
);

// --- Check --------------------------------------------------------------------------

// A mated king's square, while its Celebration is up: the check bubble
// there gives way to the mate badge. Set and cleared by the Celebration.
const mated = new Set<string>();
const mateListeners = new Set<() => void>();
const floorKey = (floor: Vec3) => floor.map((v) => v.toFixed(3)).join(',');
export const markMated = (floor: Vec3, on: boolean) => {
  if (on) mated.add(floorKey(floor));
  else mated.delete(floorKey(floor));
  mateListeners.forEach((l) => l());
};
const subscribeMated = (l: () => void) => {
  mateListeners.add(l);
  return () => mateListeners.delete(l);
};
const useMated = (floor: Vec3) => {
  const key = floorKey(floor);
  return useSyncExternalStore(subscribeMated, () => mated.has(key));
};

/** A speech bubble in ink and a fill colour, drawn once per `key`. */
export const bubbleTexture = (() => {
  const made = new Map<string, CanvasTexture>();
  return (key: string, fill: string, draw: (ctx: CanvasRenderingContext2D, w: number) => void) => {
    const cached = made.get(key);
    if (cached) return cached;
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
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    bubble();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(14, 10, w - 28, 30);
    ctx.restore();
    draw(ctx, w);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    made.set(key, t);
    return t;
  };
})();

const drawBang = (ctx: CanvasRenderingContext2D, w: number) => {
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 84px "Fredoka", "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', w / 2, 58);
};

const right = new Vector3();

/**
 * A bubble beside a king's head, on the camera's right, low enough to stay
 * under the level above and tested against depth, so it never covers a
 * piece standing in front of it.
 */
export const KingBubble = ({
  floor,
  map,
  size = 1,
}: {
  floor: Vec3;
  map: CanvasTexture;
  size?: number;
}) => {
  const sprite = useRef<Sprite>(null);
  useFrame(({ camera }) => {
    const s = sprite.current;
    if (!s) return;
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    s.position.set(floor[0] + right.x * 0.33, floor[1] + BUBBLE_HEIGHT, floor[2] + right.z * 0.33);
  });
  return (
    <sprite
      ref={sprite}
      position={[floor[0], floor[1] + BUBBLE_HEIGHT, floor[2]]}
      scale={[0.3 * size, 0.375 * size, 1]}
      center={[0.5, 0]}
      renderOrder={LAYER.label}
      raycast={noRaycast}
    >
      <spriteMaterial map={map} depthWrite={false} toneMapped={false} />
    </sprite>
  );
};

// The bubble's foot sits at the king's shoulder; its top stays well under the level above
const BUBBLE_HEIGHT = 0.55 * PIECE_SCALE;

export const Check = ({ floor }: MarkerProps) => {
  const isMated = useMated(floor);
  return (
    <>
      <Sticker floor={floor} color={CHECK_RED} fill={0.26} line={0.09} inset={0.07} />
      <Sticker floor={floor} shape="ring" ring={0.31} line={0.05} color={CHECK_RED} lift={0.016} />
      {!isMated && <KingBubble floor={floor} map={bubbleTexture('check', CHECK_RED, drawBang)} />}
    </>
  );
};
