import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { BASE_TOP, FLOOR_Y, TRAY_HALF, TRAY_MARGIN, frame } from './layout';
import {
  ANODISED,
  CHUCK,
  HOUSING,
  HOUSING_DARK,
  LEVEL_DEEP,
  LEVEL_LED,
  LEVEL_RIM,
} from './palette';

// The board as a piece of lab equipment: five clear polycarbonate trays held
// in a four-post cassette on a machined base.
//
// Each tray is edge-lit. An LED strip in the level's colour runs round its
// rim, and, as in real edge-lit acrylic, the light travels through the sheet
// and catches wherever the surface is cut: every square is an engraved pocket
// (a rounded-square outline, like a waffle tray for dies), and the pockets
// glow in the level's colour, a little brighter near the rim. So the 25
// squares of a level read as 25 separate cells, each tray says its level in
// its own colour, and the sheet itself stays nearly clear, so the pieces
// below show through four trays. The Raumschach squares (x + y + z even) are
// a faint cool smoke, enough for a bishop's colour without greying the view.

const trayVertex = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const trayFragment = /* glsl */ `
  uniform vec3 uLed;
  uniform vec3 uDeep;
  uniform vec3 uSmoke;
  uniform float uHalf;
  uniform float uTray;
  uniform float uPitch;
  uniform float uParity;
  uniform float uClear;
  uniform float uSmokeA;
  uniform float uLine;
  uniform float uGlow;
  uniform float uWidth;
  uniform float uInset;
  uniform float uRadius;
  uniform float uKeep;
  uniform float uHalo;
  varying vec2 vLocal;
  varying vec3 vWorld;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  vec4 over(vec4 base, vec3 c, float a) {
    float outA = a + base.a * (1.0 - a);
    vec3 outC = (c * a + base.rgb * base.a * (1.0 - a)) / max(outA, 1e-4);
    return vec4(outC, outA);
  }

  void main() {
    // Squares from the tray's corner (a1 at the origin for White); PlaneGeometry's
    // y runs toward rank 5
    vec2 cell = (vLocal + uHalf) / uPitch;
    vec2 fw = fwidth(cell);
    float px = max(max(fw.x, fw.y), 1e-5);
    vec2 id = floor(cell);
    vec2 f = cell - id - 0.5;
    float inside = step(0.0, cell.x) * step(cell.x, 5.0) * step(0.0, cell.y) * step(cell.y, 5.0);

    // The engraved pocket round each square
    float d = abs(roundBox(f, 0.5 - uInset, uRadius));
    float hw = max(uWidth * 0.5, px * 0.5);
    float pocket = (1.0 - smoothstep(hw - px * 0.5, hw + px * 0.5, d)) * min(1.0, uWidth / px);
    pocket *= inside;

    // Edge light: strongest at the rim, fading into the sheet
    float rim = uTray - max(abs(vLocal.x), abs(vLocal.y));
    float glow = exp(-rim / 0.2);

    // Raumschach colouring (x + y + z even is dark, Aa1 dark)
    float dark = 1.0 - step(0.5, mod(id.x + id.y + uParity, 2.0));

    // Seen from above (from about 33° up), the five grids would nest into a
    // plaid: every tray but the one in play (the focused level) thins to a
    // quiet lattice and drops its smoke
    vec3 view = normalize(cameraPosition - vWorld);
    float steep = smoothstep(0.55, 0.85, abs(view.y));
    float lineA = uLine * mix(1.0, mix(0.2, 1.0, uKeep), steep);
    float smokeA = mix(1.0, uKeep, steep);

    if (rim < -0.075) {
      // Outside the tray: only the LED's glow, falling off into the air
      float halo = exp((rim + 0.075) / 0.07) * uHalo;
      if (halo < 0.003) discard;
      gl_FragColor = vec4(uLed, halo);
      #include <colorspace_fragment>
      return;
    }
    vec4 c = vec4(uSmoke, (uClear + uSmokeA * dark * inside * smokeA) * step(0.0, rim));
    c = over(c, uLed, glow * uGlow * mix(1.0, 0.5 + 0.5 * uKeep, steep) * step(0.0, rim));
    c = over(c, mix(uDeep, uLed, glow * 0.7), pocket * lineA);
    if (c.a < 0.003) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

export interface TraysProps {
  focusLevel: number | null;
}

/** How far the rim's glow reaches past the tray. */
const HALO = 0.3;
const HALO_A = 0.2;
const LINE = 0.62;
const LINE_FOCUS = 0.95;
const LINE_DIM = 0.45;
const GLOW = 0.2;
/** How far the other trays' rims fade toward the housing while one is in focus. */
const RIM_DIM = 0.6;

const housingGrey = new Color(HOUSING);

// Trays can be powered down (the mated king's, as the game ends): 0 lit, 1 off
const powered = new Map<number, number>();
let repower: (() => void) | null = null;
/** Powers a tray's LEDs down (1) or back up (0): its rim goes grey and its engraving dark. */
export const powerDownTray = (level: number, k: number) => {
  powered.set(level, k);
  repower?.();
};

/** The five edge-lit trays, their LED rims, and the cassette that holds them. */
export const Trays = ({ focusLevel }: TraysProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const { surface, rim, housing, focusRim } = useMemo(
    () => ({
      // Past the rim, for the LED's glow in the air round the tray
      surface: new PlaneGeometry((TRAY_HALF + HALO) * 2, (TRAY_HALF + HALO) * 2),
      rim: frameGeometry(TRAY_HALF, 0.04, 0.045),
      housing: frameGeometry(TRAY_HALF + 0.04, 0.035, 0.045).translate(0, 0.004, 0),
      focusRim: frameGeometry(TRAY_HALF, 0.04, 0.045).translate(0, 0.012, 0),
    }),
    [],
  );
  useEffect(
    () => () => [surface, rim, housing, focusRim].forEach((g) => g.dispose()),
    [surface, rim, housing, focusRim],
  );

  const materials = useMemo(
    () =>
      frame.levelY.map((_, z) => ({
        tray: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: {
            uLed: { value: new Color(LEVEL_LED[z]) },
            uDeep: { value: new Color(LEVEL_DEEP[z]) },
            uSmoke: { value: new Color('#a7bdd3') },
            uHalf: { value: frame.half },
            uTray: { value: TRAY_HALF },
            uPitch: { value: frame.pitch },
            uParity: { value: z % 2 },
            uClear: { value: 0.025 },
            uSmokeA: { value: 0.055 },
            uLine: { value: LINE },
            uGlow: { value: GLOW },
            uWidth: { value: 0.022 },
            uInset: { value: 0.06 },
            uRadius: { value: 0.1 },
            uKeep: { value: 0 },
            uHalo: { value: HALO_A },
          },
          vertexShader: trayVertex,
          fragmentShader: trayFragment,
        }),
        led: new Color(LEVEL_RIM[z]),
        rim: new MeshBasicMaterial({ color: LEVEL_RIM[z], toneMapped: false, fog: false }),
        focus: new MeshBasicMaterial({
          color: new Color(LEVEL_RIM[z]).lerp(new Color('#ffffff'), 0.3),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    [],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.tray.dispose();
        m.rim.dispose();
        m.focus.dispose();
      }),
    [materials],
  );
  const housingMaterial = useMemo(
    () => new MeshStandardMaterial({ color: HOUSING_DARK, roughness: 0.42, metalness: 0.55 }),
    [],
  );
  useEffect(() => () => housingMaterial.dispose(), [housingMaterial]);

  // The latest focus weights, so a power-down can be applied between focus changes
  const focus = useRef({ weights: frame.levelY.map(() => 0), any: 0 });
  const apply = () => {
    const { weights, any } = focus.current;
    weights.forEach((w, z) => {
      const m = materials[z];
      const off = powered.get(z) ?? 0;
      const lit = 1 - off * 0.85;
      const base = LINE * (1 - any * (1 - LINE_DIM / LINE) * (1 - w));
      m.tray.uniforms.uLine.value = (base + (LINE_FOCUS - base) * w) * (1 - off * 0.5);
      m.tray.uniforms.uGlow.value = (GLOW * (1 - any * 0.4 * (1 - w)) + 0.06 * w) * lit;
      m.focus.opacity = w * lit;
      // The tray that keeps its engraving from above: the focused one (with
      // none in focus, every tray is quiet, and each piece's own pocket lights)
      m.tray.uniforms.uKeep.value = w;
      m.tray.uniforms.uHalo.value = (HALO_A * (1 - any * 0.35 * (1 - w)) + 0.06 * w) * lit;
      // While a level is in focus (a piece held or pointed at), the other
      // rims fade toward the housing, so the markers stay the brightest marks
      m.rim.color.copy(m.led).lerp(housingGrey, Math.max(any * RIM_DIM * (1 - w), off));
    });
  };
  // A new board starts with every tray lit
  useEffect(() => powered.clear(), []);
  useEffect(() => {
    repower = () => {
      apply();
      invalidate();
    };
    return () => {
      repower = null;
    };
  });

  useLevelFocus(
    focusLevel,
    (weights, any) => {
      focus.current = { weights: [...weights], any };
      apply();
    },
    { levels: frame.levelY.length, ms: 160, key: materials },
  );

  return (
    <group name="cleanroom-trays">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surface}
            material={materials[z].tray}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh geometry={rim} material={materials[z].rim} raycast={noRaycast} />
          <mesh
            geometry={focusRim}
            material={materials[z].focus}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh geometry={housing} material={housingMaterial} raycast={noRaycast} />
        </group>
      ))}
      <LevelMeters />
      <Cassette />
    </group>
  );
};

// --- Level meters ---------------------------------------------------------------------

/**
 * A count beside the colour: centred on each side of a tray, in its margin,
 * a meter of five small LED pips with one lit for A up to five for E
 * ("●●●○○" is C), so a level can be told without its hue.
 */
const LevelMeters = () => {
  const mesh = useMemo(() => {
    const pips: { at: [number, number, number]; lit: boolean; z: number }[] = [];
    const m = frame.half + TRAY_MARGIN / 2;
    frame.levelY.forEach((y, z) => {
      for (const [ax, az, sign] of [
        [1, 0, 1],
        [1, 0, -1],
        [0, 1, 1],
        [0, 1, -1],
      ]) {
        for (let k = 0; k < 5; k++) {
          const along = (k - 2) * 0.1;
          const x = ax ? along : sign * m;
          const zz = az ? along : sign * m;
          pips.push({ at: [x, y + 0.004, zz], lit: k <= z, z });
        }
      }
    });
    const inst = new InstancedMesh(
      new CylinderGeometry(0.024, 0.024, 0.008, 8),
      new MeshBasicMaterial({ toneMapped: false, fog: false }),
      pips.length,
    );
    const matrix = new Matrix4();
    const color = new Color();
    pips.forEach((pip, i) => {
      inst.setMatrixAt(i, matrix.makeTranslation(...pip.at));
      inst.setColorAt(i, color.set(pip.lit ? LEVEL_RIM[pip.z] : HOUSING));
    });
    inst.raycast = noRaycast;
    return inst;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    },
    [mesh],
  );
  return <primitive object={mesh} />;
};

// --- The cassette and base ----------------------------------------------------------

const POST = TRAY_HALF + 0.11;
const TOP = frame.levelY[frame.levelY.length - 1] + 0.62;

const cassetteGeometry = (): {
  metal: BufferGeometry;
  base: BufferGeometry;
  chuck: BufferGeometry;
} => {
  const metal: BufferGeometry[] = [];
  const corners = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of corners) {
    const x = sx * POST;
    const z = sz * POST;
    // The post, and a cap
    metal.push(
      new CylinderGeometry(0.018, 0.018, TOP - BASE_TOP, 8).translate(x, (TOP + BASE_TOP) / 2, z),
    );
    metal.push(new CylinderGeometry(0.035, 0.035, 0.04, 10).translate(x, TOP + 0.02, z));
    // A clamp under each tray's corner
    for (const y of frame.levelY) {
      metal.push(
        new BoxGeometry(0.12, 0.03, 0.12).translate(x - sx * 0.04, y - 0.06, z - sz * 0.04),
      );
    }
  }
  const baseHalf = TRAY_HALF + 0.35;
  const base = new BoxGeometry(baseHalf * 2, BASE_TOP - FLOOR_Y, baseHalf * 2).translate(
    0,
    (BASE_TOP + FLOOR_Y) / 2,
    0,
  );
  const chuck = new BoxGeometry(baseHalf * 2 - 0.16, 0.03, baseHalf * 2 - 0.16).translate(
    0,
    BASE_TOP + 0.015,
    0,
  );
  // The brushed chamfer round the base's top edge, catching the light
  metal.push(frameGeometry(baseHalf - 0.05, 0.05, 0.035).translate(0, BASE_TOP + 0.004, 0));
  const merged = mergeGeometries(metal)!;
  metal.forEach((g) => g.dispose());
  return { metal: merged, base, chuck };
};

const Cassette = () => {
  const { geometry, materials } = useMemo(
    () => ({
      geometry: cassetteGeometry(),
      materials: {
        metal: new MeshStandardMaterial({ color: '#e1e6ec', roughness: 0.35, metalness: 0.6 }),
        // Dark anodised: the white army stands over a dark plinth
        base: new MeshStandardMaterial({ color: ANODISED, roughness: 0.4, metalness: 0.6 }),
        chuck: new MeshStandardMaterial({ color: CHUCK, roughness: 0.75, metalness: 0.2 }),
      },
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(geometry).forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
    [geometry, materials],
  );
  return (
    <group name="cassette">
      <mesh geometry={geometry.metal} material={materials.metal} raycast={noRaycast} />
      <mesh geometry={geometry.base} material={materials.base} raycast={noRaycast} />
      <mesh geometry={geometry.chuck} material={materials.chuck} raycast={noRaycast} />
    </group>
  );
};
