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
import {
  ChessPiece,
  PIECE_PARTS,
  buildPieceSet,
  partsGeometry,
  pieceSet,
  pieceTop,
} from '../../pieces';
import type { PieceSet } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import {
  CARBON,
  CARBON_WEAVE,
  CERAMIC,
  CERAMIC_COLLAR,
  CHECK,
  STEEL,
  KEYLINE,
  LASER,
  LASER_HOT,
  LEVEL,
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
// Selection is a measurement: a laser line scans up the piece, the piece
// takes a laser keyline, and a thin caliper bracket stands beside it,
// measuring its height, while the piece floats a little off the tray.

// --- Geometry ------------------------------------------------------------------------

// The shared set, turned with 18 sides instead of 24: indistinguishable at
// play distance, and it keeps the scene near its triangle budget with the
// white army's keylines. Built on first use.
let set: PieceSet | null = null;
export const cleanroomSet = (): PieceSet => (set ??= buildPieceSet({ segments: 18 }));

// --- Shader hooks --------------------------------------------------------------------

/** The selected piece's scan: x = height of the line (piece units), y = its strength. */
const SCAN = { value: new Vector4(-1, 0, 0, 0) };
const SCAN_COLOR = { value: new Color(LASER_HOT) };
/** A captured piece dissolving: x = height of the cut (piece units); above it, nothing. */
const CUT = { value: new Vector4(10, 0, 0, 0) };
const CUT_COLOR = { value: new Color(CHECK) };

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

// The 2×2 twill: tows two cells long, stepping one cell per row; each tow is
// brighter along its crown. Fades to its average where a cell is under a pixel.
const twill = /* glsl */ `
  {
    float around = atan(vObj.z, vObj.x) / 6.2831853 * 28.0;
    vec2 q = vec2(around, vObj.y / 0.04);
    vec2 id = floor(q);
    vec2 f = fract(q);
    float warp = step(mod(id.x + id.y, 4.0), 1.5);
    float across = mix(f.x, f.y, warp);
    float crown = sin(3.14159 * across);
    float k = 1.0 - smoothstep(0.35, 0.9, max(fwidth(q.x), fwidth(q.y)));
    vec3 weave = mix(diffuseColor.rgb, uWeave, warp * (0.55 + 0.45 * crown));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, uWeave, 0.35), weave, k);
    twillWarp = mix(0.5, warp, k);
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
        `#include <roughnessmap_fragment>\n${carbon ? 'roughnessFactor = mix(roughnessFactor + 0.12, roughnessFactor - 0.1, twillWarp);' : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float fres = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim.rgb * uRim.a * pow(fres, 2.5);
          float s = (vObj.y - uScan.x) / 0.018;
          float band = exp(-s * s) + 0.22 * exp(-max(uScan.x - vObj.y, 0.0) / 0.08) * step(vObj.y, uScan.x);
          totalEmissiveRadiance += uScanColor * band * uScan.y * uScanOn;
          ${dissolve ? 'float c = (uCut.x - vObj.y) / 0.03; totalEmissiveRadiance += uCutColor * 1.6 * exp(-c * c);' : ''}
        }`,
      );
  };

// --- Materials -----------------------------------------------------------------------

const RIM: Record<State, [string, number]> = {
  rest: ['#dfe8f3', 0],
  hover: [LASER_HOT, 0.08],
  selected: [LASER_HOT, 0.12],
  check: [CHECK, 0.1],
};

const materials = new Map<string, MeshPhysicalMaterial>();

const pieceMaterial = (kind: Kind, state: State | 'dissolve'): MeshPhysicalMaterial => {
  const key = `${kind}/${state}`;
  let m = materials.get(key);
  if (m) return m;
  switch (kind) {
    case 'ceramic':
      m = new MeshPhysicalMaterial({
        color: CERAMIC,
        roughness: 0.3,
        clearcoat: 0.8,
        clearcoatRoughness: 0.12,
        envMapIntensity: 0.75,
      });
      break;
    case 'collar':
      m = new MeshPhysicalMaterial({
        color: CERAMIC_COLLAR,
        roughness: 0.55,
        envMapIntensity: 0.7,
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
  const [rim, strength] =
    kind === 'carbon' && (state === 'rest' || dissolve)
      ? ['#dfe8f3', 0.18]
      : RIM[dissolve ? 'rest' : state];
  const c = new Color(rim);
  const uniforms: Record<string, { value: unknown }> = {
    uRim: { value: new Vector4(c.r, c.g, c.b, strength) },
    uWeave: { value: new Color(CARBON_WEAVE) },
    uScanOn: { value: state === 'selected' ? 1 : 0 },
  };
  m.fog = false;
  if (state === 'hover') m.emissive.set('#101010');
  m.onBeforeCompile = hook(kind, uniforms, dissolve);
  m.customProgramCacheKey = () => `cleanroom-${kind}${dissolve ? '-dissolve' : ''}`;
  materials.set(key, m);
  return m;
};

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';

/** The LED foot band, one per level. */
const feet = LEVEL.map(
  (c) => new MeshBasicMaterial({ color: new Color(c), toneMapped: false, fog: false }),
);

// --- Keyline -------------------------------------------------------------------------

const hullVertex = /* glsl */ `
  attribute vec3 aOutline;
  uniform float uWidth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * aOutline);
    // In proportion to depth: the line keeps its width on screen
    mv.xyz += n * uWidth * -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }`;

const hullMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: { uColor: { value: new Color(color) }, uWidth: { value: width } },
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
  });

/** Width of the keyline in radians of view (about a pixel at 720 px high). */
const KEY = 0.0011;
const hulls: Record<State, ShaderMaterial> = {
  rest: hullMaterial(KEYLINE, KEY),
  hover: hullMaterial(LASER, KEY * 1.1),
  selected: hullMaterial(LASER, KEY * 1.25),
  check: hullMaterial(CHECK, KEY * 1.1),
};

const hullGeometries = new Map<PieceType, BufferGeometry>();
/**
 * A piece's whole shape with one averaged normal per position, so the
 * inflated hull stays closed across the set's hard edges and part seams.
 */
const hullGeometry = (type: PieceType): BufferGeometry => {
  let g = hullGeometries.get(type);
  if (g) return g;
  // Turned pieces take their keyline from the low-detail set (a hull a pixel
  // wide hides the difference, at half the triangles); the sculpted knight
  // is decimated differently per set, so it takes its own shape
  const source = type === PieceType.Knight ? cleanroomSet() : pieceSet('low');
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
  hullGeometries.set(type, g);
  return g;
};

// --- Footprint -----------------------------------------------------------------------

// Quieter than any marker: a soft contact shadow, and round it the LED's
// light spilling on the tray, a soft band with no edge, so it can never be
// mistaken for a (crisp) laser ring
const footprintFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5);
    float shadow = 0.36 * (1.0 - smoothstep(0.08, 0.3, r));
    float spill = 0.28 * smoothstep(0.19, 0.29, r) * (1.0 - smoothstep(0.29, 0.44, r));
    vec3 c = mix(vec3(0.08, 0.1, 0.13), uColor, spill / max(spill + shadow * (1.0 - spill), 1e-4));
    float alpha = spill + shadow * (1.0 - spill);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;

const footprintVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const footprintPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
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
      vertexShader: footprintVertex,
      fragmentShader: footprintFragment,
    }),
);

/** The shadow and level ring under a piece (piece units: the plane is one unit across). */
export const Footprint = ({ level }: { level: number }) => (
  <mesh
    geometry={footprintPlane}
    material={footprints[level] ?? footprints[0]}
    position={[0, 0.004, 0]}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
  />
);

// --- Selection: scan and caliper ----------------------------------------------------

const SCAN_MS = 750;
const SCAN_PERIOD_MS = 2600;

const caliperFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTop;
  uniform float uGrow;
  varying vec2 vP;
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    vec2 p = vP;
    float top = uTop * uGrow;
    // The rule, its end jaws pointing at the piece, and ticks every 0.1
    float d = seg(p, vec2(0.0, 0.0), vec2(0.0, top));
    d = min(d, seg(p, vec2(-0.12, 0.0), vec2(0.0, 0.0)));
    d = min(d, seg(p, vec2(-0.12, top), vec2(0.0, top)));
    float tick = abs(fract(p.y / 0.1 + 0.5) - 0.5) * 0.1;
    float ticks = step(p.y, top) * step(0.0, p.y) * step(p.x, 0.035) * step(0.0, p.x);
    d = min(d, mix(1.0, tick, ticks));
    float w = 0.008;
    float fw = fwidth(d);
    float a = 1.0 - smoothstep(w - fw, w + fw, d);
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
 * The selected piece's measurement: the scan line that sweeps up it, and a
 * caliper bracket standing beside it, on the camera's right, measuring its
 * height. Lives inside the piece's body, so it lifts with it.
 */
const Measure = ({ type }: { type: PieceType }) => {
  const top = pieceTop(cleanroomSet(), type);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
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
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    const t = elapsed.current;
    // The scan: a sweep up, then a rest, repeating slowly
    const phase = t % SCAN_PERIOD_MS;
    const k = Math.min(phase / SCAN_MS, 1);
    const ease = 1 - (1 - k) ** 2;
    const height = -0.05 + ease * (top + 0.1);
    SCAN.value.set(height, k < 1 ? 1 : 0, 0, 0);
    if (scanner.current) scanner.current.position.y = Math.max(height, 0.01);
    ring.uniforms.uAlpha.value = k < 1 ? 0.9 * Math.min(1, (1 - k) * 4) : 0;
    material.uniforms.uGrow.value = Math.min(t / 260, 1);
    // Stand the caliper on the camera's right of the piece
    const g = group.current;
    if (g?.parent) {
      g.parent.getWorldPosition(at);
      const yaw = Math.atan2(camera.position.x - at.x, camera.position.z - at.z);
      g.parent.getWorldQuaternion(turn).invert();
      facing.setFromAxisAngle(up, yaw);
      g.quaternion.copy(turn.multiply(facing));
    }
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
          position={[0.42, 0, 0]}
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
  keyline: boolean;
}
const ARMY: Record<PieceColor, Army> = {
  white: { body: 'ceramic', collar: 'collar', accent: 'titanium', hollow: 'collar', keyline: true },
  black: { body: 'carbon', collar: 'carbon', accent: 'steel', hollow: 'carbon', keyline: false },
};
const accentOf = (army: Army, type: PieceType): Kind =>
  type === PieceType.Rook ? army.hollow : army.accent;

export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, level = 0, selected } = props;
  const state = stateOf(props);
  const army = ARMY[color];
  const keyline = army.keyline || state !== 'rest';
  return (
    <>
      <Footprint level={level} />
      <ChessPiece
        type={type}
        set={cleanroomSet()}
        parts={{
          body: pieceMaterial(army.body, state),
          collar: pieceMaterial(army.collar, state),
          accent: pieceMaterial(accentOf(army, type), state),
          foot: feet[level] ?? feet[0],
        }}
      />
      {keyline && (
        <mesh geometry={hullGeometry(type)} material={hulls[state]} raycast={noRaycast} />
      )}
      {selected && <Measure type={type} />}
    </>
  );
};

/**
 * Sets how much of a dissolving piece is left (1 whole, 0 gone): above the
 * cut there is nothing, and a red-hot line glows where it is cut. One capture
 * plays at a time, so the cut is one shared uniform.
 */
export const setDissolve = (type: PieceType, left: number) => {
  CUT.value.x = -0.03 + left * (pieceTop(cleanroomSet(), type) + 0.08);
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
      set={cleanroomSet()}
      parts={{
        body: pieceMaterial(army.body, 'dissolve'),
        collar: pieceMaterial(army.collar, 'dissolve'),
        accent: pieceMaterial(accentOf(army, type), 'dissolve'),
        foot: feet[level] ?? feet[0],
      }}
    />
  );
};
