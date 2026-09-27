import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import type { BufferGeometry, WebGLProgramParametersWithUniforms } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, PIECE_PARTS, buildPieceSet, partsGeometry, pieceTop } from '../../pieces';
import type { PieceSet } from '../../pieces';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import {
  CARBON,
  CARBON_WEAVE,
  CERAMIC,
  CAPTURE,
  CERAMIC_COLLAR,
  CHECK,
  STEEL,
  STEEL_HOVER,
  KEYLINE,
  HOVER_HALO,
  LASER,
  LASER_HOT,
  LEVEL,
  LEVEL_FOOT,
  TITANIUM,
} from './palette';

// The armies: the shared Staunton set in two lab materials.
//
// - White: glossy white ceramic under a clear glaze, its collar a paler satin
//   panel, its details (mane, mitre cut, spiral, pearls, cross) inlaid in
//   satin titanium. A thin slate keyline draws its contour, so white on a
//   white lab never melts into the walls.
// - Black: carbon fibre: a 2×2 twill weave (its tows catch the light in a
//   diagonal step) under a glossy resin coat, with brushed-steel inlays. The
//   glossy coat mirrors the pale room at every grazing edge, so the dark
//   pieces are drawn by light rather than read as silhouettes.
// - A rook's accent is its whole hollow, so it stays in the army's own
//   material: seen from above, a rook still reads as its army.
// - Every piece stands on an LED foot in its level's colour, over a soft
//   shadow and the LED's light spilling round it on the tray (soft, with no
//   edge, so it never competes with a marker).
//
// Selection is a measurement, taken once: the piece floats a little off the
// tray and takes a hairline laser keyline; a thin laser line scans up it and a
// caliper stands beside it for the length of the scan, then everything holds
// still. The army's colour is never washed: only the silhouette's edge is lit.
// Hover is neutral (a firmer keyline in the army's own family), so the laser
// colour belongs to the held piece alone.

// --- Geometry ------------------------------------------------------------------------

// The white army is turned with 14 sides instead of the set's 24 (its
// keyline hides the facets, and it pays for the keylines' triangles); the
// glossy carbon army is turned with 20, where facets would show in its
// reflections. Built on first use.
let set: PieceSet | null = null;
let carbonSet: PieceSet | null = null;
export const cleanroomSet = (): PieceSet => (set ??= buildPieceSet({ segments: 14 }));
const setFor = (color: PieceColor): PieceSet =>
  color === 'white' ? cleanroomSet() : (carbonSet ??= buildPieceSet({ segments: 20 }));

// --- Shader hooks --------------------------------------------------------------------

/** The selected piece's scan: x = height of the line (piece units), y = its strength. */
const SCAN = { value: new Vector4(-1, 0, 0, 0) };
const SCAN_COLOR = { value: new Color(LASER_HOT) };
/**
 * A captured piece dissolving: x = height of the cut (piece units), above
 * which there is nothing; y = a white-hot flash as the cut starts.
 */
const CUT = { value: new Vector4(10, 0, 0, 0) };
const CUT_COLOR = { value: new Color(CAPTURE) };

type Kind = 'ceramic' | 'collar' | 'titanium' | 'carbon' | 'steel';
type State = 'rest' | 'hover' | 'selected' | 'check';

const vertexHook = (shader: WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
};

const fragmentHead = /* glsl */ `
  varying vec3 vObj;
  uniform vec4 uScan;
  uniform vec3 uScanColor;
  uniform vec4 uRim;
  uniform float uScanOn;
  uniform vec4 uCut;
  uniform vec3 uCutColor;
`;

// The 2×2 twill: tows two cells long, stepping one cell per row. As in real
// carbon, the weave lives mostly in the finish (the tows along the light are
// glossier than those across it), with only a faint difference in colour, so
// it shows in the highlights rather than as a printed check. Fades to its
// average where a cell is under a pixel.
const twill = /* glsl */ `
  {
    float around = atan(vObj.z, vObj.x) / 6.2831853 * 56.0;
    vec2 q = vec2(around, vObj.y / 0.02);
    vec2 id = floor(q);
    vec2 f = fract(q);
    float warp = step(mod(id.x + id.y, 4.0), 1.5);
    float across = mix(f.x, f.y, warp);
    float crown = sin(3.14159 * across);
    float k = 1.0 - smoothstep(0.35, 0.9, max(fwidth(q.x), fwidth(q.y)));
    vec3 weave = mix(diffuseColor.rgb, uWeave, warp * 0.4 * (0.6 + 0.4 * crown));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, uWeave, 0.12), weave, k);
    twillWarp = mix(0.5, warp * (0.65 + 0.35 * crown), k);
  }
`;

/** Shared GLSL for every piece material: the scan line and a rim, plus carbon's weave. */
const hook =
  (kind: Kind, uniforms: Record<string, { value: unknown }>, dissolve: boolean) =>
  (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, {
      uScan: SCAN,
      uScanColor: SCAN_COLOR,
      uCut: CUT,
      uCutColor: CUT_COLOR,
    });
    vertexHook(shader);
    const carbon = kind === 'carbon';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${fragmentHead}${carbon ? 'uniform vec3 uWeave;' : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\nfloat twillWarp = 0.5;\n${carbon ? twill : ''}${dissolve ? 'if (vObj.y > uCut.x) discard;' : ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${carbon ? 'roughnessFactor = mix(roughnessFactor + 0.24, roughnessFactor - 0.24, twillWarp);' : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float fres = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim.rgb * uRim.a * pow(fres, 2.5);
          // The scan: a thin line only, nothing washed behind it
          float s = (vObj.y - uScan.x) / 0.012;
          totalEmissiveRadiance += uScanColor * exp(-s * s) * uScan.y * uScanOn;
          ${dissolve ? 'float c = (uCut.x - vObj.y) / 0.03; float hot = exp(-c * c); totalEmissiveRadiance += mix(uCutColor * 1.6, vec3(3.0), uCut.y) * hot + vec3(0.6) * uCut.y;' : ''}
        }`,
      );
  };

// --- Materials -----------------------------------------------------------------------

const materials = new Map<string, MeshPhysicalMaterial>();

const pieceMaterial = (kind: Kind, state: State | 'dissolve'): MeshPhysicalMaterial => {
  const key = `${kind}/${state}`;
  let m = materials.get(key);
  if (m) return m;
  switch (kind) {
    case 'ceramic':
      m = new MeshPhysicalMaterial({
        color: CERAMIC,
        roughness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 0.14,
      });
      break;
    case 'collar':
      m = new MeshPhysicalMaterial({
        color: CERAMIC_COLLAR,
        roughness: 0.5,
        envMapIntensity: 0.65,
      });
      break;
    case 'titanium':
      m = new MeshPhysicalMaterial({
        color: TITANIUM,
        roughness: 0.34,
        metalness: 0.55,
        envMapIntensity: 0.9,
      });
      break;
    case 'carbon':
      m = new MeshPhysicalMaterial({
        color: CARBON,
        roughness: 0.42,
        metalness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        envMapIntensity: 1.05,
      });
      break;
    case 'steel':
      m = new MeshPhysicalMaterial({
        color: STEEL,
        roughness: 0.32,
        metalness: 0.6,
        envMapIntensity: 1.0,
      });
      break;
  }
  const dissolve = state === 'dissolve';
  // A cool rim of room light on the carbon, in every state: it draws the dark
  // forms. No state ever tints a body: selection, hover and check live in the
  // keyline alone.
  const c = new Color('#dfe8f3');
  const uniforms: Record<string, { value: unknown }> = {
    uRim: { value: new Vector4(c.r, c.g, c.b, kind === 'carbon' ? 0.18 : 0) },
    uWeave: { value: new Color(CARBON_WEAVE) },
    uScanOn: { value: state === 'selected' ? 1 : 0 },
  };
  m.fog = false;
  m.onBeforeCompile = hook(kind, uniforms, dissolve);
  m.customProgramCacheKey = () => `cleanroom-${kind}${dissolve ? '-dissolve' : ''}`;
  materials.set(key, m);
  return m;
};

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';

/** The LED foot band, one per level. */
const feet = LEVEL_FOOT.map(
  (c) => new MeshBasicMaterial({ color: new Color(c), toneMapped: false, fog: false }),
);
/** A captured piece's own foot bands, which power down as the cut reaches them. */
const dissolveFeet = LEVEL_FOOT.map(
  (c) => new MeshBasicMaterial({ color: new Color(c), toneMapped: false, fog: false }),
);
const POWERED_DOWN = new Color('#5b6470');

// --- Keyline -------------------------------------------------------------------------

const hullVertex = /* glsl */ `
  attribute vec3 aOutline;
  attribute float aT;
  uniform float uWidth;
  uniform float uPush;
  varying float vT;
  void main() {
    vT = aT;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * aOutline);
    // In proportion to depth: the line keeps its width on screen
    mv.xyz += n * uWidth * -mv.z;
    // Set back from the camera by a fifth of a square: where the piece
    // overlaps itself (a base's tiers, a mane's ridges, the neck over the
    // base) the hull stays behind its own surface, so the keyline only ever
    // draws the piece's outer silhouette, never specks inside it
    // (along the line of sight, so the line stays where it is on screen)
    if (projectionMatrix[3][3] > 0.5) mv.z -= uPush;
    else mv.xyz *= 1.0 + uPush / max(length(mv.xyz), 0.1);
    gl_Position = projectionMatrix * mv;
  }`;

// The keyline can change colour at a height (a share of the piece's own
// height): a selected piece is outlined in laser up to its shoulders, so a
// small crown (queen, king, unicorn) never turns the laser's colour, and a
// checked king only on its top third. A part with no colour has no keyline.
const hullFragment = /* glsl */ `
  uniform vec4 uLow;
  uniform vec4 uHigh;
  uniform float uSplit;
  varying float vT;
  void main() {
    vec4 c = vT < uSplit ? uLow : uHigh;
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb, 1.0);
    #include <colorspace_fragment>
  }`;

const keyColor = (hex: string | null) => {
  const c = new Color(hex ?? '#000000');
  return new Vector4(c.r, c.g, c.b, hex ? 1 : 0);
};

const hullMaterial = (width: number, low: string | null, high = low, split = 1, behind = false) =>
  new ShaderMaterial({
    side: BackSide,
    // An outer line sits just behind the keyline it frames
    polygonOffset: behind,
    polygonOffsetFactor: behind ? 2 : 0,
    polygonOffsetUnits: behind ? 8 : 0,
    uniforms: {
      uWidth: { value: width },
      uPush: { value: behind ? 0.22 : 0.2 },
      uLow: { value: keyColor(low) },
      uHigh: { value: keyColor(high) },
      uSplit: { value: split },
    },
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
  });

/** Width of the keyline in radians of view (about a pixel at 720 px high). */
const KEY = 0.0011;
// At rest only the ceramic has one: a light hairline, edge definition rather
// than ink (the ceramic shades itself). Hover adds a light outer line round
// it (white) or a light steel one (black), never darkening the piece;
// selection and check colour it, a pixel wide.
/** Where a selected piece's laser keyline hands over to its own (a share of its height). */
const SHOULDER = 0.6;
/** A checked king's red keyline covers its top third. */
const TOP_THIRD = 0.66;
const whiteRest = hullMaterial(KEY * 0.7, KEYLINE);
const hulls: Record<PieceColor, Record<State, ShaderMaterial[]>> = {
  white: {
    rest: [whiteRest],
    hover: [whiteRest, hullMaterial(KEY * 1.5, HOVER_HALO, HOVER_HALO, 1, true)],
    selected: [hullMaterial(KEY, LASER, KEYLINE, SHOULDER)],
    check: [hullMaterial(KEY, KEYLINE, CHECK, TOP_THIRD)],
  },
  black: {
    rest: [],
    hover: [hullMaterial(KEY, STEEL_HOVER)],
    selected: [hullMaterial(KEY, LASER, null, SHOULDER)],
    check: [hullMaterial(KEY, null, CHECK, TOP_THIRD)],
  },
};

const hullGeometries = new Map<string, BufferGeometry>();
/**
 * A piece's whole shape with one averaged normal per position, so the
 * inflated hull stays closed across the set's hard edges and part seams.
 * One per piece and army: the armies are turned differently.
 */
const hullGeometry = (type: PieceType, color: PieceColor): BufferGeometry => {
  const key = `${type}/${color}`;
  let g = hullGeometries.get(key);
  if (g) return g;
  // Built from the very mesh the army is drawn with: a hull from any other
  // turning pokes through the body's faces and shows as specks inside it
  const source = setFor(color);
  g = partsGeometry(source, type, PIECE_PARTS)!.clone();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const s = sums.get(k) ?? new Vector3();
    s.x += nor.getX(i);
    s.y += nor.getY(i);
    s.z += nor.getZ(i);
    sums.set(k, s);
  }
  const outline = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keyOf(i))!.clone().normalize();
    outline.set([s.x, s.y, s.z], i * 3);
  }
  g.setAttribute('aOutline', new BufferAttribute(outline, 3));
  // Height as a share of the piece's own, for keylines that change colour
  const top = pieceTop(setFor(color), type);
  const t = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) t[i] = pos.getY(i) / top;
  g.setAttribute('aT', new BufferAttribute(t, 1));
  hullGeometries.set(key, g);
  return g;
};

// --- Footprint -----------------------------------------------------------------------

// Quieter than any marker: a soft contact shadow, and round it the LED's
// light spilling on the tray, a soft band with no edge, so it can never be
// mistaken for a (crisp) laser ring. Seen from high above, where the
// lower trays' engraving steps back, the pocket the piece stands in lights
// up faintly in its level's colour, so every piece still sits in a square of
// its own level. Drawn in world axes (a knight's turn does not turn it).
const footprintFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vWorld;
  varying vec3 vCentre;
  varying vec3 vUp;
  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    // Square to the world's axes (a knight's turn does not turn it), in the
    // plane the piece stands on
    vec3 n = normalize(vUp);
    vec3 e1 = normalize(vec3(1.0, 0.0, 0.0) - n.x * n);
    vec3 e2 = cross(n, e1);
    vec3 off = vWorld - vCentre;
    vec2 w = vec2(dot(off, e1), dot(off, e2));
    // The ring and shadow scale with the piece; the pocket is the board's own size
    float r = length(w) / length(vUp);
    float shadow = 0.36 * (1.0 - smoothstep(0.08, 0.3, r));
    float spill = 0.28 * smoothstep(0.19, 0.29, r) * (1.0 - smoothstep(0.29, 0.44, r));
    vec3 view = normalize(cameraPosition - vWorld);
    float steep = smoothstep(0.55, 0.85, abs(dot(view, n)));
    float d = abs(roundBox(w, 0.44, 0.1));
    float fw = max(fwidth(d), 1e-4);
    float pocket = (1.0 - smoothstep(0.012 - fw * 0.5, 0.012 + fw * 0.5, d)) * steep * 0.85;
    float glow = max(spill, pocket);
    vec3 c = mix(vec3(0.08, 0.1, 0.13), uColor, glow / max(glow + shadow * (1.0 - glow), 1e-4));
    float alpha = glow + shadow * (1.0 - glow);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;

const footprintFragmentVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vCentre;
  varying vec3 vUp;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vCentre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vUp = mat3(modelMatrix) * vec3(0.0, 1.0, 0.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const footprintVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Wide enough for the pocket's outline (in world units, whatever the scale)
const footprintPlane = new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
const footprints = LEVEL.map(
  (c) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uColor: { value: new Color(c) },
      },
      vertexShader: footprintFragmentVertex,
      fragmentShader: footprintFragment,
    }),
);

/** The shadow and level ring under a piece (piece units: the plane is one unit across). */
export const Footprint = ({ level }: { level: number }) => (
  <mesh
    geometry={footprintPlane}
    material={footprints[level] ?? footprints[0]}
    position={[0, 0.004, 0]}
    userData={FLOOR_DECAL}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
  />
);

// --- Selection: scan and caliper ----------------------------------------------------

const SCAN_MS = 750;
const CALIPER_IN_MS = 260;
const CALIPER_OUT_MS = 400;
/** Longest step the effects take in one frame: a slow machine skips, never crawls. */
const MAX_STEP_MS = 250;

// The caliper: a rule with its two jaws turned toward the piece
const caliperFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTop;
  uniform float uGrow;
  uniform float uAlpha;
  varying vec2 vP;
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    vec2 p = vP;
    float top = uTop * uGrow;
    float d = seg(p, vec2(0.0, 0.0), vec2(0.0, top));
    d = min(d, seg(p, vec2(-0.12, 0.0), vec2(0.0, 0.0)));
    d = min(d, seg(p, vec2(-0.12, top), vec2(0.0, top)));
    float w = 0.008;
    float fw = fwidth(d);
    float a = (1.0 - smoothstep(w - fw, w + fw, d)) * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * 0.95);
    #include <colorspace_fragment>
  }`;

const caliperVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// The scanner: a thin ring of laser light that rides up round the piece with
// the scan line
const scannerFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float d = abs(length(vUv - 0.5) - 0.34);
    float fw = max(fwidth(d), 1e-4);
    float core = 1.0 - smoothstep(0.005 - fw, 0.005 + fw, d);
    float glow = exp(-d * d / 0.0009) * 0.35;
    float a = max(core, glow) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;
const scannerPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const up = new Vector3(0, 1, 0);
const turn = new Quaternion();
const facing = new Quaternion();
const at = new Vector3();

/**
 * The selected piece's measurement, taken once: the scan line and its ring
 * sweep up the piece while a caliper stands beside it (on the camera's side,
 * right), measuring its height; then the caliper fades and all is still.
 * Lives inside the piece's body, so it lifts with it.
 */
const Measure = ({ type }: { type: PieceType }) => {
  const top = pieceTop(cleanroomSet(), type);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const scanner = useRef<Mesh>(null);
  const { geometry, material, ring } = useMemo(() => {
    const geometry = new PlaneGeometry(0.2, top + 0.06).translate(0, (top + 0.06) / 2 - 0.03, 0);
    const ring = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: { uColor: { value: new Color(LASER_HOT) }, uAlpha: { value: 0 } },
      vertexShader: footprintVertex,
      fragmentShader: scannerFragment,
    });
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(LASER) },
        uTop: { value: top },
        uGrow: { value: 0 },
        uAlpha: { value: 1 },
      },
      vertexShader: caliperVertex,
      fragmentShader: caliperFragment,
    });
    return { geometry, material, ring };
  }, [top]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      ring.dispose();
      SCAN.value.set(-1, 0, 0, 0);
    },
    [geometry, material, ring],
  );

  useFrame(({ camera }, delta) => {
    // Stand the caliper on the camera's right of the piece
    const g = group.current;
    if (g?.parent) {
      g.parent.getWorldPosition(at);
      const yaw = Math.atan2(camera.position.x - at.x, camera.position.z - at.z);
      g.parent.getWorldQuaternion(turn).invert();
      facing.setFromAxisAngle(up, yaw);
      g.quaternion.copy(turn.multiply(facing));
    }
    if (done.current) return;
    elapsed.current += Math.min(delta * 1000, MAX_STEP_MS);
    const t = elapsed.current;
    const k = Math.min(t / SCAN_MS, 1);
    const ease = 1 - (1 - k) ** 2;
    const height = -0.05 + ease * (top + 0.1);
    SCAN.value.set(height, k < 1 ? 1 : 0, 0, 0);
    if (scanner.current) scanner.current.position.y = Math.max(height, 0.01);
    ring.uniforms.uAlpha.value = k < 1 ? 0.9 * Math.min(1, (1 - k) * 4) : 0;
    material.uniforms.uGrow.value = Math.min(t / CALIPER_IN_MS, 1);
    const out = Math.min(Math.max((t - SCAN_MS) / CALIPER_OUT_MS, 0), 1);
    material.uniforms.uAlpha.value = 1 - out;
    if (out >= 1) done.current = true;
    invalidate();
  });

  return (
    <>
      <mesh
        ref={scanner}
        geometry={scannerPlane}
        material={ring}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
      <group ref={group}>
        <mesh
          geometry={geometry}
          material={material}
          position={[0.5, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      </group>
    </>
  );
};

// --- Body ----------------------------------------------------------------------------

interface Army {
  body: Kind;
  collar: Kind;
  accent: Kind;
  /** The rook's accent is its whole hollow: kept in the army's own value, so from above a rook still reads as its army. */
  hollow: Kind;
}
const ARMY: Record<PieceColor, Army> = {
  white: { body: 'ceramic', collar: 'collar', accent: 'titanium', hollow: 'collar' },
  black: { body: 'carbon', collar: 'carbon', accent: 'steel', hollow: 'carbon' },
};
const accentOf = (army: Army, type: PieceType): Kind =>
  type === PieceType.Rook ? army.hollow : army.accent;

export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, level = 0, selected } = props;
  const state = stateOf(props);
  const army = ARMY[color];
  const keylines = hulls[color][state];
  return (
    <>
      <Footprint level={level} />
      <ChessPiece
        type={type}
        set={setFor(color)}
        parts={{
          body: pieceMaterial(army.body, state),
          collar: pieceMaterial(army.collar, state),
          accent: pieceMaterial(accentOf(army, type), state),
          foot: feet[level] ?? feet[0],
        }}
      />
      {keylines.map((m, i) => (
        <mesh key={i} geometry={hullGeometry(type, color)} material={m} raycast={noRaycast} />
      ))}
      {selected && <Measure type={type} />}
    </>
  );
};

/**
 * Sets how much of a dissolving piece is left (1 whole, 0 gone): above the
 * cut there is nothing, and a red-hot line glows where it is cut. One capture
 * plays at a time, so the cut is one shared uniform.
 */
export const setDissolve = (type: PieceType, left: number, level: number, flash: number) => {
  CUT.value.x = -0.03 + left * (pieceTop(cleanroomSet(), type) + 0.08);
  CUT.value.y = flash;
  // The LED foot powers down as the cut reaches it
  const foot = dissolveFeet[level];
  if (foot) {
    foot.color.set(LEVEL_FOOT[level]).lerp(POWERED_DOWN, left < 0.12 ? 1 : 0);
  }
};

/** A captured piece in its dissolving materials (see setDissolve). */
export const DissolvePiece = ({
  type,
  color,
  level = 0,
}: {
  type: PieceType;
  color: PieceColor;
  level?: number;
}) => {
  const army = ARMY[color];
  return (
    <ChessPiece
      type={type}
      set={setFor(color)}
      parts={{
        body: pieceMaterial(army.body, 'dissolve'),
        collar: pieceMaterial(army.collar, 'dissolve'),
        accent: pieceMaterial(accentOf(army, type), 'dissolve'),
        foot: dissolveFeet[level] ?? dissolveFeet[0],
      }}
    />
  );
};
