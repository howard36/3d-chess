import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { DirectionalLight } from 'three';
import { PieceType } from '../../../engine/pieces';
import type { Orientation } from '../../layout';
import { PIECE_PARTS, partsGeometry, pieceSet } from '../../pieces';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import type { StageProps } from '../types';
import {
  BAYS,
  CLOCK_BAY,
  clockDrawing,
  ENGRAVE_IN,
  ENGRAVE_OUT,
  engraving,
  FRAME_SIZE,
  FRAME_Y,
  FRAMED_BAYS,
  panorama,
  POSITIONS,
  positionDrawing,
  WALL_HEIGHT,
  WALL_RADIUS,
} from './drawings';
import { TOWER_MASK, towerCoverAt, withTowerMask } from './mask';
import { rig } from './pieces';
import { APERTURE, FLOOR_Y, FRAME, PALETTE, TABLE_RADIUS, TABLE_Y } from './palette';

// The chess studio after hours. The tower stands over a round projector
// table of dark glass, its rim engraved with the board's file letters and
// rank numbers, a faint curtain of striated light rising from its aperture.
// Round the room, in the gloom: six plinths, each bearing a larger-than-life
// chess piece drawn in hard light (a knight, a king, a rook, a queen, a
// bishop and Raumschach's own unicorn), about sixty degrees apart so every
// side of the room has one; four famous positions framed on the wall as
// small eight-by-eight boards drawn in thin light, and a chess clock drawn
// the same way; a glass wall onto a night city blurred to bokeh; a floor of
// dark panels. Everything is still (nothing
// moves behind the tower), low in contrast, and held down wherever it lies
// behind the tower, seen through its panes (mask.ts): props to nothing, the
// wall and the floor to a murmur. From straight above, under the panes,
// there is only the table's dark glass.

// --- The glass wall -------------------------------------------------------------------

// Behind the tower the wall is held down to a murmur (mask.ts), per vertex
// on a finer mesh rather than per pixel: the review machine renders in
// software.
const wallVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vCover;
  ${TOWER_MASK}
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vCover = towerCover(w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const wallFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vCover;
  void main() {
    vec3 col = texture2D(uMap, vUv).rgb * mix(1.0, 0.3, vCover);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

let pano: CanvasTexture | null = null;
/** The panorama, painted on first use and shared by the wall and the floor's reflection. */
const panoramaTexture = () => (pano ??= panorama());

const GlassWall = () => {
  const { geometry, material } = useMemo(() => {
    const geometry = new CylinderGeometry(WALL_RADIUS, WALL_RADIUS, WALL_HEIGHT, 96, 12, true);
    geometry.translate(0, FLOOR_Y + WALL_HEIGHT / 2, 0);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { uMap: { value: panoramaTexture() } },
      vertexShader: wallVertex,
      fragmentShader: wallFragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={-950} raycast={noRaycast} />;
};

// --- Framed positions ----------------------------------------------------------------------

const FramedPositions = () => {
  const invalidate = useThree((s) => s.invalidate);
  const { plane, clockPlane, materials, clock } = useMemo(() => {
    const drawing = (map: CanvasTexture) =>
      withTowerMask(
        new MeshBasicMaterial({
          map,
          transparent: true,
          opacity: 0.42,
          blending: AdditiveBlending,
          depthWrite: false,
          color: new Color(PALETTE.holo),
          fog: false,
        }),
        0,
        true,
      );
    return {
      plane: new PlaneGeometry(FRAME_SIZE, (FRAME_SIZE * 600) / 512),
      clockPlane: new PlaneGeometry(5.2, 3.25),
      materials: POSITIONS.map((p) => drawing(positionDrawing(p.fen, p.caption))),
      clock: drawing(clockDrawing()),
    };
  }, []);
  useEffect(() => invalidate(), [invalidate]);
  useEffect(
    () => () => {
      plane.dispose();
      clockPlane.dispose();
      [...materials, clock].forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    },
    [plane, clockPlane, materials, clock],
  );
  const onWall = (bay: number, y: number) => {
    const a = ((bay + 0.5) / BAYS) * Math.PI * 2;
    const r = WALL_RADIUS - 0.4;
    return {
      position: [Math.sin(a) * r, y, Math.cos(a) * r] as [number, number, number],
      // Facing the table
      rotation: [0, a + Math.PI, 0] as [number, number, number],
    };
  };
  return (
    <group name="lumina-positions">
      {FRAMED_BAYS.map((bay, i) => (
        <mesh
          key={bay}
          geometry={plane}
          material={materials[i]}
          {...onWall(bay, FRAME_Y)}
          renderOrder={-900}
          raycast={noRaycast}
        />
      ))}
      <mesh
        geometry={clockPlane}
        material={clock}
        {...onWall(CLOCK_BAY, FRAME_Y - 0.3)}
        renderOrder={-900}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- The floor --------------------------------------------------------------------------

// The sculptures, round the room (degrees, from +z toward +x; the opening
// view looks from 16° toward 196°): six, spread evenly but for the pair that
// frames the tower as the game opens, the knight and the king, set wide
// enough to stand clear of the tower and its level letters
const SCULPTURES: { angle: number; radius: number; type: PieceType }[] = [
  { angle: 142, radius: 16.5, type: PieceType.Knight },
  { angle: 250, radius: 16.5, type: PieceType.King },
  { angle: 300, radius: 17.5, type: PieceType.Rook },
  { angle: 351, radius: 17, type: PieceType.Queen },
  { angle: 41, radius: 17.5, type: PieceType.Bishop },
  { angle: 92, radius: 17, type: PieceType.Unicorn },
];

/** How strongly each sculpture's pool shows: it goes with the sculpture (Sculptures). */
const lampK = SCULPTURES.map(() => 1);

/** Soft pools of light on the floor (x, z, radius), under the sculptures. */
const LAMPS = SCULPTURES.map(({ angle, radius }) => {
  const a = (angle * Math.PI) / 180;
  return new Vector3(Math.sin(a) * radius, Math.cos(a) * radius, 2.2);
});

const floorVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// The floor's vertices carry the tower mask, the reflection's hit on the
// wall and the soft pools of light; its pixels draw only what is fine: the
// panel seams and the reflection's sample
const floorMaskedVertex = /* glsl */ `
  uniform vec3 uWall;
  uniform vec3 uLight;
  uniform vec3 uLamp;
  uniform vec3 uLamps[6];
  uniform float uLampK[6];
  uniform float uTable;
  varying vec2 vP;
  varying float vCover;
  varying vec3 vHit;
  varying float vFresnel;
  varying float vSteep;
  varying vec3 vGlow;
  ${TOWER_MASK}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vCover = towerCover(w.xyz);
    // Where the floor's reflection meets the glass wall
    vec3 view = normalize(w.xyz - cameraPosition);
    vec3 d = reflect(view, vec3(0.0, 1.0, 0.0));
    vec2 o = w.xz;
    float a = max(dot(d.xz, d.xz), 1e-5);
    float b = dot(o, d.xz);
    float c = dot(o, o) - uWall.x * uWall.x;
    float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
    vHit = w.xyz + d * t;
    vFresnel = 0.06 + 0.94 * pow(1.0 - abs(view.y), 3.0);
    vSteep = smoothstep(0.5, 0.9, abs(view.y));
    float r = length(o);
    float spill = max(r - uTable, 0.0) / 3.2;
    float pool = exp(-spill * spill) * 0.5;
    float lamps = 0.0;
    for (int i = 0; i < 6; i++) {
      vec2 dl = o - uLamps[i].xy;
      lamps += exp(-dot(dl, dl) / (uLamps[i].z * uLamps[i].z)) * uLampK[i];
    }
    vGlow = (uLight * pool * 0.045 + uLamp * lamps * 0.035) * (1.0 - vCover);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uFloor;
  uniform vec3 uSeam;
  uniform float uTable;
  uniform sampler2D uPano;
  uniform vec3 uWall;
  varying vec2 vP;
  varying float vCover;
  varying vec3 vHit;
  varying float vFresnel;
  varying float vSteep;
  varying vec3 vGlow;
  vec3 reflection() {
    float v = (vHit.y - uWall.y) / uWall.z;
    float u = atan(vHit.x, vHit.z) / 6.2831853;
    vec3 col = textureLod(uPano, vec2(u, clamp(v, 0.0, 1.0)), 2.2).rgb;
    return col * (1.0 - smoothstep(0.8, 1.0, v)) * vFresnel;
  }
  // Seams of long floor panels laid in a running bond (not a chessboard)
  float seams(vec2 p, vec2 size, float width) {
    vec2 q = p / size;
    vec2 fw = max(fwidth(q), vec2(1e-4));
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 d = abs(fract(q - 0.5) - 0.5);
    vec2 w = width / size;
    vec2 l = 1.0 - smoothstep(w, w + fw * 1.5, d);
    return max(l.x, l.y) * (1.0 - smoothstep(0.08, 0.3, max(fw.x, fw.y)));
  }
  void main() {
    float r = length(vP);
    float seam = seams(vP + vec2(1.2, 0.6), vec2(3.6, 1.2), 0.012);
    float away = 1.0 - smoothstep(10.0, 28.0, r);
    vec3 col = uFloor;
    // Clear floor round the table: nothing sharp shows through the panes
    float clear = smoothstep(uTable + 1.5, uTable + 4.0, r);
    float hidden = 1.0 - vCover;
    // From high up the seams would read as a brick wall; they fade there
    col += uSeam * seam * 0.22 * away * clear * mix(0.2, 1.0, hidden) * (1.0 - 0.7 * vSteep);
    col += vGlow;
    col += reflection() * 1.0 * mix(1.0, 0.3, vCover);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Floor = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new PlaneGeometry(64, 64, 48, 48).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        uniforms: {
          uFloor: { value: new Color(PALETTE.floor) },
          uSeam: { value: new Color(PALETTE.floorSeam) },
          uLight: { value: new Color(PALETTE.projector) },
          uTable: { value: TABLE_RADIUS },
          uPano: { value: panoramaTexture() },
          uWall: { value: new Vector3(WALL_RADIUS, FLOOR_Y, WALL_HEIGHT) },
          uLamp: { value: new Color(PALETTE.lamp) },
          uLamps: { value: LAMPS },
          uLampK: { value: lampK },
        },
        vertexShader: floorMaskedVertex,
        fragmentShader: floorFragment,
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
    <mesh geometry={geometry} material={material} position={[0, FLOOR_Y, 0]} raycast={noRaycast} />
  );
};

// --- The projector table ------------------------------------------------------------------

const tableTopFragment = /* glsl */ `
  uniform vec3 uGlass;
  uniform vec3 uLight;
  uniform vec3 uDeep;
  uniform float uAperture;
  uniform float uRadius;
  varying vec2 vP;
  varying vec3 vWorld;
  ${TOWER_MASK}
  float hexCell(vec2 p) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 h = abs(g);
    return 0.5 - max(dot(h, normalize(vec2(1.0, 1.7320508))), h.x);
  }
  void main() {
    float r = length(vP);
    float fr = max(fwidth(r), 1e-4);
    // Dark glass under the tower; the emitters a fine honeycomb in a band
    // just inside the aperture ring, dim, brightening toward it
    float band = smoothstep(uAperture - 0.7, uAperture - 0.4, r) * step(r, uAperture - 0.06);
    float cell = hexCell(vP / 0.16);
    float fc = max(fwidth(cell), 1e-4);
    float lattice = (1.0 - smoothstep(0.04, 0.04 + fc * 1.5, cell)) * (1.0 - smoothstep(0.1, 0.35, fc));
    float toward = smoothstep(uAperture - 0.7, uAperture, r);
    float ring = 1.0 - smoothstep(0.016, 0.016 + fr * 1.5, abs(r - uAperture));
    float ringGlow = exp(-pow((r - uAperture) / 0.14, 2.0));
    float bezel = 1.0 - smoothstep(0.006, 0.006 + fr * 1.5, abs(r - (uRadius - 0.05)));
    // Whatever of it the panes lie in front of goes out; from high up, what
    // remains quietens further
    float hidden = towerMask(vWorld, 0.0);
    float steep = abs(normalize(vWorld - cameraPosition).y);
    float quiet = hidden * (1.0 - 0.5 * smoothstep(0.5, 0.9, steep));
    vec3 col = uGlass * (0.8 + 0.4 * smoothstep(0.0, uAperture, r));
    col += uDeep * band * (0.04 + lattice * 0.25) * toward * quiet;
    col += uLight * (ring * 0.16 + ringGlow * 0.045 + bezel * 0.04) * quiet;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const TableTop = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new CircleGeometry(TABLE_RADIUS, 96).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        uniforms: {
          uGlass: { value: new Color('#04070d') },
          uLight: { value: new Color(PALETTE.emitter) },
          uDeep: { value: new Color(PALETTE.projectorDeep) },
          uAperture: { value: APERTURE },
          uRadius: { value: TABLE_RADIUS },
        },
        vertexShader: floorVertex,
        fragmentShader: tableTopFragment,
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
    <mesh geometry={geometry} material={material} position={[0, TABLE_Y, 0]} raycast={noRaycast} />
  );
};

const engraveVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const engraveFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uIn;
  uniform float uOut;
  varying vec2 vP;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    float r = length(vP);
    float u = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);
    // Up in the texture is in toward the centre
    float v = (uOut - r) / (uOut - uIn);
    float a = texture2D(uMap, vec2(u, v)).a;
    a *= towerMask(vWorld, 0.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const Engraving = ({ orientation }: { orientation: Orientation }) => {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(
    () => new RingGeometry(ENGRAVE_IN, ENGRAVE_OUT, 192, 1).rotateX(-Math.PI / 2),
    [],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uMap: { value: engraving(orientation) },
          uColor: { value: new Color(PALETTE.emitter).multiplyScalar(0.34) },
          uIn: { value: ENGRAVE_IN },
          uOut: { value: ENGRAVE_OUT },
        },
        vertexShader: engraveVertex,
        fragmentShader: engraveFragment,
      }),
    [orientation],
  );
  useEffect(() => invalidate(), [material, invalidate]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      (material.uniforms.uMap.value as CanvasTexture).dispose();
      material.dispose();
    },
    [material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, TABLE_Y + 0.003, 0]}
      raycast={noRaycast}
    />
  );
};

const TableBody = () => {
  const { side, band, bandMaterial, sideMaterial } = useMemo(() => {
    const h = TABLE_Y - FLOOR_Y;
    return {
      side: new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.86, h, 96, 1, true).translate(
        0,
        FLOOR_Y + h / 2,
        0,
      ),
      band: new CylinderGeometry(TABLE_RADIUS + 0.004, TABLE_RADIUS + 0.004, 0.025, 96, 1, true),
      sideMaterial: new MeshLambertMaterial({ color: '#0a0e18' }),
      bandMaterial: withTowerMask(
        new MeshBasicMaterial({
          color: new Color(PALETTE.emitter).multiplyScalar(0.28),
          toneMapped: false,
          fog: false,
        }),
        0,
      ),
    };
  }, []);
  useEffect(
    () => () => {
      side.dispose();
      band.dispose();
      sideMaterial.dispose();
      bandMaterial.dispose();
    },
    [side, band, sideMaterial, bandMaterial],
  );
  return (
    <>
      <mesh geometry={side} material={sideMaterial} raycast={noRaycast} />
      <mesh
        geometry={band}
        material={bandMaterial}
        position={[0, TABLE_Y - 0.06, 0]}
        raycast={noRaycast}
      />
    </>
  );
};

// The faint curtain of light rising from the aperture ring
const curtainVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vY;
  varying float vCover;
  ${TOWER_MASK}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vY = world.y;
    vCover = towerCover(world.xyz);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const curtainFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vY;
  varying float vCover;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = pow(1.0 - facing, 1.6);
    float k = (vY - uBase) / uHeight;
    float rise = exp(-k * 5.0) * (1.0 - smoothstep(0.6, 1.0, k)) * (1.0 - vCover);
    if ((0.003 + edge * 0.014) * rise < 0.0008) discard;
    float ang = atan(vWorld.z, vWorld.x);
    float rays = 0.5 + 0.5 * sin(ang * 120.0 + 2.0 * sin(ang * 37.0));
    rays = mix(0.25, 1.0, rays * rays);
    // Seen from above, the curtain's wall would stack into a bright ring
    float steep = abs(normalize(vView).y);
    float a = (0.003 + edge * 0.012) * rise * rays * (1.0 - smoothstep(0.5, 0.8, steep));
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const Curtain = () => {
  const height = FRAME.levelY[4] + 1.2 - TABLE_Y;
  const { geometry, material } = useMemo(
    () => ({
      geometry: new CylinderGeometry(APERTURE + 0.05, APERTURE, height, 96, 8, true).translate(
        0,
        TABLE_Y + height / 2,
        0,
      ),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
        uniforms: {
          uColor: { value: new Color(PALETTE.curtain) },
          uBase: { value: TABLE_Y },
          uHeight: { value: height },
        },
        vertexShader: curtainVertex,
        fragmentShader: curtainFragment,
      }),
    }),
    [height],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={-10} raycast={noRaycast} />;
};

// --- The sculptures -------------------------------------------------------------------------

/**
 * A piece drawn in hard light: its surface cut by level planes every little
 * way up (contour lines), and by six planes through its axis (the meridians
 * of a turned piece, the profile of the knight's head), as line segments.
 * Works for every piece of the set, the sculpted knight and the unicorn's
 * spiral horn included.
 */
const wireOf = (type: PieceType): BufferGeometry => {
  const source = partsGeometry(pieceSet('low'), type, PIECE_PARTS)!;
  const pos = source.getAttribute('position');
  const index = source.getIndex();
  const count = index ? index.count : pos.count;
  const vertex = (i: number, out: Vector3) =>
    out.fromBufferAttribute(pos, index ? index.getX(i) : i);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const segments: number[] = [];
  // Cuts every triangle by the plane n·p = d, keeping the segment across it
  const cut = (nx: number, ny: number, nz: number, d: number, side?: (p: Vector3) => boolean) => {
    const f = (p: Vector3) => p.x * nx + p.y * ny + p.z * nz - d;
    const hits: Vector3[] = [];
    for (let t = 0; t < count; t += 3) {
      vertex(t, a);
      vertex(t + 1, b);
      vertex(t + 2, c);
      const fa = f(a);
      const fb = f(b);
      const fc = f(c);
      hits.length = 0;
      for (const [p, q, fp, fq] of [
        [a, b, fa, fb],
        [b, c, fb, fc],
        [c, a, fc, fa],
      ] as const) {
        if (fp < 0 !== fq < 0) hits.push(p.clone().lerp(q, fp / (fp - fq)));
      }
      if (hits.length === 2 && (!side || (side(hits[0]) && side(hits[1])))) {
        segments.push(hits[0].x, hits[0].y, hits[0].z, hits[1].x, hits[1].y, hits[1].z);
      }
    }
  };
  source.computeBoundingBox();
  const top = source.boundingBox!.max.y;
  // Contours, closer together low down where the base's mouldings are
  for (let y = 0.012; y < top; y += y < 0.2 ? 0.022 : 0.03) cut(0, 1, 0, y);
  // Meridians: half-planes through the axis
  for (let k = 0; k < 6; k++) {
    const phi = (k / 6) * Math.PI;
    cut(Math.cos(phi), 0, Math.sin(phi), 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3));
  return g;
};

const SCULPTURE_SCALE = 2.8;
const PLINTH_H = 1.0;

const LINE_OPACITY = 0.065;
const PLINTH = new Color(PALETTE.plinth);
const CAP = new Color(PALETTE.holo).multiplyScalar(0.07);
/** How dim a sculpture's plinth gets behind the tower: a quiet object, never a hole. */
const PLINTH_FLOOR = 0.35;
const FADE_MS = 300;
const across = new Vector3();

/**
 * The sculptures. Each fades as a whole, eased, wherever it lies behind the
 * tower or its level letters (never sliced by a per-pixel mask): its wire
 * goes out and its plinth dims to a quiet dark object.
 */
const Sculptures = () => {
  const invalidate = useThree((s) => s.invalidate);
  const parts = useMemo(() => {
    const plinth = new BoxGeometry(1.5, PLINTH_H, 1.5).translate(0, PLINTH_H / 2, 0);
    const cap = new BoxGeometry(1.3, 0.02, 1.3);
    const each = SCULPTURES.map(() => ({
      plinth: new MeshLambertMaterial({ color: PLINTH.clone() }),
      cap: new MeshBasicMaterial({ color: CAP.clone(), toneMapped: false }),
      line: new LineBasicMaterial({
        color: PALETTE.holo,
        transparent: true,
        opacity: LINE_OPACITY,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    }));
    const forms = SCULPTURES.map((s) => wireOf(s.type));
    return { plinth, cap, each, forms };
  }, []);
  useEffect(
    () => () => {
      parts.plinth.dispose();
      parts.cap.dispose();
      parts.each.forEach((m) => [m.plinth, m.cap, m.line].forEach((x) => x.dispose()));
      parts.forms.forEach((f) => f.dispose());
    },
    [parts],
  );
  const cover = useRef(SCULPTURES.map(() => -1));
  useFrame(({ camera }, delta) => {
    const step = (Math.min(delta, 1 / 8) * 1000) / FADE_MS;
    // Across the view, for the sculpture's left and right edges
    across.set(camera.position.z, 0, -camera.position.x).normalize();
    let moving = false;
    SCULPTURES.forEach((s, i) => {
      const a = (s.angle * Math.PI) / 180;
      const x = Math.sin(a) * s.radius;
      const z = Math.cos(a) * s.radius;
      const base = FLOOR_Y + PLINTH_H;
      const top = base + 0.87 * SCULPTURE_SCALE;
      const mid = (base + top) / 2;
      const w = 0.6;
      const goal = Math.max(
        towerCoverAt(camera.position, x, base, z),
        towerCoverAt(camera.position, x, top, z),
        towerCoverAt(camera.position, x, mid, z),
        towerCoverAt(camera.position, x + across.x * w, mid, z + across.z * w),
        towerCoverAt(camera.position, x - across.x * w, mid, z - across.z * w),
      );
      const c = cover.current[i];
      const next = c < 0 ? goal : goal > c ? Math.min(goal, c + step) : Math.max(goal, c - step);
      if (next !== goal) moving = true;
      if (next === c) return;
      cover.current[i] = next;
      const m = parts.each[i];
      m.line.opacity = LINE_OPACITY * (1 - next);
      const k = 1 - (1 - PLINTH_FLOOR) * next;
      m.plinth.color.copy(PLINTH).multiplyScalar(k);
      m.cap.color.copy(CAP).multiplyScalar(1 - next);
      // The pool of light on the floor under it goes with it
      lampK[i] = 1 - next;
    });
    if (moving) invalidate();
  });
  return (
    <group name="lumina-sculptures">
      {SCULPTURES.map((s, i) => {
        const a = (s.angle * Math.PI) / 180;
        return (
          <group
            key={i}
            position={[Math.sin(a) * s.radius, FLOOR_Y, Math.cos(a) * s.radius]}
            rotation={[0, a + Math.PI, 0]}
          >
            <mesh geometry={parts.plinth} material={parts.each[i].plinth} raycast={noRaycast} />
            <mesh
              geometry={parts.cap}
              material={parts.each[i].cap}
              position={[0, PLINTH_H + 0.012, 0]}
              raycast={noRaycast}
            />
            <lineSegments
              geometry={parts.forms[i]}
              material={parts.each[i].line}
              position={[0, PLINTH_H + 0.03, 0]}
              // The knight and the unicorn show their profile to the table
              rotation={[
                0,
                s.type === PieceType.Knight || s.type === PieceType.Unicorn ? 1.2 : 0,
                0,
              ]}
              scale={SCULPTURE_SCALE}
              raycast={noRaycast}
            />
          </group>
        );
      })}
    </group>
  );
};

// --- Lights -------------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();

/**
 * A soft key above the camera's left shoulder and a cool fill low on its
 * right, riding with the camera, so the pieces are modelled the same way
 * from every side and both seats.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(() => {
    const target = controls?.target ?? origin;
    forward.copy(target).sub(camera.position).normalize();
    right.crossVectors(forward, UP).normalize();
    for (const [light, back, side, up] of [
      [key.current, 8, -5, 9],
      [fill.current, 6, 7, 1],
    ] as const) {
      if (!light) continue;
      light.position
        .copy(target)
        .addScaledVector(forward, -back)
        .addScaledVector(right, side)
        .addScaledVector(UP, up);
      light.target.position.copy(target);
      light.target.updateMatrixWorld();
    }
    // The pieces' ceramic shader reads the same rig
    if (key.current) rig.key.value.copy(key.current.position).sub(target).normalize();
    if (fill.current) rig.fill.value.copy(fill.current.position).sub(target).normalize();
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#f4f6ff" />
      <directionalLight ref={fill} intensity={0.55} color="#9cc4ff" />
    </>
  );
};

export const Stage = ({ orientation }: StageProps) => (
  <>
    <GradientSky
      top={PALETTE.skyTop}
      horizon={PALETTE.skyHorizon}
      bottom={PALETTE.skyBottom}
      exponent={0.6}
    />
    <GlassWall />
    <FramedPositions />
    <Floor />
    <TableBody />
    <TableTop />
    <Engraving orientation={orientation} />
    <Curtain />
    <Sculptures />
    {/* Cool light from above, and the table's glow from below */}
    <hemisphereLight args={['#c9d6ff', '#2a3a52', 0.75]} />
    <CameraLights />
  </>
);
