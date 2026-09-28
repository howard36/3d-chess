import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Mesh, Points } from 'three';
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR, useGlide } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVEL_COLORS, PALETTE, PIECE_SCALE, RING_RADIUS, RING_WIDTH } from './palette';

// Moonstone and obsidian. The light army is moonstone: a cool milky white
// whose light wraps a little round its form, as a translucent stone's does,
// with a faint blue sheen floating over the side toward the light. The dark
// army is obsidian: a clearly dark blue-black glass, carried by a crisp
// glossy highlight and a dim, cool edge, so its form reads without it ever
// looking pale. Both are lit by the terrace's rig (a soft key over the
// camera's shoulder, a cool fill), so they model the same way from every
// side.
//
// At its foot every piece stands on a thin ring of its level's light over a
// soft contact shadow, in a group that stays on the floor while the piece
// lifts (ON_FLOOR). As a piece glides between levels the ring's colour
// travels with it, through the levels it passes.
//
// Hovered, a piece lifts a little, its ring brightens with a soft glow, and a
// faint starlight halo (a moon's halo) rises behind it. Picked up, it lifts a
// touch more, its ring turns to starlight, a pool of light opens under it,
// and a column of starlight about one piece tall rises round it from the
// floor, bright at its rising edge, then settles to a calm glow with a few
// motes drifting up. Put down, all of it fades and the column sinks back
// into the floor. Every change is eased on r3f's clock.

// --- The stone shader -----------------------------------------------------------

/** The light rig, in world space: Stage's CameraLights keeps it with the camera. */
export const rig = {
  key: { value: new Vector3(-0.4, 0.75, 0.55).normalize() },
  fill: { value: new Vector3(0.6, 0.1, 0.5).normalize() },
};

const stoneVertex = /* glsl */ `
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

const stoneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform float uGradient;
  uniform vec3 uRim;
  uniform vec3 uGlowRim;
  uniform vec3 uSheen;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uWrap;
  uniform float uSelf;
  uniform float uSpec;
  uniform float uTopSpec;
  uniform float uShine;
  uniform float uSheenAmt;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    // Deeper toward the base (piece units, base at 0)
    vec3 albedo = mix(uBase, uColor, mix(1.0, smoothstep(0.02, 0.4, vY), uGradient));
    float nk = dot(n, uKey);
    // Wrapped light: a translucent stone is never dead on its shadowed side
    float key = max((nk + uWrap) / (1.0 + uWrap), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    vec3 col = albedo * (uKeyColor * key + uFillColor * fill + hemi + uSelf);
    // The highlight: broad on moonstone, crisp on obsidian glass
    vec3 h = normalize(uKey + v);
    float nh = max(dot(n, h), 0.0);
    // (seen from above, a flat top would mirror the key whole: the dark army
    // keeps only a trace of it there, so it never shows a pale disc)
    float topView = smoothstep(0.6, 0.95, v.y);
    col += uKeyColor * pow(nh, uShine) * uSpec * max(nk, 0.0) * mix(1.0, uTopSpec, topView);
    // Moonstone's schiller: a faint blue sheen floating toward the light
    col += uSheen * pow(nh, 3.0) * uSheenAmt;
    // The army's edge, quieter from above (where a piece is nearly all edge)
    float facing = abs(dot(n, v));
    float fromAbove = mix(1.0, 0.35, smoothstep(0.55, 0.95, abs(v.y)));
    float rim = pow(1.0 - facing, uRimPower) * fromAbove;
    vec3 rimColor = mix(uRim, uGlowRim, uGlow);
    col = mix(col, rimColor, clamp((uRimMix + 0.22 * uGlow) * rim, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The terrace's lights as the stone sees them: a light's colour times its
// intensity, over pi for a matte surface
const lit = (hex: string, intensity: number) => new Color(hex).multiplyScalar(intensity / Math.PI);
const LIGHTS = {
  uKeyColor: { value: lit('#f3f5ff', 2.4) },
  uFillColor: { value: lit('#8fb4ff', 0.6) },
  uSky: { value: lit('#c3d0f2', 0.7) },
  uGround: { value: lit('#1e2638', 0.7) },
};

interface Stone {
  color: string;
  base?: string;
  rim: string;
  glowRim?: string;
  rimMix: number;
  rimPower: number;
  wrap?: number;
  self?: number;
  spec?: number;
  /** Share of the highlight kept when seen from straight above. */
  topSpec?: number;
  shine?: number;
  sheen?: number;
}

const stone = (o: Stone) =>
  new ShaderMaterial({
    uniforms: {
      ...LIGHTS,
      uKey: rig.key,
      uFill: rig.fill,
      uColor: { value: new Color(o.color) },
      uBase: { value: new Color(o.base ?? o.color) },
      uGradient: { value: o.base ? 1 : 0 },
      uRim: { value: new Color(o.rim) },
      uGlowRim: { value: new Color(o.glowRim ?? o.rim) },
      uSheen: { value: new Color(PALETTE.schiller) },
      uWrap: { value: o.wrap ?? 0 },
      uSelf: { value: o.self ?? 0 },
      uSpec: { value: o.spec ?? 0.25 },
      uTopSpec: { value: o.topSpec ?? 1 },
      uShine: { value: o.shine ?? 24 },
      uSheenAmt: { value: o.sheen ?? 0 },
      uRimMix: { value: o.rimMix },
      uRimPower: { value: o.rimPower },
      uGlow: { value: 0 },
    },
    vertexShader: stoneVertex,
    fragmentShader: stoneFragment,
  });

const BODY: Record<PieceColor, Stone> = {
  white: {
    color: PALETTE.moonstone,
    base: PALETTE.moonstoneBase,
    rim: PALETTE.moonstoneRim,
    glowRim: '#ffffff',
    rimMix: 0.3,
    rimPower: 2.6,
    wrap: 0.55,
    self: 0.03,
    spec: 0.28,
    shine: 18,
    sheen: 0.1,
  },
  black: {
    color: PALETTE.obsidian,
    base: PALETTE.obsidianBase,
    rim: PALETTE.obsidianRim,
    glowRim: '#8196c2',
    rimMix: 0.34,
    rimPower: 2.4,
    wrap: 0.1,
    self: 0.05,
    spec: 0.95,
    topSpec: 0.12,
    shine: 64,
  },
};

/** A body material of its own for one piece: its edge brightens under the pointer. */
const bodyMaterial = (color: PieceColor) => stone(BODY[color]);

// The details that name a piece (the knight's mane and eyes, the bishop's
// cut, the unicorn's spiral, the queen's pearls, the king's cross): slate
// blue cut into moonstone, a soft steel blue set into obsidian, never pale
// enough to make a dark piece read light
const accents: Record<PieceColor, ShaderMaterial> = {
  white: stone({
    color: PALETTE.moonstoneAccent,
    rim: '#9fb2d6',
    rimMix: 0.25,
    rimPower: 2.4,
    wrap: 0.4,
    self: 0.06,
    spec: 0.3,
    shine: 24,
  }),
  black: stone({
    color: PALETTE.obsidianAccent,
    rim: PALETTE.obsidianRim,
    rimMix: 0.25,
    rimPower: 2.4,
    wrap: 0.2,
    self: 0.08,
    spec: 0.6,
    topSpec: 0.2,
    shine: 40,
  }),
};
// The rook's accent is its whole hollow and sills: from above it is most of
// the piece, so it keeps its own army's value
const wells: Record<PieceColor, ShaderMaterial> = {
  white: stone({
    color: '#c3cddf',
    rim: PALETTE.moonstoneRim,
    rimMix: 0.25,
    rimPower: 2.6,
    wrap: 0.5,
    self: 0.03,
    spec: 0.2,
  }),
  // A well catches the key light square on from above: a dull glaze, so a
  // dark rook never shows a pale disc at its top
  black: stone({
    color: '#161b29',
    rim: PALETTE.obsidianRim,
    rimMix: 0.2,
    rimPower: 2.4,
    wrap: 0.1,
    self: 0.04,
    spec: 0.2,
    topSpec: 0.1,
    shine: 90,
  }),
};
export const accentOf = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? wells[color] : accents[color];

// --- The footprint ------------------------------------------------------------------

// One quad under each piece: a soft contact shadow, the thin ring of its
// level's light, a soft glow round the ring (under the pointer), and a pool
// of starlight inside it (picked up)
const footVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const footFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uStar;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uShadow;
  uniform float uHover;
  uniform float uSelect;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float shadow = uShadow * (1.0 - smoothstep(0.1, uRadius * 1.02, r));
    float d = abs(r - uRadius);
    float fw = max(fwidth(r), 1e-4);
    float w = max(uWidth * 0.5, fw * 0.75);
    float ring = (1.0 - smoothstep(w - fw, w + fw, d)) * min(uWidth * 0.5 / w, 1.0);
    float glow = exp(-d * d / (0.045 * 0.045));
    float pool = (1.0 - smoothstep(0.0, uRadius, r)) * 0.3 * uSelect;
    float ringA = ring * (0.8 + 0.2 * uHover + 0.2 * uSelect);
    float light = clamp(ringA + glow * (0.2 * uHover + 0.18 * uSelect) + pool, 0.0, 1.0);
    vec3 col = mix(uColor, uStar, 0.6 * uSelect);
    float a = light + shadow * (1.0 - light);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * light / max(a, 1e-4), a);
    #include <colorspace_fragment>
  }`;

const footPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const levelColors = LEVEL_COLORS.map((c) => new Color(c));

const footMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: new Color() },
      uStar: { value: new Color(PALETTE.select) },
      uRadius: { value: RING_RADIUS },
      uWidth: { value: RING_WIDTH },
      uShadow: { value: 0.5 },
      uHover: { value: 0 },
      uSelect: { value: 0 },
    },
    vertexShader: footVertex,
    fragmentShader: footFragment,
  });

/** The ramp's colour at a fractional level: a glide passes through the levels between. */
const rampAt = (level: number, out: Color) => {
  const z = Math.min(Math.max(level, 0), levelColors.length - 1);
  const i = Math.min(Math.floor(z), levelColors.length - 2);
  return out.copy(levelColors[i]).lerp(levelColors[i + 1], z - i);
};

// --- The halo -----------------------------------------------------------------------

// A moon's halo behind the piece: a thin ring of starlight with a soft glow
// inside it, billboarded and pushed back so the piece stands in front of it.
// It belongs to side views: seen from above it would lie round the piece like
// another ring on the floor, so it fades out toward top-down.
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
  uniform float uStrength;
  varying vec2 vP;
  varying float vSide;
  void main() {
    float r = length(vP);
    float aa = fwidth(r) * 1.2;
    float ring = 1.0 - smoothstep(0.0, 0.02 + aa, abs(r - 0.82));
    float disc = (1.0 - smoothstep(0.55, 0.84, r)) * 0.22;
    float glow = exp(-pow((r - 0.82) / 0.14, 2.0)) * 0.35;
    float a = (ring * 0.5 + disc + glow) * uStrength * vSide;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const haloQuad = new PlaneGeometry(1, 1);

// The halo's ring is at 0.41 of the quad's size (view units): sized to the
// piece, so a pawn's never reaches below its own floor
const haloMaterial = (top: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.select) },
      uStrength: { value: 0 },
      uSize: { value: (0.52 * top * PIECE_SCALE + 0.07) / 0.41 },
      uHeight: { value: top * 0.52 },
      uPush: { value: 0.42 },
    },
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
  });

// --- The column of starlight ------------------------------------------------------

const COLUMN_HEIGHT = 1.05;
const columnGeometry = new CylinderGeometry(
  RING_RADIUS * 0.72,
  RING_RADIUS,
  COLUMN_HEIGHT,
  40,
  1,
  true,
).translate(0, COLUMN_HEIGHT / 2, 0);

const columnVertex = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vH = position.y / ${COLUMN_HEIGHT.toFixed(3)};
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uRise;
  uniform float uFront;
  uniform float uStrength;
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    // Risen this far: soft at its rising top
    float reach = 1.0 - smoothstep(uRise - 0.12, uRise + 0.02, vH);
    if (reach < 0.002) discard;
    vec3 v = normalize(cameraPosition - vW);
    float facing = abs(dot(normalize(vN), v));
    // A soft band of light just inside its outline, never a hard edge: a
    // beam, not a glass; clear in front of the piece
    float edge = pow(1.0 - facing, 1.3) * smoothstep(0.0, 0.35, facing);
    float fade = pow(1.0 - vH, 2.2);
    // Faint bands of light rising slowly
    float bands = 0.8 + 0.2 * sin((vH * 3.5 - uTime * 0.3) * 6.2831853);
    float skirt = exp(-vH / 0.04) * 0.1;
    // The rising front of the entrance: a soft swell of light, not a rim
    float front = exp(-pow((vH - uRise + 0.06) / 0.1, 2.0)) * uFront * (0.25 + edge);
    // Seen from above it is all edge: it gives way to the pool on the floor
    float side = 1.0 - 0.8 * smoothstep(0.7, 0.93, abs(v.y));
    float a = ((0.04 + 0.9 * edge) * fade * bands + skirt + front * 0.6) * uStrength * side * reach;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const MOTES = 9;
const moteTexture = (() => {
  let t: ReturnType<typeof dotTexture> | null = null;
  return () => (t ??= dotTexture(0.75, 32));
})();

// Entrance: the column rises in RISE_MS, bright at its front, then settles
// over SETTLE_MS to its calm glow. Release: it sinks and fades in FALL_MS.
const RISE_MS = 380;
const SETTLE_MS = 420;
const FALL_MS = 260;
const HOVER_MS = 180;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The column, its motes and the halo, mounted only while a piece is lit
 * (hovered, held, or fading back); its intensities are driven by PieceBody.
 */
interface Glow {
  /** Eased hover, 0–1. */
  hover: number;
  /** Eased hold, 0–1 (the halo's and the pool's share of the selection). */
  hold: number;
  /** The column's height (0–1 of its own) and brightness, and its entrance front. */
  rise: number;
  strength: number;
  front: number;
}

const Column = ({ glow, still }: { glow: React.RefObject<Glow>; still: boolean }) => {
  const mesh = useRef<Mesh>(null);
  const points = useRef<Points>(null);
  const clock = useRef(0);
  const { material, motes, seeds, moteMaterial } = useMemo(() => {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(PALETTE.select) },
        uTime: { value: 0 },
        uRise: { value: 0 },
        uFront: { value: 0 },
        uStrength: { value: 0 },
      },
      vertexShader: columnVertex,
      fragmentShader: columnFragment,
    });
    const random = rng(5);
    const seeds = Array.from({ length: MOTES }, () => ({
      angle: random() * Math.PI * 2,
      radius: 0.08 + random() * 0.18,
      phase: random(),
      speed: 0.1 + random() * 0.08,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    const moteMaterial = new PointsMaterial({
      size: 0.05,
      map: moteTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { material, motes, seeds, moteMaterial };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [material, motes, moteMaterial],
  );
  const star = useMemo(() => new Color(PALETTE.select), []);
  const view = useMemo(() => new Vector3(), []);
  useFrame(({ camera }, delta) => {
    const g = glow.current;
    if (!g) return;
    if (!still) clock.current += Math.min(delta, 1 / 20);
    const u = material.uniforms;
    u.uTime.value = clock.current;
    u.uRise.value = g.rise;
    u.uFront.value = g.front;
    u.uStrength.value = g.strength;
    if (mesh.current) mesh.current.visible = g.strength > 0.002 && g.rise > 0.002;
    // Motes drift up inside the column, fading from above (they would read as
    // specks round the piece seen end-on)
    camera.getWorldDirection(view);
    const side = 1 - smooth(Math.min(Math.max((-view.y - 0.7) / 0.23, 0), 1));
    const pos = motes.getAttribute('position') as BufferAttribute;
    const col = motes.getAttribute('color') as BufferAttribute;
    seeds.forEach((s, i) => {
      const h = (s.phase + clock.current * s.speed) % 1;
      const y = h * COLUMN_HEIGHT * 0.85 * g.rise;
      const r = s.radius * (1 - 0.15 * h);
      const a = s.angle + clock.current * 0.25;
      pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      const f = Math.sin(Math.PI * h) * 0.9 * g.strength * side;
      col.setXYZ(i, star.r * f, star.g * f, star.b * f);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (points.current) points.current.visible = g.strength > 0.002 && side > 0.01;
  });
  return (
    <>
      <mesh
        ref={mesh}
        geometry={columnGeometry}
        material={material}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
        visible={false}
      />
      <points
        ref={points}
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
        visible={false}
      />
    </>
  );
};

// --- The piece -----------------------------------------------------------------------

/**
 * A Staunton piece in moonstone or obsidian, standing on its level's ring
 * (which stays on the floor when the piece lifts), with its hover halo and,
 * when picked up, its column of starlight.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, hovered, selected } = props;
  const level = props.level ?? 0;
  const invalidate = useThree((s) => s.invalidate);
  const glide = useGlide();
  const still = useMemo(prefersReducedMotion, []);

  const body = useMemo(() => bodyMaterial(color), [color]);
  const foot = useMemo(footMaterial, []);
  const top = pieceTop(pieceSet(), type);
  const halo = useMemo(() => haloMaterial(top), [top]);
  useEffect(
    () => () => {
      body.dispose();
      foot.dispose();
      halo.dispose();
    },
    [body, foot, halo],
  );

  // Lit while hovered or held, and until everything has faded back out
  const [lit, setLit] = useState(false);
  if ((hovered || selected) && !lit) setLit(true);

  const glow = useRef<Glow>({ hover: 0, hold: 0, rise: 0, strength: 0, front: 0 });
  // Time since the piece was picked up (the entrance's clock), or -1 when not held
  const held = useRef(-1);
  const levelColor = useRef(new Color());
  const settledColor = useRef(-1);

  useEffect(() => invalidate(), [hovered, selected, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20) * 1000;
    const g = glow.current;
    let moving = false;

    // The ring's colour: its level's, or, while gliding, the levels it passes
    if (glide) {
      const p = glide.progress.current;
      rampAt(glide.fromLevel + (glide.toLevel - glide.fromLevel) * p, levelColor.current);
      foot.uniforms.uColor.value.copy(levelColor.current);
      settledColor.current = -1;
      moving = p < 1;
    } else if (settledColor.current !== level) {
      foot.uniforms.uColor.value.copy(levelColors[level]);
      settledColor.current = level;
    }

    // Hover eases in and out
    const hoverGoal = hovered && !selected ? 1 : 0;
    if (g.hover !== hoverGoal) {
      const step = dt / HOVER_MS;
      g.hover = hoverGoal > g.hover ? Math.min(1, g.hover + step) : Math.max(0, g.hover - step);
      moving = true;
    }

    // The hold: an entrance that rises and settles, or a release that sinks
    if (selected) {
      if (held.current < 0) held.current = 0;
      const t0 = held.current;
      held.current = t0 + dt;
      const t = held.current;
      const rise = easeOut(Math.min(t / RISE_MS, 1));
      // Rising from wherever a release left it
      g.rise = Math.max(g.rise, rise);
      const settle = smooth(Math.min(Math.max((t - RISE_MS * 0.6) / SETTLE_MS, 0), 1));
      // The bright front climbs with the column and is spent by its top
      g.front = 0.55 * Math.sin(Math.PI * Math.min(t / RISE_MS, 1));
      g.strength = Math.min(1, t / (RISE_MS * 0.5)) * (0.92 - 0.32 * settle);
      g.hold = Math.min(1, g.hold + dt / RISE_MS);
      moving = true;
    } else {
      held.current = -1;
      if (g.hold > 0 || g.strength > 0 || g.rise > 0) {
        const step = dt / FALL_MS;
        g.hold = Math.max(0, g.hold - step);
        g.rise = Math.max(0, g.rise - step);
        g.strength = Math.max(0, g.strength - step * 0.75);
        g.front = 0;
        moving = true;
      }
    }

    const hover = smooth(g.hover);
    const hold = smooth(g.hold);
    foot.uniforms.uHover.value = hover;
    foot.uniforms.uSelect.value = hold;
    body.uniforms.uGlow.value = Math.max(hover * 0.8, hold);
    // The halo is hover's: picked up, the column takes over as it fades
    halo.uniforms.uStrength.value = hover * 0.55;

    if (moving) invalidate();
    else if (lit && !hovered && !selected) setLit(false);
  });

  return (
    <>
      <group userData={ON_FLOOR}>
        <mesh
          geometry={footPlane}
          material={foot}
          position={[0, 0.004, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        {lit && <Column glow={glow} still={still} />}
      </group>
      <ChessPiece type={type} parts={{ body, accent: accentOf(type, color) }} />
      {lit && (
        <mesh
          geometry={haloQuad}
          material={halo}
          renderOrder={LAYER.shadow - 0.5}
          raycast={noRaycast}
          frustumCulled={false}
        />
      )}
    </>
  );
};

/** The whole piece as one geometry, for effects that redraw it (the capture). */
export const wholePiece = (type: PieceType) => partsGeometry(pieceSet(), type, PIECE_PARTS)!;
