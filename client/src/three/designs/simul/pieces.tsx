import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Group, Mesh, Points } from 'three';
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { PALETTE, PIECE_SCALE } from './palette';
import { steepness } from './plates';

// The armies: turned ivory and ebony, lit like a tournament hall at night.
// Ivory is warm and softly lit; ebony is a deep brown wood, clearly dark,
// with a restrained warm-grey edge that shows its form without ever paling
// it toward the ivory. The foot is the piece's own wood (no ring of level
// colour at the base: the platforms, letters and markers say the level),
// and a soft contact shadow grounds it on its board.
//
// Under the pointer a piece lifts a little and warms, as if a lamp had
// turned toward it, and a faint glow of that lamp falls round its foot.
// Picked up, the lamp comes on: a pool of warm light blooms on the board
// under it, edged by a fine hexagon (a nod to Lumen's), a ring of light
// breathes out once from it, and a soft halo rises behind the piece and
// settles. Put down (or when another piece is picked up) both fade away.
// In check, the king is lit from below by the red of its square.

/** The lights, in world space: Stage's CameraRig keeps them with the camera. */
export const rig = {
  key: { value: new Vector3(-0.4, 0.75, 0.55).normalize() },
  fill: { value: new Vector3(0.6, 0.1, 0.5).normalize() },
};

// --- The wood shader ----------------------------------------------------------------

// One small shader for every part of every piece, instead of the standard
// PBR material: the review machine renders in software, where a standard
// material is slow to compile and to draw. It lights a piece as the hall's
// rig would (a soft warm key over the camera's left shoulder, a dim neutral
// fill low on its right, a warm hemisphere), adds a broad highlight that
// shows the turning, and edges the silhouette in the army's own light.

const woodVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vY = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const woodFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform vec3 uLamp;
  uniform vec3 uCheckColor;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uSpec;
  uniform float uShine;
  uniform float uSelf;
  uniform float uTop;
  uniform float uWarm;
  uniform float uCheck;
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    float h = clamp(vY / uTop, 0.0, 1.0);
    // Deeper toward the base, as turned wood darkens where it is handled least
    vec3 albedo = mix(uBase, uColor, smoothstep(0.02, 0.45, vY));
    float key = max(dot(n, uKey), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    // The lamp: under the pointer (and held) a warm light turns toward the
    // piece from the key's side
    vec3 light = uKeyColor * key * (1.0 + 0.45 * uWarm) + uFillColor * fill + hemi;
    light += uLamp * uWarm * (0.12 + 0.3 * key);
    vec3 col = albedo * light + albedo * uSelf;
    // A broad highlight, never a mirror
    vec3 hv = normalize(uKey + v);
    col += uKeyColor * pow(max(dot(n, hv), 0.0), uShine) * uSpec * key;
    // The army's edge light; from above a turned piece is nearly all edge to
    // this term, so it gives way there and the army keeps its own value
    float rim = pow(1.0 - abs(dot(n, v)), uRimPower);
    float fromAbove = mix(1.0, 0.35, smoothstep(0.55, 0.95, abs(v.y)));
    col = mix(col, uRim, clamp(uRimMix * rim * fromAbove, 0.0, 1.0));
    // In check, a thin red edge round the crown, and the foot caught by the
    // red of the king's square (only the foot: on ebony even a little red
    // light over the whole body would turn it wine-red)
    float low = 1.0 - smoothstep(0.0, 0.22, h);
    float under = 0.45 + 0.55 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
    col += uCheckColor * uCheck * low * under * 0.1;
    float crown = rim * smoothstep(0.55, 0.8, h) * fromAbove;
    col = mix(col, uCheckColor, clamp(uCheck * crown * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The hall's lights as the wood sees them, in three's physical units: a
// light's colour times its intensity, over pi for a matte surface
const lit = (hex: string, intensity: number) => new Color(hex).multiplyScalar(intensity / Math.PI);
const LIGHTS = {
  uKeyColor: { value: lit('#fff0dc', 2.3) },
  uFillColor: { value: lit('#cfc8d8', 0.5) },
  uSky: { value: lit('#eadcc6', 0.62) },
  uGround: { value: lit('#3a2a1e', 0.62) },
  uLamp: { value: lit(PALETTE.lamp, 1.6) },
  uCheckColor: { value: new Color(PALETTE.check) },
};

interface Look {
  color: string;
  base: string;
  rim: string;
  rimMix: number;
  rimPower: number;
  spec: number;
  shine: number;
  self: number;
}

const BODY: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.ivory,
    base: PALETTE.ivoryBase,
    rim: PALETTE.ivoryRim,
    rimMix: 0.45,
    rimPower: 2.6,
    spec: 0.26,
    shine: 26,
    self: 0.05,
  },
  black: {
    color: PALETTE.ebony,
    base: PALETTE.ebonyBase,
    rim: PALETTE.ebonyRim,
    rimMix: 0.5,
    rimPower: 2.4,
    spec: 0.34,
    shine: 34,
    self: 0.08,
  },
};

// The details that name a piece (the knight's mane and eyes, the bishop's
// cut, the unicorn's twist, the queen's pearls, the king's cross): walnut
// inlaid in ivory, dull bronze in ebony
const ACCENT: Record<PieceColor, Look> = {
  white: { ...BODY.white, color: PALETTE.ivoryAccent, base: PALETTE.ivoryAccent, rimMix: 0.3 },
  black: { ...BODY.black, color: PALETTE.ebonyAccent, base: PALETTE.ebonyAccent, rimMix: 0.35 },
};

// The rook's accent is its whole hollow: seen from above it is most of the
// piece, so it keeps its army's value, a shade deeper than the body
const WELL: Record<PieceColor, Look> = {
  white: { ...BODY.white, color: '#d9c9ae', base: '#d9c9ae', rimMix: 0.3 },
  black: { ...BODY.black, color: '#23180f', base: '#23180f', rimMix: 0.4 },
};

/**
 * A wood material of its own for one piece: it shares the rig and the lights
 * with every other piece (the uniform objects themselves), and keeps its own
 * warmth and check light, which ease per piece.
 */
const wood = (look: Look, top: number) =>
  new ShaderMaterial({
    uniforms: {
      ...LIGHTS,
      uKey: rig.key,
      uFill: rig.fill,
      uColor: { value: new Color(look.color) },
      uBase: { value: new Color(look.base) },
      uRim: { value: new Color(look.rim) },
      uRimMix: { value: look.rimMix },
      uRimPower: { value: look.rimPower },
      uSpec: { value: look.spec },
      uShine: { value: look.shine },
      uSelf: { value: look.self },
      uTop: { value: top },
      uWarm: { value: 0 },
      uCheck: { value: 0 },
    },
    vertexShader: woodVertex,
    fragmentShader: woodFragment,
  });

/** The materials of one piece: its body and its accent, lit together. */
export const pieceMaterials = (color: PieceColor, type: PieceType) => {
  const top = pieceTop(pieceSet(), type);
  return {
    body: wood(BODY[color], top),
    accent: wood(type === PieceType.Rook ? WELL[color] : ACCENT[color], top),
  };
};

// --- On the board, under the piece -------------------------------------------------

// One quad at the piece's foot draws everything that lies on the board: the
// contact shadow, the faint glow of the lamp under a hovered piece, and the
// held piece's pool of light in its hexagon with the ring it breathes out.
// It darkens and lights in one pass (premultiplied: the light adds, the
// shadow shades), in piece units.

const floorVertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = position.xz * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uLamp;
  uniform vec3 uRed;
  uniform float uShadow;
  uniform float uHover;
  uniform float uPool;
  uniform float uRing;
  uniform float uRingR;
  uniform float uRed2;
  uniform float uHex;
  uniform float uEdge;
  uniform float uSteep;
  varying vec2 vP;

  // iq's hexagon, r the inradius
  float hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }

  void main() {
    float r = length(vP);
    // The contact shadow: dense under the base, gone by the square's middle
    float shadow = uShadow * (1.0 - smoothstep(0.06, 0.4, r)) * (1.0 - 0.6 * uPool);
    // The lamp's glow round a hovered piece's foot
    float glow = exp(-r * r / (0.34 * 0.34)) * 0.16 * uHover;
    // The held piece's pool, brightest just outside its foot, inside a fine
    // hexagon of the same light
    float hx = hexagon(vP, uHex);
    float fw = max(fwidth(hx), 1e-4);
    float w = max(0.012, fw * 0.8);
    float edge = (1.0 - smoothstep(w - fw, w + fw, abs(hx))) * min(0.012 / w, 1.0);
    float inside = 1.0 - smoothstep(-0.06, 0.0, hx);
    float pool = inside * (0.05 + 0.13 * exp(-pow((r - 0.3) / 0.16, 2.0))) + edge * 0.5 * uEdge;
    // From straight above the pool keeps its hexagon but quietens its fill
    pool *= mix(1.0, 0.75, uSteep);
    // The ring it breathes out when the lamp comes on
    float rh = hexagon(vP, uRingR);
    float rw = max(0.014, fwidth(rh));
    float ring = (1.0 - smoothstep(rw * 0.5, rw * 1.5, abs(rh))) * uRing;
    float light = glow + pool * uPool + ring;
    vec3 c = mix(uLamp, uRed, uRed2) * light;
    float a = shadow;
    if (a + light < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

const FLOOR_SIZE = 1.5;
const floorQuad = new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2);
/** The hexagon's inradius, piece units (just inside the square). */
const HEX = 0.43 / PIECE_SCALE;

const floorMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uLamp: { value: new Color(PALETTE.lamp) },
      uRed: { value: new Color(PALETTE.check) },
      uShadow: { value: 0.42 },
      uHover: { value: 0 },
      uPool: { value: 0 },
      uRing: { value: 0 },
      uRingR: { value: HEX },
      uRed2: { value: 0 },
      uHex: { value: HEX },
      uEdge: { value: 1 },
      uQuad: { value: 1 },
      uSteep: steepness,
    },
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
  });

// --- The halo -------------------------------------------------------------------------

// A soft disc of lamp light behind the held piece, drawn facing the viewer
// and pushed away from them so the piece stands in front of it. Seen from
// above it would lie round the piece like a ring on the board, so it belongs
// to side views and fades out toward top-down (the pool says it there).

const haloVertex = /* glsl */ `
  uniform float uSize;
  uniform float uHeight;
  uniform float uPush;
  varying vec2 vP;
  varying float vSide;
  void main() {
    vP = position.xy * 2.0;
    vec3 anchor = (modelMatrix * vec4(0.0, uHeight, 0.0, 1.0)).xyz;
    vSide = 1.0 - smoothstep(0.7, 0.9, abs(normalize(cameraPosition - anchor).y));
    vec4 centre = modelViewMatrix * vec4(0.0, uHeight, 0.0, 1.0);
    centre.xyz += normalize(centre.xyz) * uPush;
    centre.xy += position.xy * uSize;
    gl_Position = projectionMatrix * centre;
  }`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  varying vec2 vP;
  varying float vSide;
  void main() {
    float r = length(vP);
    // A soft disc with a gently brighter rim, fading out past it
    float disc = (1.0 - smoothstep(0.55, 0.95, r)) * (0.45 + 0.4 * smoothstep(0.2, 0.8, r));
    float rim = exp(-pow((r - 0.78) / 0.12, 2.0)) * 0.35;
    float a = (disc + rim) * uGlow * vSide;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const haloQuad = new PlaneGeometry(1, 1);

const haloMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.lamp) },
      uGlow: { value: 0 },
      uSize: { value: 0.9 },
      uHeight: { value: 0.4 },
      uPush: { value: 0.42 },
    },
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
  });

// --- Motes -------------------------------------------------------------------------------

// A few motes of lamp light drifting slowly up from the held piece's pool,
// like dust in the light of a lamp: placed by the shader from one clock, so
// nothing is written per frame but a uniform.

const MOTES = 6;
const moteGeometry = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
  g.setAttribute(
    'aSeed',
    new BufferAttribute(
      Float32Array.from({ length: MOTES }, (_, i) => (i * 0.618034) % 1),
      1,
    ),
  );
  return g;
})();

const moteVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uScale;
  uniform float uSize;
  varying float vA;
  void main() {
    float t = fract(uTime / 2.8 + aSeed);
    float ang = aSeed * 18.85 + uTime * 0.3;
    float r = 0.17 + 0.13 * fract(aSeed * 7.31);
    vec3 p = vec3(cos(ang) * r, 0.03 + t * 0.6, sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
    vA = sin(3.14159265 * t) * uAlpha;
  }`;

const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.15, 1.0, d)) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const moteMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.lamp) },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uScale: { value: 360 },
      uSize: { value: 0.12 },
    },
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
  });

// --- The piece -----------------------------------------------------------------------

/** How long the lamp takes to come on when a piece is picked up (the flair). */
const ENTER_MS = 620;
/** How long it takes to go out when the piece is put down. */
const RELEASE_MS = 260;
/** How long hover's warmth and the check light take to ease in or out. */
const EASE_MS = 200;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const toward = (v: number, goal: number, step: number) =>
  goal > v ? Math.min(goal, v + step) : Math.max(goal, v - step);

const turn = new Quaternion();

/**
 * A Staunton piece in ivory or ebony on its contact shadow, and (see the
 * top of this file) the lamp that warms it under the pointer and lights it
 * when picked up, with its release when put down.
 */
export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const materials = useMemo(() => pieceMaterials(color, type), [color, type]);
  const floor = useMemo(floorMaterial, []);
  const halo = useMemo(haloMaterial, []);
  const motes = useMemo(moteMaterial, []);
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.accent.dispose();
      floor.dispose();
      halo.dispose();
      motes.dispose();
    },
    [materials, floor, halo, motes],
  );
  // Point sizes in pixels per unit of depth: half the drawing buffer's height
  const pointScale = useThree((st) => (st.size.height * st.viewport.dpr) / 2);
  const moteMesh = useRef<Points>(null);
  const floorMesh = useRef<Mesh>(null);
  const top = pieceTop(pieceSet(), type);
  const floorGroup = useRef<Group>(null);
  const haloMesh = useRef<Mesh>(null);
  // Eased state: hover's warmth, the check light, and the lamp's life (a
  // clock since it came on, and how lit it is while going out)
  const s = useRef({ warm: 0, check: 0, since: -1, lamp: 0 });
  useEffect(() => {
    // Picked up (again): the lamp comes on from the start
    if (selected) s.current.since = 0;
    invalidate();
  }, [selected, invalidate]);
  useEffect(() => invalidate(), [hovered, inCheck, invalidate]);

  useFrame((_, delta) => {
    const st = s.current;
    const dt = Math.min(delta, 1 / 20);
    const ease = dt / (EASE_MS / 1000);
    let moving = false;
    const warmGoal = selected ? 1 : hovered ? 0.7 : 0;
    const warm = toward(st.warm, warmGoal, ease);
    const check = toward(st.check, inCheck ? 1 : 0, ease);
    moving ||= warm !== warmGoal || check !== (inCheck ? 1 : 0);
    st.warm = warm;
    st.check = check;

    let pool = 0;
    let ring = 0;
    let ringR = HEX;
    let rise = 1;
    let glow = 0;
    if (selected) {
      const still = prefersReducedMotion();
      st.since = still ? ENTER_MS : Math.min(st.since + dt * 1000, ENTER_MS);
      const t = st.since / ENTER_MS;
      if (t < 1) moving = true;
      // The pool blooms a little past its rest and settles; the ring
      // breathes out once; the halo rises from the foot and settles
      const bloom = Math.min(st.since / 220, 1);
      pool = easeOut(bloom) * (1 + 0.35 * Math.sin(Math.PI * Math.min(st.since / 480, 1)));
      // (the ring leaves once the pool has formed, so the two never double)
      const k = Math.min(Math.max(st.since - 120, 0) / 460, 1);
      ringR = HEX * (1.04 + 0.3 * easeOut(k));
      ring = still || st.since < 120 ? 0 : 0.5 * (1 - k) * Math.min((st.since - 120) / 60, 1);
      rise = easeOut(Math.min(st.since / 420, 1));
      glow = rise * (1 + 0.5 * Math.sin(Math.PI * Math.min(st.since / 520, 1)));
      st.lamp = 1;
    } else if (st.lamp > 0) {
      // Put down: the pool and the halo fade (and the halo sinks a little)
      st.lamp = Math.max(0, st.lamp - dt / (RELEASE_MS / 1000));
      const e = st.lamp * st.lamp;
      pool = e;
      glow = e;
      rise = 0.85 + 0.15 * e;
      moving = true;
    }

    const f = floor.uniforms;
    f.uHover.value = selected ? 0 : Math.min(warm / 0.7, 1);
    f.uPool.value = pool;
    f.uRing.value = ring;
    f.uRingR.value = ringR;
    // A king in check keeps the red plate's square to itself: its pool
    // takes the red, and drops its hexagon, so the two never nest
    f.uRed2.value = check * 0.7;
    f.uEdge.value = 1 - check;
    // The quad grows while the lamp is on, to hold the ring it breathes out
    const quad = pool > 0 ? 1.5 : 1;
    f.uQuad.value = quad;
    floorMesh.current?.scale.setScalar(quad);
    const h = halo.uniforms;
    h.uGlow.value = glow * (1 - 0.5 * check) * 0.26;
    h.uHeight.value = top * (0.15 + 0.42 * rise);
    h.uSize.value = 0.5 + 0.28 * rise;
    if (haloMesh.current) haloMesh.current.visible = glow > 0.002;
    // The motes drift while the lamp is on (still, with reduced motion)
    const m = motes.uniforms;
    m.uAlpha.value = Math.min(pool, 1) * (1 - check) * 0.75;
    m.uScale.value = pointScale;
    if (pool > 0 && !prefersReducedMotion()) {
      m.uTime.value += dt;
      moving = true;
    }
    if (moteMesh.current) moteMesh.current.visible = m.uAlpha.value > 0.002;
    for (const m of [materials.body, materials.accent]) {
      m.uniforms.uWarm.value = warm;
      m.uniforms.uCheck.value = check;
    }
    // The hexagon keeps square to the board, whichever way the piece faces
    const g = floorGroup.current;
    if (g?.parent && pool > 0) {
      g.parent.getWorldQuaternion(turn).invert();
      if (!g.quaternion.equals(turn)) g.quaternion.copy(turn);
    }
    if (moving) invalidate();
  });

  return (
    <>
      <group ref={floorGroup} userData={ON_FLOOR}>
        <mesh
          ref={floorMesh}
          geometry={floorQuad}
          material={floor}
          position={[0, 0.004, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        <points
          ref={moteMesh}
          geometry={moteGeometry}
          material={motes}
          visible={false}
          renderOrder={LAYER.trace + 0.4}
          raycast={noRaycast}
          frustumCulled={false}
        />
      </group>
      <ChessPiece type={type} parts={{ body: materials.body, accent: materials.accent }} />
      <mesh
        ref={haloMesh}
        geometry={haloQuad}
        material={halo}
        visible={false}
        renderOrder={LAYER.shadow - 0.5}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

/** The whole piece as one geometry, for effects that redraw it. */
export const wholePiece = (type: PieceType): BufferGeometry =>
  partsGeometry(pieceSet(), type, PIECE_PARTS)!;
